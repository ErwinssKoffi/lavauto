-- 010 — Triggers d'intégrité et fonctions métier transactionnelles (Prompt 03)
-- Toutes les écritures sensibles passent par une fonction SECURITY DEFINER qui
-- vérifie la permission, l'état métier et l'idempotence dans une transaction.

-- updated_at automatique partout où la colonne existe.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema='public' AND column_name='updated_at' GROUP BY table_name LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t.table_name, t.table_name);
  END LOOP;
END $$;

-- company_id imposé par le serveur sur TOUTE table porteuse de la colonne.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema='public' AND column_name='company_id' AND table_name <> 'companies'
           GROUP BY table_name LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_company BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_company_id()', t.table_name, t.table_name);
  END LOOP;
END $$;

-- Historiques immuables : paiements, mouvements, lignes de lavage, audit…
DO $$
DECLARE v text;
DECLARE arr text[] := ARRAY['audit_logs','service_price_history','wash_items','wash_status_history','cash_movements','payments','payment_cancellations','stock_movements','commission_payouts','platform_audit_logs'];
BEGIN
  FOREACH v IN ARRAY arr LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assert_immutable()', v, v);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.assert_cash_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    IF NEW.status = 'open' THEN
      IF NEW.reopen_reason IS NULL OR length(btrim(NEW.reopen_reason)) < 3 THEN
        RAISE EXCEPTION 'Réouverture motivée obligatoire' USING ERRCODE = '23514';
      END IF;
      IF NOT public.has_permission('cash.reopen') THEN
        RAISE EXCEPTION 'Permission cash.reopen requise' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.counted_minor IS DISTINCT FROM OLD.counted_minor OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'Clôture de caisse non modifiable silencieusement' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cash_sessions_guard BEFORE UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.assert_cash_session();

CREATE OR REPLACE FUNCTION public.assert_commission_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('validated','paid') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Période de commission validée : figée' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_commission_periods_guard BEFORE UPDATE ON public.commission_periods
  FOR EACH ROW EXECUTE FUNCTION public.assert_commission_period();

CREATE OR REPLACE FUNCTION public.assert_commission_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ligne de commission non supprimable' USING ERRCODE = '55000';
  END IF;
  SELECT status INTO v_status FROM public.commission_periods WHERE id = NEW.period_id;
  IF v_status IN ('validated','paid') THEN
    RAISE EXCEPTION 'Période de commission figée : ligne non modifiable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_employee_commissions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.employee_commissions
  FOR EACH ROW EXECUTE FUNCTION public.assert_commission_immutable();

-- Inscription : crée UNE SEULE fois entreprise + station + propriétaire + essai.
-- Équivalent serveur de signUp() ; aucun prix de prestation n'est prérempli.
CREATE OR REPLACE FUNCTION public.signup_company(
  p_company_name text, p_station_name text, p_city text, p_phone text, p_owner_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid; v_station uuid; v_role uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Session Supabase requise' USING ERRCODE = '42501'; END IF;
  IF public.current_company_id() IS NOT NULL OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user) THEN
    RAISE EXCEPTION 'Entreprise déjà rattachée à ce compte' USING ERRCODE = '23505';
  END IF;
  IF length(btrim(p_company_name)) < 2 OR length(btrim(p_station_name)) < 2 THEN
    RAISE EXCEPTION 'Nom d’entreprise ou de station invalide' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_role FROM public.roles WHERE company_id IS NULL AND key = 'owner';
  INSERT INTO public.companies (name, city, phone, country_code, currency_code)
    VALUES (btrim(p_company_name), COALESCE(p_city,''), COALESCE(p_phone,''), 'CI', 'XOF') RETURNING id INTO v_company;
  INSERT INTO public.stations (company_id, name, city, phone, activated, hours)
    VALUES (v_company, btrim(p_station_name), COALESCE(p_city,''), COALESCE(p_phone,''), false, '[]'::jsonb) RETURNING id INTO v_station;
  INSERT INTO public.user_profiles (id, company_id, full_name, email, role_id, active)
    VALUES (v_user, v_company, btrim(p_owner_name), COALESCE((SELECT email FROM auth.users WHERE id = v_user), ''), v_role, true);
  INSERT INTO public.user_station_assignments (company_id, user_id, station_id) VALUES (v_company, v_user, v_station);
  INSERT INTO public.subscriptions (company_id, plan_id, status, trial_ends_at)
    VALUES (v_company, 'essai', 'trial', now() + interval '14 days');
  INSERT INTO public.audit_logs (company_id, station_id, actor_user_id, action, entity_type, entity_id)
    VALUES (v_company, v_station, v_user, 'company.created', 'companies', v_company::text);
  RETURN v_company;
