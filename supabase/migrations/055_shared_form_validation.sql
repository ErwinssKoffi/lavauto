-- 055 — Validation additive : mêmes bornes que src/lib/validation.ts.
-- Aucun nettoyage destructif ni validation rétroactive. Sur une ligne historique
-- déjà irrégulière, seul un champ réellement modifié est contrôlé ; une mise à
-- jour sans rapport (statut, horodatage…) reste possible.
CREATE OR REPLACE FUNCTION public.wg_valid_phone(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(btrim(p_value), '') = '' OR (
    length(btrim(p_value)) <= 40
    AND btrim(p_value) ~ '^\+?[0-9 ()-]+$'
    AND regexp_replace(btrim(p_value), '[^0-9]', '', 'g') ~ '^[0-9]{7,15}$'
  )
$$;
CREATE OR REPLACE FUNCTION public.wg_valid_email(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(btrim(p_value), '') = '' OR (
    length(btrim(p_value)) <= 254
    AND btrim(p_value) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
$$;

CREATE OR REPLACE FUNCTION public.wg_validate_contacts() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
BEGIN
  IF n ? 'phone' AND (TG_OP = 'INSERT' OR n->'phone' IS DISTINCT FROM o->'phone')
    AND NOT public.wg_valid_phone(n->>'phone') THEN
    RAISE EXCEPTION 'Téléphone invalide : 7 à 15 chiffres, avec indicatif et séparateurs facultatifs' USING ERRCODE = '23514';
  END IF;
  IF n ? 'email' AND (TG_OP = 'INSERT' OR n->'email' IS DISTINCT FROM o->'email')
    AND NOT public.wg_valid_email(n->>'email') THEN
    RAISE EXCEPTION 'Adresse e-mail invalide' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Chaque argument est « colonne:min:max ». Les types SQL imposent déjà les
-- entiers (montants en FCFA, quantités stock), le numérique est réservé aux
-- consommations à trois décimales. NULL reste admissible si la colonne l'est.
CREATE OR REPLACE FUNCTION public.wg_validate_numeric_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  spec text; col text; v numeric; lo numeric; hi numeric;
BEGIN
  FOREACH spec IN ARRAY TG_ARGV LOOP
    col := split_part(spec, ':', 1);
    IF n->>col IS NOT NULL AND (TG_OP = 'INSERT' OR n->col IS DISTINCT FROM o->col) THEN
      v := (n->>col)::numeric; lo := split_part(spec, ':', 2)::numeric; hi := split_part(spec, ':', 3)::numeric;
      IF v::text IN ('NaN', 'Infinity', '-Infinity') OR v < lo OR v > hi THEN
        RAISE EXCEPTION 'Valeur hors limites pour % : % à %', col, lo, hi USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- L'interface accepte uniquement des dates grégoriennes de quatre chiffres.
-- Les deux colonnes d'une période sont comparées si elles sont renseignées.
CREATE OR REPLACE FUNCTION public.wg_validate_dates() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  c text; v date; first_day date; last_day date; changed boolean := TG_OP = 'INSERT';
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF TG_OP = 'INSERT' OR n->c IS DISTINCT FROM o->c THEN
      changed := true;
      IF n->>c IS NOT NULL THEN
        v := (n->>c)::date;
        IF NOT isfinite(v) OR v < DATE '0001-01-01' OR v > DATE '9999-12-31' THEN
          RAISE EXCEPTION 'Date invalide pour %', c USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF changed AND TG_NARGS = 2 THEN
    first_day := (n->>TG_ARGV[0])::date; last_day := (n->>TG_ARGV[1])::date;
    IF first_day IS NOT NULL AND last_day IS NOT NULL AND last_day < first_day THEN
      RAISE EXCEPTION 'La date de fin précède la date de début' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER wg_customers_contacts BEFORE INSERT OR UPDATE OF phone, email ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_contacts();
CREATE TRIGGER wg_suppliers_contacts BEFORE INSERT OR UPDATE OF phone, email ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_contacts();
CREATE TRIGGER wg_fleets_contacts BEFORE INSERT OR UPDATE OF phone, email ON public.fleets
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_contacts();
CREATE TRIGGER wg_company_contacts BEFORE INSERT OR UPDATE OF phone ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_contacts();
CREATE TRIGGER wg_station_contacts BEFORE INSERT OR UPDATE OF phone ON public.stations
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_contacts();
CREATE TRIGGER wg_profile_contacts BEFORE INSERT OR UPDATE OF phone, email ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_contacts();

CREATE TRIGGER wg_wash_numbers BEFORE INSERT OR UPDATE OF discount_minor, total_minor, paid_minor ON public.washes
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns(
  'discount_minor:0:1000000000000', 'total_minor:0:1000000000000', 'paid_minor:0:1000000000000');
CREATE TRIGGER wg_wash_item_numbers BEFORE INSERT OR UPDATE OF qty, unit_price_minor, line_total_minor ON public.wash_items
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns(
  'qty:1:1000000', 'unit_price_minor:0:1000000000000', 'line_total_minor:0:1000000000000');
CREATE TRIGGER wg_service_price_numbers BEFORE INSERT OR UPDATE OF price_minor ON public.service_prices
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('price_minor:0:1000000000000');
CREATE TRIGGER wg_payment_numbers BEFORE INSERT OR UPDATE OF amount_minor ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('amount_minor:1:1000000000000');
CREATE TRIGGER wg_expense_numbers BEFORE INSERT OR UPDATE OF amount_minor ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('amount_minor:1:1000000000000');
CREATE TRIGGER wg_cash_numbers BEFORE INSERT OR UPDATE OF opening_float_minor, counted_minor ON public.cash_sessions
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('opening_float_minor:0:1000000000000', 'counted_minor:0:1000000000000');
CREATE TRIGGER wg_reconciliation_numbers BEFORE INSERT OR UPDATE OF counted_minor ON public.channel_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('counted_minor:0:1000000000000');
CREATE TRIGGER wg_product_numbers BEFORE INSERT OR UPDATE OF reorder_level, average_cost_minor ON public.products
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('reorder_level:0:1000000', 'average_cost_minor:0:1000000000000');
CREATE TRIGGER wg_order_item_numbers BEFORE INSERT OR UPDATE OF qty_ordered, qty_received, unit_cost_minor ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('qty_ordered:1:1000000', 'qty_received:0:1000000', 'unit_cost_minor:0:1000000000000');
CREATE TRIGGER wg_inventory_numbers BEFORE INSERT OR UPDATE OF counted_qty ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('counted_qty:0:1000000');
CREATE TRIGGER wg_consumption_numbers BEFORE INSERT OR UPDATE OF qty_per_wash ON public.service_product_consumptions
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('qty_per_wash:0.001:1000000');
CREATE TRIGGER wg_post_numbers BEFORE INSERT OR UPDATE OF capacity ON public.wash_posts
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('capacity:1:1000000');
CREATE TRIGGER wg_package_numbers BEFORE INSERT OR UPDATE OF price_minor, wash_count, validity_days ON public.packages
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('price_minor:0:1000000000000', 'wash_count:1:1000000', 'validity_days:1:1000000');
CREATE TRIGGER wg_promotion_numbers BEFORE INSERT OR UPDATE OF value, min_amount_minor, max_usages ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('value:1:1000000', 'min_amount_minor:0:1000000000000', 'max_usages:1:1000000');
CREATE TRIGGER wg_fleet_numbers BEFORE INSERT OR UPDATE OF credit_limit_minor ON public.fleets
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('credit_limit_minor:0:1000000000000');
CREATE TRIGGER wg_contract_numbers BEFORE INSERT OR UPDATE OF credit_limit_minor, discount_percent ON public.fleet_contracts
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('credit_limit_minor:0:1000000000000', 'discount_percent:0:100');
CREATE TRIGGER wg_fleet_receivable_numbers BEFORE INSERT OR UPDATE OF amount_minor ON public.fleet_receivables
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('amount_minor:1:1000000000000');

CREATE TRIGGER wg_expense_date BEFORE INSERT OR UPDATE OF spent_at ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('spent_at');
CREATE TRIGGER wg_order_dates BEFORE INSERT OR UPDATE OF ordered_at, expected_at ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('ordered_at', 'expected_at');
CREATE TRIGGER wg_commission_dates BEFORE INSERT OR UPDATE OF period_start, period_end ON public.commission_periods
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('period_start', 'period_end');
CREATE TRIGGER wg_reconciliation_dates BEFORE INSERT OR UPDATE OF period_start, period_end ON public.channel_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('period_start', 'period_end');
CREATE TRIGGER wg_cost_dates BEFORE INSERT OR UPDATE OF start_date, end_date ON public.finance_cost_periods
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('start_date', 'end_date');
CREATE TRIGGER wg_package_dates BEFORE INSERT OR UPDATE OF starts_at, ends_at ON public.packages
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('starts_at', 'ends_at');
CREATE TRIGGER wg_customer_package_dates BEFORE INSERT OR UPDATE OF purchased_at, expires_at ON public.customer_packages
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('purchased_at', 'expires_at');
CREATE TRIGGER wg_promotion_dates BEFORE INSERT OR UPDATE OF starts_at, ends_at ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('starts_at', 'ends_at');
CREATE TRIGGER wg_contract_dates BEFORE INSERT OR UPDATE OF start_date, end_date ON public.fleet_contracts
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('start_date', 'end_date');
CREATE TRIGGER wg_fleet_due_date BEFORE INSERT OR UPDATE OF due_date ON public.fleet_receivables
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_dates('due_date');

-- L’ancienne RPC corrigeait silencieusement une quantité négative en 1.
-- La refuser AVANT toute insertion ; la remise ne peut dépasser le brut.
CREATE OR REPLACE FUNCTION public.create_wash_with_items(
  p_station_id uuid, p_vehicle_category_id uuid, p_vehicle_label text, p_plate text,
  p_customer_id uuid, p_customer_name text, p_discount_minor bigint,
  p_items jsonb, p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash uuid; v_item jsonb; v_price bigint; v_qty integer;
  v_total numeric := 0; v_service_name text; v_activated boolean; v_number text;
BEGIN
  IF NOT public.has_permission('washes.create') THEN RAISE EXCEPTION 'Permission washes.create requise' USING ERRCODE='42501'; END IF;
  IF NOT public.can_access_station(p_station_id) THEN RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE='42501'; END IF;
  SELECT activated INTO v_activated FROM public.stations WHERE id=p_station_id AND company_id=v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT v_activated THEN RAISE EXCEPTION 'onboarding_incomplete' USING ERRCODE='23514'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_wash FROM public.washes WHERE company_id=v_company AND idempotency_key=p_idempotency_key;
    IF FOUND THEN RETURN v_wash; END IF;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_items' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_categories WHERE id=p_vehicle_category_id AND company_id=v_company AND station_id=p_station_id AND active) THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE='23514';
  END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=p_customer_id AND company_id=v_company AND station_id=p_station_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_customer' USING ERRCODE='23514';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT sp.price_minor, s.name INTO v_price, v_service_name
      FROM public.service_prices sp JOIN public.services s ON s.id = sp.service_id
      WHERE sp.company_id=v_company AND sp.station_id=p_station_id
        AND sp.service_id=(v_item->>'service_id')::uuid
        AND sp.vehicle_category_id=p_vehicle_category_id AND s.active;
    IF NOT FOUND OR v_price <= 0 OR v_price > 1000000000000 THEN RAISE EXCEPTION 'missing_price' USING ERRCODE='23514'; END IF;
    IF COALESCE(v_item->>'qty', '') !~ '^[0-9]{1,7}$'
      OR (v_item->>'qty')::integer NOT BETWEEN 1 AND 1000000 THEN
      RAISE EXCEPTION 'Quantité invalide' USING ERRCODE='23514';
    END IF;
    v_qty := (v_item->>'qty')::integer;
    v_total := v_total + (v_price::numeric * v_qty);
    IF v_total > 1000000000000 THEN
      RAISE EXCEPTION 'Montant total trop élevé' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF COALESCE(p_discount_minor,0) < 0 OR COALESCE(p_discount_minor,0) > v_total OR COALESCE(p_discount_minor,0) > 1000000000000 THEN
    RAISE EXCEPTION 'discount_exceeded' USING ERRCODE='23514';
  END IF;
  v_total := v_total - COALESCE(p_discount_minor,0);
  v_number := 'L-' || lpad(nextval('public.wash_number_seq')::text, 6, '0');
  INSERT INTO public.washes (company_id, station_id, number, customer_id, customer_name, vehicle_category_id,
    vehicle_label, plate, discount_minor, total_minor, status, idempotency_key, created_by)
  VALUES (v_company, p_station_id, v_number, p_customer_id, NULLIF(p_customer_name,''), p_vehicle_category_id,
    COALESCE(p_vehicle_label,''), COALESCE(p_plate,''), COALESCE(p_discount_minor,0), v_total, 'pending', p_idempotency_key, auth.uid())
  RETURNING id INTO v_wash;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT sp.price_minor, s.name INTO v_price, v_service_name
      FROM public.service_prices sp JOIN public.services s ON s.id = sp.service_id
      WHERE sp.company_id=v_company AND sp.station_id=p_station_id
        AND sp.service_id=(v_item->>'service_id')::uuid AND sp.vehicle_category_id=p_vehicle_category_id;
    IF COALESCE(v_item->>'qty', '') !~ '^[0-9]{1,7}$'
      OR (v_item->>'qty')::integer NOT BETWEEN 1 AND 1000000 THEN
      RAISE EXCEPTION 'Quantité invalide' USING ERRCODE='23514';
    END IF;
    v_qty := (v_item->>'qty')::integer;
    INSERT INTO public.wash_items (company_id, wash_id, service_id, service_name, unit_price_minor, qty, line_total_minor)
      VALUES (v_company, v_wash, (v_item->>'service_id')::uuid, v_service_name, v_price, v_qty, v_price * v_qty);
  END LOOP;
  INSERT INTO public.wash_status_history (company_id, station_id, wash_id, from_status, to_status, actor_user_id, reason)
    VALUES (v_company, p_station_id, v_wash, NULL, 'pending', auth.uid(), 'Création de la fiche');
  RETURN v_wash;
END $$;

-- Ne pas transformer un fond de caisse négatif ou manquant en zéro.
CREATE OR REPLACE FUNCTION public.open_cash_session(
  p_station_id uuid, p_opening_float_minor bigint DEFAULT 0, p_number text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_number text; v_session uuid;
BEGIN
  IF p_opening_float_minor IS NULL OR p_opening_float_minor < 0 OR p_opening_float_minor > 1000000000000 THEN
    RAISE EXCEPTION 'Fond de caisse invalide' USING ERRCODE = '23514';
  END IF;
  IF NOT public.has_permission('cash.open') THEN
    RAISE EXCEPTION 'Permission cash.open requise' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Station introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-station:' || p_station_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE station_id = p_station_id AND company_id = v_company AND status = 'open') THEN
    RAISE EXCEPTION 'Une caisse est deja ouverte' USING ERRCODE = '23514';
  END IF;
  v_number := COALESCE(NULLIF(btrim(COALESCE(p_number, '')), ''),
    'C-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 8));
  INSERT INTO public.cash_sessions (company_id, station_id, number, opened_by,
    opening_float_minor, status, opened_at)
  VALUES (v_company, p_station_id, v_number, auth.uid(),
    p_opening_float_minor, 'open', clock_timestamp())
  RETURNING id INTO v_session;
  RETURN v_session;
END $$;

-- Contrôler la précision AVANT que numeric(12,3) n’arrondisse la saisie.
CREATE OR REPLACE FUNCTION public.save_service_consumption(
  p_service_id uuid, p_product_id uuid, p_qty_per_wash numeric, p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_service record; v_product record; v_id uuid;
BEGIN
  IF p_qty_per_wash IS NULL OR p_qty_per_wash < 0.001 OR p_qty_per_wash > 1000000
    OR p_qty_per_wash::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_qty_per_wash * 1000 <> trunc(p_qty_per_wash * 1000) THEN
    RAISE EXCEPTION 'Consommation invalide : trois décimales maximum' USING ERRCODE = '23514';
  END IF;
  IF NOT public.has_permission('catalog.manage') THEN
    RAISE EXCEPTION 'Permission catalog.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL OR COALESCE(p_qty_per_wash, 0) <= 0 THEN
    RAISE EXCEPTION 'Consommation theorique invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_service FROM public.services
  WHERE id = p_service_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prestation introuvable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_product FROM public.products
  WHERE id = p_product_id AND company_id = v_company
    AND station_id = v_service.station_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produit hors station' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_service.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.service_product_consumptions (company_id, station_id, service_id,
    product_id, qty_per_wash, active)
  VALUES (v_company, v_service.station_id, p_service_id, p_product_id, p_qty_per_wash, p_active)
  ON CONFLICT (service_id, product_id) DO UPDATE
    SET qty_per_wash = EXCLUDED.qty_per_wash, active = EXCLUDED.active,
        updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.wg_validate_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END; col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (TG_OP = 'INSERT' OR n->col IS DISTINCT FROM o->col)
      AND (n->>col IS NULL OR length(btrim(n->>col)) NOT BETWEEN 2 AND 200) THEN
      RAISE EXCEPTION 'Nom invalide : 2 à 200 caractères' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER wg_customer_name BEFORE INSERT OR UPDATE OF name ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_name('name');
CREATE TRIGGER wg_supplier_name BEFORE INSERT OR UPDATE OF name ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_name('name');
CREATE TRIGGER wg_product_name BEFORE INSERT OR UPDATE OF name ON public.products
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_name('name');
CREATE TRIGGER wg_fleet_name BEFORE INSERT OR UPDATE OF name ON public.fleets
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_name('name');
CREATE TRIGGER wg_package_name BEFORE INSERT OR UPDATE OF name ON public.packages
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_name('name');
CREATE TRIGGER wg_promotion_name BEFORE INSERT OR UPDATE OF name, code ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_name('name', 'code');
CREATE TRIGGER wg_loyalty_numbers BEFORE INSERT OR UPDATE OF points_per_1000_minor, redemption_threshold ON public.loyalty_programs
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('points_per_1000_minor:1:1000000', 'redemption_threshold:1:1000000');
CREATE TRIGGER wg_loyalty_delta BEFORE INSERT OR UPDATE OF points_delta ON public.loyalty_transactions
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('points_delta:-1000000:1000000');
CREATE TRIGGER wg_commission_payout BEFORE INSERT OR UPDATE OF amount_minor ON public.commission_payouts
FOR EACH ROW EXECUTE FUNCTION public.wg_validate_numeric_columns('amount_minor:0:1000000000000');

-- Paiements rejouables à contenu identique et verrouillage des soldes/caisse.
CREATE OR REPLACE FUNCTION public.record_payment(
  p_wash_id uuid, p_amount_minor bigint, p_payment_method_id uuid,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_method record; v_session uuid; v_payment uuid; v_existing record;
BEGIN
  IF NOT public.has_permission('payments.create') THEN
    RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    IF length(p_idempotency_key) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'Clé de paiement invalide' USING ERRCODE = '23514';
    END IF;
    -- Même clé : sérialiser la recherche et l'insertion, y compris les
    -- requêtes simultanées ; une clé ne peut désigner un autre contenu.
    PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || v_company::text || ':' || p_idempotency_key, 0));
    SELECT * INTO v_existing FROM public.payments
      WHERE company_id = v_company AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF NOT public.can_access_station(v_existing.station_id) THEN
        RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
      END IF;
      IF v_existing.wash_id IS DISTINCT FROM p_wash_id OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
        OR v_existing.payment_method_id IS DISTINCT FROM p_payment_method_id
        OR COALESCE(v_existing.reference, '') IS DISTINCT FROM COALESCE(p_reference, '') THEN
        RAISE EXCEPTION 'Clé déjà utilisée pour un autre paiement' USING ERRCODE = '23505';
      END IF;
      RETURN v_existing.id;
    END IF;
  END IF;
  SELECT * INTO v_wash FROM public.washes
    WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_wash.status = 'cancelled' THEN
    RAISE EXCEPTION 'Fiche annulee' USING ERRCODE = '23514';
  END IF;
  IF v_wash.paid_minor + p_amount_minor > v_wash.total_minor THEN
    RAISE EXCEPTION 'Surpaiement' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_method FROM public.payment_methods
    WHERE id = p_payment_method_id AND company_id = v_company
      AND station_id = v_wash.station_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moyen de paiement invalide' USING ERRCODE = '23514'; END IF;
  IF v_method.affects_cash THEN
    SELECT id INTO v_session FROM public.cash_sessions
      WHERE station_id = v_wash.station_id AND company_id = v_company AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Caisse fermee' USING ERRCODE = '23514'; END IF;
  END IF;
  INSERT INTO public.payments (company_id, station_id, wash_id, amount_minor,
    payment_method_id, reference, idempotency_key, created_by)
  VALUES (v_company, v_wash.station_id, p_wash_id, p_amount_minor,
    p_payment_method_id, COALESCE(p_reference, ''), p_idempotency_key, auth.uid())
  RETURNING id INTO v_payment;
  UPDATE public.washes SET paid_minor = paid_minor + p_amount_minor, updated_at = now()
    WHERE id = p_wash_id;
  IF v_method.affects_cash THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, payment_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, v_wash.station_id, v_session, 'payment_in', p_amount_minor,
      p_payment_method_id, v_payment, COALESCE(p_reference, ''),
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'cash:' || p_idempotency_key END,
      auth.uid(), clock_timestamp());
  END IF;
  RETURN v_payment;
END $$;

CREATE OR REPLACE FUNCTION public.record_expense_by_key(
  p_station_id uuid, p_amount_minor bigint, p_category_name text, p_reason text,
  p_supplier text DEFAULT '', p_spent_at date DEFAULT current_date,
  p_method_key text DEFAULT 'cash', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_cat text := btrim(COALESCE(p_category_name, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_category uuid; v_method uuid; v_method_row record; v_session uuid; v_expense uuid;
  v_existing record;
BEGIN
  IF NOT public.has_permission('expenses.create') THEN
    RAISE EXCEPTION 'Permission expenses.create requise' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 1000000000000 OR p_spent_at IS NULL OR length(v_cat) NOT BETWEEN 2 AND 200 OR length(v_reason) < 2 THEN
    RAISE EXCEPTION 'Depense invalide' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL)
    OR NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    IF length(p_idempotency_key) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'Clé de dépense invalide' USING ERRCODE = '23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('expense:' || v_company::text || ':' || p_idempotency_key, 0));
    SELECT e.*, c.name AS category_name, pm.key AS method_key INTO v_existing
      FROM public.expenses e LEFT JOIN public.expense_categories c ON c.id = e.category_id
      LEFT JOIN public.payment_methods pm ON pm.id = e.payment_method_id
      WHERE e.company_id = v_company AND e.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF NOT public.can_access_station(v_existing.station_id) THEN
        RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
      END IF;
      IF v_existing.station_id IS DISTINCT FROM p_station_id OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
        OR lower(v_existing.category_name) IS DISTINCT FROM lower(v_cat)
        OR v_existing.reason IS DISTINCT FROM v_reason
        OR v_existing.supplier IS DISTINCT FROM btrim(COALESCE(p_supplier, ''))
        OR v_existing.spent_at IS DISTINCT FROM p_spent_at
        OR v_existing.method_key IS DISTINCT FROM p_method_key THEN
        RAISE EXCEPTION 'Clé déjà utilisée pour une autre dépense' USING ERRCODE = '23505';
      END IF;
      RETURN v_existing.id;
    END IF;
  END IF;
  INSERT INTO public.expense_categories (company_id, station_id, name, active)
  VALUES (v_company, p_station_id, v_cat, true)
  ON CONFLICT (station_id, lower(name)) DO UPDATE SET active = true
  RETURNING id INTO v_category;
  v_method := public.ensure_payment_method(v_company, p_station_id, p_method_key);
  SELECT * INTO v_method_row FROM public.payment_methods WHERE id = v_method;
  IF v_method_row.affects_cash THEN
    SELECT id INTO v_session FROM public.cash_sessions
      WHERE station_id = p_station_id AND company_id = v_company AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Caisse fermee' USING ERRCODE = '23514'; END IF;
  END IF;
  INSERT INTO public.expenses (company_id, station_id, amount_minor, category_id,
    reason, supplier, spent_at, payment_method_id, cash_session_id, status,
    idempotency_key, created_by)
  VALUES (v_company, p_station_id, p_amount_minor, v_category, v_reason,
    btrim(COALESCE(p_supplier, '')), COALESCE(p_spent_at, current_date), v_method,
    v_session, 'recorded', p_idempotency_key, auth.uid())
  RETURNING id INTO v_expense;
  IF v_method_row.affects_cash THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, expense_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, p_station_id, v_session, 'expense_out', -p_amount_minor,
      v_method, v_expense, v_cat,
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'expense:' || p_idempotency_key END,
      auth.uid(), clock_timestamp());
  END IF;
  RETURN v_expense;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_expense(p_expense_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_e record; v_status text;
BEGIN
  IF NOT public.has_permission('expenses.cancel') THEN
    RAISE EXCEPTION 'Permission expenses.cancel requise' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motif d annulation requis' USING ERRCODE = '23514';
  END IF;
  SELECT e.*, pm.affects_cash, pm.id AS method_id INTO v_e
  FROM public.expenses e
  LEFT JOIN public.payment_methods pm ON pm.id = e.payment_method_id
  WHERE e.id = p_expense_id AND e.company_id = v_company FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depense introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_e.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_e.status = 'cancelled' THEN
    RAISE EXCEPTION 'Depense deja annulee' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(v_e.affects_cash, false) AND v_e.cash_session_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.cash_sessions WHERE id = v_e.cash_session_id FOR UPDATE;
    IF v_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'Caisse cloturee : annulation impossible sans reouverture' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.expenses SET status = 'cancelled', cancel_reason = btrim(p_reason),
    updated_at = now() WHERE id = p_expense_id;
  IF COALESCE(v_e.affects_cash, false) AND v_e.cash_session_id IS NOT NULL THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, expense_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, v_e.station_id, v_e.cash_session_id, 'adjustment', v_e.amount_minor,
      v_e.method_id, v_e.id, 'Annulation depense',
      'cancel-expense:' || p_expense_id, auth.uid(), clock_timestamp());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_payment(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_p record; v_session uuid; v_status text;
BEGIN
  IF NOT public.has_permission('payments.cancel') THEN
    RAISE EXCEPTION 'Permission payments.cancel requise' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motif d annulation requis' USING ERRCODE = '23514';
  END IF;
  SELECT p.*, pm.affects_cash, pm.id AS method_id INTO v_p
  FROM public.payments p
  LEFT JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.id = p_payment_id AND p.company_id = v_company FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_p.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_cancellations
    WHERE payment_id = p_payment_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Paiement deja annule' USING ERRCODE = '23514';
  END IF;
  -- Même ordre que record_payment : lavage, puis caisse.
  PERFORM 1 FROM public.washes WHERE id = v_p.wash_id AND company_id = v_company FOR UPDATE;
  IF COALESCE(v_p.affects_cash, false) THEN
    SELECT cash_session_id INTO v_session FROM public.cash_movements
      WHERE payment_id = p_payment_id AND kind = 'payment_in' LIMIT 1;
    IF v_session IS NOT NULL THEN
      SELECT status INTO v_status FROM public.cash_sessions WHERE id = v_session FOR UPDATE;
      IF v_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'Caisse cloturee : annulation impossible sans reouverture' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.payment_cancellations (company_id, station_id, payment_id,
    amount_minor, reason, cancelled_by, created_at)
  VALUES (v_company, v_p.station_id, p_payment_id, v_p.amount_minor,
    btrim(p_reason), auth.uid(), now());
  UPDATE public.washes SET paid_minor = GREATEST(0, paid_minor - v_p.amount_minor),
    updated_at = now() WHERE id = v_p.wash_id AND company_id = v_company;
  IF COALESCE(v_p.affects_cash, false) AND v_session IS NOT NULL THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, payment_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, v_p.station_id, v_session, 'adjustment', -v_p.amount_minor,
      v_p.method_id, p_payment_id, 'Remboursement / annulation encaissement',
      'cancel-payment:' || p_payment_id, auth.uid(), clock_timestamp());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_session_id uuid, p_counted_minor bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_s record;
  v_theoretical bigint; v_diff bigint;
BEGIN
  IF NOT public.has_permission('cash.close') THEN
    RAISE EXCEPTION 'Permission cash.close requise' USING ERRCODE = '42501';
  END IF;
  IF p_counted_minor IS NULL OR p_counted_minor < 0 OR p_counted_minor > 1000000000000 THEN
    RAISE EXCEPTION 'Comptage invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_s FROM public.cash_sessions
    WHERE id = p_session_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_s.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'open' THEN
    RAISE EXCEPTION 'Caisse deja cloturee' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(v_s.opening_float_minor, 0) + COALESCE(SUM(amount_minor), 0)
  INTO v_theoretical
  FROM public.cash_movements
  WHERE cash_session_id = p_session_id
    AND kind IN ('payment_in', 'expense_out', 'adjustment')
    AND created_at >= COALESCE(v_s.reopened_at, v_s.opened_at);
  v_diff := p_counted_minor - v_theoretical;
  IF v_diff <> 0 THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, reference, created_by, created_at)
    VALUES (v_company, v_s.station_id, p_session_id, 'closing', v_diff,
      'Ecart de cloture', auth.uid(), clock_timestamp());
  END IF;
  INSERT INTO public.cash_closures (company_id, station_id, cash_session_id,
    counted_minor, theoretical_minor, difference_minor, closed_by, created_at)
  VALUES (v_company, v_s.station_id, p_session_id, p_counted_minor,
    v_theoretical, v_diff, auth.uid(), clock_timestamp());
  UPDATE public.cash_sessions
  SET status = 'closed', counted_minor = p_counted_minor, closed_at = clock_timestamp(),
    closed_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;
END $$;

CREATE OR REPLACE FUNCTION public.reopen_cash_session(
  p_session_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_s record;
BEGIN
  IF NOT public.has_permission('cash.reopen') THEN
    RAISE EXCEPTION 'Permission cash.reopen requise' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motif de reouverture requis' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_s FROM public.cash_sessions
    WHERE id = p_session_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_s.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'closed' THEN
    RAISE EXCEPTION 'Caisse deja ouverte' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-station:' || v_s.station_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE station_id = v_s.station_id AND company_id = v_company AND status = 'open') THEN
    RAISE EXCEPTION 'Une caisse est deja ouverte' USING ERRCODE = '23514';
  END IF;
  UPDATE public.cash_sessions
  SET status = 'open', reopened_at = clock_timestamp(), reopen_reason = btrim(p_reason),
    opening_float_minor = COALESCE(counted_minor, opening_float_minor),
    updated_at = now()
  WHERE id = p_session_id;
END $$;