END $$;

-- Création de fiche : prix lus côté serveur et FIGÉS dans wash_items.
CREATE OR REPLACE FUNCTION public.create_wash_with_items(
  p_station_id uuid, p_vehicle_category_id uuid, p_vehicle_label text, p_plate text,
  p_customer_id uuid, p_customer_name text, p_discount_minor bigint,
  p_items jsonb, p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash uuid; v_item jsonb; v_price bigint; v_qty integer;
  v_total bigint := 0; v_service_name text; v_activated boolean; v_number text;
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
  IF p_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=p_customer_id AND company_id=v_company) THEN
    RAISE EXCEPTION 'invalid_customer' USING ERRCODE='23514';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT sp.price_minor, s.name INTO v_price, v_service_name
      FROM public.service_prices sp JOIN public.services s ON s.id = sp.service_id
      WHERE sp.company_id=v_company AND sp.station_id=p_station_id
        AND sp.service_id=(v_item->>'service_id')::uuid
        AND sp.vehicle_category_id=p_vehicle_category_id AND s.active;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing_price' USING ERRCODE='23514'; END IF;
    v_qty := GREATEST(1, COALESCE((v_item->>'qty')::integer, 1));
    v_total := v_total + (v_price * v_qty);
  END LOOP;
  IF COALESCE(p_discount_minor,0) < 0 OR COALESCE(p_discount_minor,0) > v_total THEN
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
    v_qty := GREATEST(1, COALESCE((v_item->>'qty')::integer, 1));
    INSERT INTO public.wash_items (company_id, wash_id, service_id, service_name, unit_price_minor, qty, line_total_minor)
      VALUES (v_company, v_wash, (v_item->>'service_id')::uuid, v_service_name, v_price, v_qty, v_price * v_qty);
  END LOOP;
  INSERT INTO public.wash_status_history (company_id, station_id, wash_id, from_status, to_status, actor_user_id, reason)
    VALUES (v_company, p_station_id, v_wash, NULL, 'pending', auth.uid(), 'Création de la fiche');
  RETURN v_wash;
END $$;

-- Encaissement : idempotent, refuse fiche annulée / surpaiement, exige caisse
-- ouverte pour les espèces, écrit le mouvement de caisse correspondant.
CREATE OR REPLACE FUNCTION public.record_payment(
  p_wash_id uuid, p_amount_minor bigint, p_payment_method_id uuid,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_method record; v_session uuid; v_payment uuid;
BEGIN
  IF NOT public.has_permission('payments.create') THEN RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE='42501'; END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='23514'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_payment FROM public.payments WHERE company_id=v_company AND idempotency_key=p_idempotency_key;
    IF FOUND THEN RETURN v_payment; END IF;
  END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id=p_wash_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v_wash.status = 'cancelled' THEN RAISE EXCEPTION 'wash_cancelled' USING ERRCODE='23514'; END IF;
  IF v_wash.paid_minor + p_amount_minor > v_wash.total_minor THEN RAISE EXCEPTION 'overpayment' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_method FROM public.payment_methods
    WHERE id=p_payment_method_id AND company_id=v_company AND station_id=v_wash.station_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_service' USING ERRCODE='23514'; END IF;
  IF v_method.affects_cash THEN
    SELECT id INTO v_session FROM public.cash_sessions
      WHERE station_id=v_wash.station_id AND status='open' ORDER BY opened_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'cash_closed' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO public.payments (company_id, station_id, wash_id, amount_minor, payment_method_id, reference, idempotency_key, created_by)
    VALUES (v_company, v_wash.station_id, p_wash_id, p_amount_minor, p_payment_method_id,
            COALESCE(p_reference,''), p_idempotency_key, auth.uid()) RETURNING id INTO v_payment;
  UPDATE public.washes SET paid_minor = paid_minor + p_amount_minor WHERE id = p_wash_id;
  IF v_method.affects_cash THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind, amount_minor,
      payment_method_id, reference, idempotency_key, created_by)
    VALUES (v_company, v_wash.station_id, v_session, 'payment_in', p_amount_minor,
      p_payment_method_id, COALESCE(p_reference,''),
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'cash:' || p_idempotency_key END, auth.uid());
  END IF;
  RETURN v_payment;
END $$;

-- Clôture : solde théorique = fond + encaissements espèces − décaissements espèces.
CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_counted_minor bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_s record; v_theoretical bigint; v_diff bigint;
BEGIN
  IF NOT public.has_permission('cash.close') THEN RAISE EXCEPTION 'Permission cash.close requise' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_s FROM public.cash_sessions WHERE id=p_session_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v_s.status <> 'open' THEN RAISE EXCEPTION 'cash_closed' USING ERRCODE='23514'; END IF;
  -- Après réouverture, le comptage devient le fond : on ne recompte PAS
  -- les mouvements antérieurs à reopened_at (pas de double comptage).
  SELECT COALESCE(v_s.opening_float_minor,0) + COALESCE(SUM(amount_minor),0) INTO v_theoretical
    FROM public.cash_movements
    WHERE cash_session_id=p_session_id AND kind IN ('payment_in','expense_out','adjustment')
      AND created_at >= COALESCE(v_s.reopened_at, v_s.opened_at);
  v_diff := COALESCE(p_counted_minor,0) - v_theoretical;
  IF v_diff <> 0 THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind, amount_minor, reference, created_by)
      VALUES (v_company, v_s.station_id, p_session_id, 'closing', v_diff, 'Écart de clôture', auth.uid());
  END IF;
  UPDATE public.cash_sessions SET status='closed', counted_minor=COALESCE(p_counted_minor,0),
    closed_at=now(), closed_by=auth.uid() WHERE id=p_session_id;
END $$;

CREATE OR REPLACE FUNCTION public.reopen_cash_session(p_session_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_s record;
BEGIN
  IF NOT public.has_permission('cash.reopen') THEN RAISE EXCEPTION 'Permission cash.reopen requise' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'invalid_reason' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_s FROM public.cash_sessions WHERE id=p_session_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v_s.status <> 'closed' THEN RAISE EXCEPTION 'cash_open' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_sessions WHERE station_id=v_s.station_id AND status='open') THEN
    RAISE EXCEPTION 'cash_open' USING ERRCODE='23514';
  END IF;
  -- La réouverture est tracée par reopened_at + reopen_reason sur la session :
  -- aucun mouvement de caisse à zéro (contrainte amount_minor <> 0).
  UPDATE public.cash_sessions SET status='open', reopened_at=now(), reopen_reason=btrim(p_reason),
    opening_float_minor=COALESCE(counted_minor, opening_float_minor) WHERE id=p_session_id;
END $$;

-- Validation d'une période de commissions : figée, jamais recalculée ensuite.
CREATE OR REPLACE FUNCTION public.validate_commission_period(p_period_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_status text;
BEGIN
  IF NOT public.has_permission('commissions.validate') THEN RAISE EXCEPTION 'Permission commissions.validate requise' USING ERRCODE='42501'; END IF;
  SELECT status INTO v_status FROM public.commission_periods WHERE id=p_period_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'already_validated' USING ERRCODE='55000'; END IF;
  UPDATE public.commission_periods SET status='validated', validated_by=auth.uid(), validated_at=now() WHERE id=p_period_id;
END $$;

-- RÉCEPTION seule : c'est elle, et non la création de commande, qui incrémente
-- le stock. Idempotence par (commande, produit).
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_order_id uuid, p_lines jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_order record; v_line jsonb; v_product uuid; v_qty integer;
  v_cost bigint; v_key text; v_remaining integer;
BEGIN
  IF NOT public.has_permission('inventory.receive') THEN RAISE EXCEPTION 'Permission inventory.receive requise' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_order FROM public.purchase_orders WHERE id=p_order_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF v_order.status = 'cancelled' THEN RAISE EXCEPTION 'order_cancelled' USING ERRCODE='23514'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'empty_items' USING ERRCODE='23514'; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_product := (v_line->>'product_id')::uuid;
    v_qty := COALESCE((v_line->>'qty')::integer, 0);
    v_cost := COALESCE((v_line->>'unit_cost_minor')::bigint, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='23514'; END IF;
    v_key := 'po:' || p_order_id::text || ':' || v_product::text;
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE company_id=v_company AND idempotency_key=v_key) THEN CONTINUE; END IF;
    SELECT (qty_ordered - qty_received) INTO v_remaining FROM public.purchase_order_items
      WHERE order_id=p_order_id AND product_id=v_product AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de commande inconnue' USING ERRCODE='23514'; END IF;
    IF v_qty > v_remaining THEN RAISE EXCEPTION 'Quantité reçue supérieure à la commande' USING ERRCODE='23514'; END IF;
    INSERT INTO public.stock_movements (company_id, station_id, product_id, kind, qty_delta,
      unit_cost_minor, reference_type, reference_id, idempotency_key, created_by)
      VALUES (v_company, v_order.station_id, v_product, 'purchase_receipt', v_qty, v_cost,
              'purchase_order', p_order_id, v_key, auth.uid());
    INSERT INTO public.stock_levels (company_id, station_id, product_id, qty_on_hand)
      VALUES (v_company, v_order.station_id, v_product, v_qty)
      ON CONFLICT (station_id, product_id) DO UPDATE
        SET qty_on_hand = public.stock_levels.qty_on_hand + EXCLUDED.qty_on_hand, updated_at = now();
    UPDATE public.purchase_order_items SET qty_received = qty_received + v_qty
      WHERE order_id=p_order_id AND product_id=v_product;
  END LOOP;
  UPDATE public.purchase_orders SET status = CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.purchase_order_items WHERE order_id=p_order_id AND qty_received < qty_ordered)
    THEN 'received' ELSE 'partially_received' END
  WHERE id=p_order_id;
END $$;

-- Consommation théorique liée aux prestations d'une fiche : une seule fois
-- par (fiche, produit), et jamais de stock négatif.
CREATE OR REPLACE FUNCTION public.consume_products_for_wash(p_wash_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_row record; v_qty integer; v_key text;
BEGIN
  IF NOT public.has_permission('inventory.consume') THEN RAISE EXCEPTION 'Permission inventory.consume requise' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id=p_wash_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  FOR v_row IN
    SELECT spc.product_id, CEIL(spc.qty_per_wash * wi.qty)::integer AS qty
      FROM public.wash_items wi
      JOIN public.service_product_consumptions spc ON spc.service_id = wi.service_id AND spc.active
      WHERE wi.wash_id = p_wash_id AND wi.company_id = v_company
  LOOP
    v_qty := v_row.qty;
    v_key := 'wash:' || p_wash_id::text || ':' || v_row.product_id::text;
    IF EXISTS (SELECT 1 FROM public.stock_movements WHERE company_id=v_company AND idempotency_key=v_key) THEN CONTINUE; END IF;
    UPDATE public.stock_levels SET qty_on_hand = qty_on_hand - v_qty, updated_at = now()
      WHERE station_id = v_wash.station_id AND product_id = v_row.product_id AND qty_on_hand >= v_qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuffisant pour le produit %', v_row.product_id USING ERRCODE='23514'; END IF;
    INSERT INTO public.stock_movements (company_id, station_id, product_id, kind, qty_delta,
      reference_type, reference_id, idempotency_key, created_by)
      VALUES (v_company, v_wash.station_id, v_row.product_id, 'consumption', -v_qty,
              'wash', p_wash_id, v_key, auth.uid());
  END LOOP;
END $$;

-- Droits d'exécution : PUBLIC/anon ne peuvent pas appeler les écritures
-- sensibles ; seul authenticated y accède, et la fonction revérifie la permission.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'signup_company','create_wash_with_items','record_payment','close_cash_session',
      'reopen_cash_session','validate_commission_period','receive_purchase_order','consume_products_for_wash'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
