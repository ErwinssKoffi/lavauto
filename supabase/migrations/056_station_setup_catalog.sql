-- 056 — Mise en route et catalogue persistés côté serveur.
-- À préparer et tester sur une base isolée uniquement. NE PAS appliquer à
-- lavauto sans sauvegarde/restauration vérifiée, réconciliation des versions
-- et autorisation explicite. Prérequis : 001–055, en particulier 054 et 055.
-- Aucun nettoyage ni modification rétroactive des données existantes.

CREATE OR REPLACE FUNCTION public.wg_setup_access(p_station_id uuid, p_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_my_station(p_station_id);
  IF v_company IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = v_company AND deleted_at IS NULL AND NOT suspended
  ) THEN RAISE EXCEPTION 'Entreprise inaccessible' USING ERRCODE = '42501'; END IF;
  IF p_permission = 'read' THEN
    IF NOT (public.has_permission('washes.view') OR public.has_permission('settings.manage') OR public.has_permission('catalog.manage')) THEN
      RAISE EXCEPTION 'Lecture de la station non autorisée' USING ERRCODE = '42501';
    END IF;
  ELSIF p_permission NOT IN ('settings.manage', 'catalog.manage') OR NOT public.has_permission(p_permission) THEN
    RAISE EXCEPTION 'Permission % requise', p_permission USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END $$;
REVOKE ALL ON FUNCTION public.wg_setup_access(uuid,text) FROM PUBLIC, anon, authenticated;

-- Les modifications et l'activation prennent toutes le même verrou de station :
-- la vérification d'ouverture ne peut pas courir contre une édition du catalogue.
CREATE OR REPLACE FUNCTION public.wg_setup_lock(p_station_id uuid, p_permission text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid;
BEGIN
  v_company := public.wg_setup_access(p_station_id, p_permission);
  -- Compatible avec les verrous de clé étrangère pris à l'insertion d'une
  -- fiche, tout en sérialisant les changements de configuration.
  PERFORM 1 FROM public.stations WHERE id = p_station_id AND company_id = v_company AND deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Station introuvable' USING ERRCODE = 'P0002'; END IF;
  RETURN v_company;
END $$;
REVOKE ALL ON FUNCTION public.wg_setup_lock(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wg_setup_audit(p_company uuid, p_station uuid, p_action text, p_type text, p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.audit_logs(company_id, station_id, actor_user_id, action, entity_type, entity_id)
  VALUES (p_company, p_station, auth.uid(), p_action, p_type, p_id::text)
$$;
REVOKE ALL ON FUNCTION public.wg_setup_audit(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.wg_setup_hours_valid(p_hours jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE h jsonb; days text[] := ARRAY[]::text[]; d text; o text; c text;
BEGIN
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array' OR jsonb_array_length(p_hours) <> 7 THEN RETURN false; END IF;
  FOR h IN SELECT value FROM jsonb_array_elements(p_hours) LOOP
    IF jsonb_typeof(h) IS DISTINCT FROM 'object' OR jsonb_typeof(h->'day') IS DISTINCT FROM 'string'
      OR jsonb_typeof(h->'open') IS DISTINCT FROM 'string' OR jsonb_typeof(h->'close') IS DISTINCT FROM 'string'
      OR jsonb_typeof(h->'closed') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    d := h->>'day'; o := h->>'open'; c := h->>'close';
    IF d NOT IN ('Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche') OR d = ANY(days)
      OR o !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR c !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR (NOT (h->>'closed')::boolean AND o >= c) THEN RETURN false; END IF;
    days := array_append(days, d);
  END LOOP;
  RETURN cardinality(days) = 7;
END $$;
REVOKE ALL ON FUNCTION public.wg_setup_hours_valid(jsonb) FROM PUBLIC, anon, authenticated;

-- Lecture complète, y compris éléments désactivés, limitée à la station du JWT.
CREATE OR REPLACE FUNCTION public.my_station_setup(p_station_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_access(p_station_id, 'read'); v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'company', jsonb_build_object('id',c.id,'name',c.name,'city',c.city,'phone',c.phone,
      'createdAt',c.created_at,'suspended',c.suspended),
    'station', jsonb_build_object('id',s.id,'companyId',s.company_id,'name',s.name,'address',s.address,
      'city',s.city,'phone',s.phone,'hours',s.hours,'logoPath',s.logo_path,
      'paymentMethods',CASE WHEN jsonb_typeof(s.settings->'accepted_payment_methods') = 'array'
        THEN s.settings->'accepted_payment_methods' ELSE '[]'::jsonb END,
      'commissionRate',CASE WHEN COALESCE(s.settings->>'commission_rate','') ~ '^(100|[0-9]{1,2})$'
        THEN (s.settings->>'commission_rate')::integer ELSE 0 END,
      'monthlyTarget',CASE WHEN COALESCE(s.settings->>'monthly_target','') ~ '^[0-9]{1,13}$'
        AND (s.settings->>'monthly_target')::numeric <= 1000000000000
        THEN (s.settings->>'monthly_target')::numeric ELSE 0 END,
      'activated',s.activated,'activatedAt',s.activated_at),
    'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'station_id',v.station_id,'name',v.name,'active',v.active)
      ORDER BY v.sort_order,v.created_at,v.id) FROM public.vehicle_categories v
      WHERE v.company_id=v_company AND v.station_id=s.id AND v.deleted_at IS NULL),'[]'::jsonb),
    'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'station_id',v.station_id,'name',v.name,'description',v.description,'active',v.active)
      ORDER BY v.sort_order,v.created_at,v.id) FROM public.services v
      WHERE v.company_id=v_company AND v.station_id=s.id AND v.deleted_at IS NULL),'[]'::jsonb),
    'prices',COALESCE((SELECT jsonb_agg(jsonb_build_object('station_id',p.station_id,'service_id',p.service_id,
      'vehicle_category_id',p.vehicle_category_id,'price_minor',p.price_minor,'currency_code',p.currency_code)
      ORDER BY p.service_id,p.vehicle_category_id) FROM public.service_prices p
      JOIN public.services v ON v.id=p.service_id AND v.station_id=s.id AND v.company_id=v_company AND v.deleted_at IS NULL
      JOIN public.vehicle_categories cat ON cat.id=p.vehicle_category_id AND cat.station_id=s.id AND cat.company_id=v_company AND cat.deleted_at IS NULL
      WHERE p.company_id=v_company AND p.station_id=s.id),'[]'::jsonb)
  ) INTO v_result FROM public.stations s JOIN public.companies c ON c.id=s.company_id
  WHERE s.id=p_station_id AND s.company_id=v_company AND s.deleted_at IS NULL;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.my_station_setup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_station_setup(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_company_setup(p_station_id uuid, p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_lock(p_station_id, 'settings.manage'); k text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Données entreprise invalides' USING ERRCODE='23514'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('name','city','phone') OR jsonb_typeof(p_patch->k) <> 'string' THEN
      RAISE EXCEPTION 'Champ entreprise interdit ou invalide' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF p_patch ? 'name' AND length(btrim(p_patch->>'name')) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Nom entreprise invalide' USING ERRCODE='23514'; END IF;
  IF p_patch ? 'city' AND length(btrim(p_patch->>'city')) > 200 THEN
    RAISE EXCEPTION 'Ville invalide' USING ERRCODE='23514'; END IF;
  IF p_patch ? 'phone' AND NOT public.wg_valid_phone(p_patch->>'phone') THEN
    RAISE EXCEPTION 'Téléphone invalide' USING ERRCODE='23514'; END IF;
  UPDATE public.companies SET
    name=CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE name END,
    city=CASE WHEN p_patch ? 'city' THEN btrim(p_patch->>'city') ELSE city END,
    phone=CASE WHEN p_patch ? 'phone' THEN btrim(p_patch->>'phone') ELSE phone END
    WHERE id=v_company AND deleted_at IS NULL;
  PERFORM public.wg_setup_audit(v_company,p_station_id,'setup.company_updated','companies',v_company);
END $$;
REVOKE ALL ON FUNCTION public.save_company_setup(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_company_setup(uuid,jsonb) TO authenticated;

-- Lorsqu'une liste a été configurée, toute commande par clé doit la respecter.
-- Les stations historiques sans cette clé conservent leur comportement initial.
CREATE OR REPLACE FUNCTION public.ensure_payment_method(p_company uuid, p_station uuid, p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_label text; v_kind text; v_cash boolean; v_id uuid; v_settings jsonb; v_ui text;
BEGIN
  CASE p_key
    WHEN 'cash' THEN v_label := 'Espèces'; v_kind := 'cash'; v_cash := true; v_ui := 'especes';
    WHEN 'mobile_money' THEN v_label := 'Mobile Money'; v_kind := 'mobile_money'; v_cash := false; v_ui := 'mobile_money';
    WHEN 'wave' THEN v_label := 'Wave'; v_kind := 'mobile_money'; v_cash := false; v_ui := 'wave';
    WHEN 'orange_money' THEN v_label := 'Orange Money'; v_kind := 'mobile_money'; v_cash := false; v_ui := 'orange_money';
    WHEN 'mtn_momo' THEN v_label := 'MTN MoMo'; v_kind := 'mobile_money'; v_cash := false; v_ui := 'mtn_momo';
    WHEN 'card' THEN v_label := 'Carte'; v_kind := 'card'; v_cash := false; v_ui := 'carte';
    WHEN 'transfer' THEN v_label := 'Virement'; v_kind := 'transfer'; v_cash := false; v_ui := 'virement';
    ELSE RAISE EXCEPTION 'Moyen de paiement invalide' USING ERRCODE='23514';
  END CASE;
  -- Même verrou que save_station_setup : une désélection et un nouveau
  -- paiement ne peuvent pas être validés concurremment sur deux versions.
  SELECT settings INTO v_settings FROM public.stations WHERE id=p_station AND company_id=p_company AND deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Station introuvable' USING ERRCODE='P0002'; END IF;
  IF v_settings ? 'accepted_payment_methods' AND (
    jsonb_typeof(v_settings->'accepted_payment_methods') <> 'array'
    OR NOT ((v_settings->'accepted_payment_methods') ? v_ui)
  ) THEN RAISE EXCEPTION 'Moyen de paiement non accepté par cette station' USING ERRCODE='23514'; END IF;
  INSERT INTO public.payment_methods(company_id,station_id,key,label,kind,affects_cash)
  VALUES(p_company,p_station,p_key,v_label,v_kind,v_cash)
  ON CONFLICT(station_id,key) DO UPDATE SET active=true,label=EXCLUDED.label,kind=EXCLUDED.kind,affects_cash=EXCLUDED.affects_cash
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ensure_payment_method(uuid,uuid,text) FROM PUBLIC, anon, authenticated;

-- Reprend la validation de 055 en ajoutant uniquement le verrou de station
-- avant la lecture du catalogue et avant les verrous lavage/caisse.
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
  -- Même verrou que les éditions du catalogue : le total et les lignes sont
  -- calculés sur une seule version des prix, y compris sans paiement initial.
  SELECT activated INTO v_activated FROM public.stations
    WHERE id=p_station_id AND company_id=v_company AND deleted_at IS NULL FOR NO KEY UPDATE;
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

CREATE OR REPLACE FUNCTION public.record_payment(
  p_wash_id uuid, p_amount_minor bigint, p_payment_method_id uuid,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_station uuid; v_method record; v_session uuid; v_payment uuid; v_existing record;
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
  -- Toutes les entrées de paiement prennent la station avant le lavage et
  -- la caisse. Sans cela l'ancienne RPC (lavage -> station via trigger)
  -- et la RPC par clé (station -> lavage) pourraient s'interbloquer.
  SELECT * INTO v_wash FROM public.washes
    WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  v_station := v_wash.station_id;
  PERFORM 1 FROM public.stations WHERE id=v_station AND company_id=v_company AND deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Station introuvable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_wash FROM public.washes
    WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_wash.station_id IS DISTINCT FROM v_station THEN
    RAISE EXCEPTION 'Station de la fiche modifiée : réessayez' USING ERRCODE = '40001';
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

-- Une tentative déjà acceptée doit rester vérifiable même si le canal a été
-- désélectionné depuis. Réserver la clé avant de vérifier le canal pour les
-- seules écritures nouvelles ; comparer strictement le contenu au rejeu.
CREATE OR REPLACE FUNCTION public.record_wash_payment_by_key(
  p_wash_id uuid, p_amount_minor bigint, p_method_key text,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_wash record; v_existing record; v_method uuid;
BEGIN
  IF NOT public.has_permission('payments.create') THEN RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE='42501'; END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN RAISE EXCEPTION 'Montant invalide' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id=p_wash_id AND company_id=v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE='P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    IF length(p_idempotency_key) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Clé de paiement invalide' USING ERRCODE='23514'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || v_company::text || ':' || p_idempotency_key,0));
    SELECT p.*,pm.key AS method_key INTO v_existing FROM public.payments p
      LEFT JOIN public.payment_methods pm ON pm.id=p.payment_method_id
      WHERE p.company_id=v_company AND p.idempotency_key=p_idempotency_key;
    IF FOUND THEN
      IF NOT public.can_access_station(v_existing.station_id) THEN RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE='42501'; END IF;
      IF v_existing.wash_id IS DISTINCT FROM p_wash_id OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
        OR v_existing.method_key IS DISTINCT FROM p_method_key
        OR COALESCE(v_existing.reference,'') IS DISTINCT FROM COALESCE(p_reference,'') THEN
        RAISE EXCEPTION 'Clé déjà utilisée pour un autre paiement' USING ERRCODE='23505'; END IF;
      RETURN v_existing.id;
    END IF;
  END IF;
  v_method := public.ensure_payment_method(v_company,v_wash.station_id,p_method_key);
  RETURN public.record_payment(p_wash_id,p_amount_minor,v_method,p_reference,p_idempotency_key);
END $$;
REVOKE ALL ON FUNCTION public.record_wash_payment_by_key(uuid,bigint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_wash_payment_by_key(uuid,bigint,text,text,text) TO authenticated;

-- La RPC historique record_payment accepte aussi un identifiant de moyen :
-- vérifier également l'état au moment de l'insertion et sérialiser avec le
-- réglage de station. Ceci ne modifie jamais les paiements historiques.
CREATE OR REPLACE FUNCTION public.wg_check_station_payment_method()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_settings jsonb; v_key text; v_active boolean;
BEGIN
  SELECT settings INTO v_settings FROM public.stations
    WHERE id=NEW.station_id AND company_id=NEW.company_id AND deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Station introuvable' USING ERRCODE='P0002'; END IF;
  SELECT key,active INTO v_key,v_active FROM public.payment_methods
    WHERE id=NEW.payment_method_id AND station_id=NEW.station_id AND company_id=NEW.company_id;
  IF NOT FOUND OR NOT v_active OR (v_settings ? 'accepted_payment_methods' AND (
    jsonb_typeof(v_settings->'accepted_payment_methods') <> 'array'
    OR v_key NOT IN ('cash','mobile_money','wave','orange_money','mtn_momo','card','transfer')
    OR NOT ((v_settings->'accepted_payment_methods') ? public.payment_method_ui_key(v_key))
  )) THEN RAISE EXCEPTION 'Moyen de paiement non accepté par cette station' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wg_check_station_payment_method() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER wg_payment_method_active BEFORE INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.wg_check_station_payment_method();

CREATE OR REPLACE FUNCTION public.save_station_setup(p_station_id uuid, p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_lock(p_station_id, 'settings.manage');
  k text; v_settings jsonb; method text; dbkey text; n numeric;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Données station invalides' USING ERRCODE='23514'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('name','address','city','phone','hours','paymentMethods','commissionRate','monthlyTarget') THEN
      RAISE EXCEPTION 'Champ station interdit : %',k USING ERRCODE='23514'; END IF;
    IF k IN ('name','address','city','phone') AND jsonb_typeof(p_patch->k) <> 'string' THEN
      RAISE EXCEPTION 'Champ station invalide' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF p_patch ? 'name' AND length(btrim(p_patch->>'name')) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'Nom station invalide' USING ERRCODE='23514'; END IF;
  IF (p_patch ? 'city' AND length(btrim(p_patch->>'city')) > 200)
    OR (p_patch ? 'address' AND length(btrim(p_patch->>'address')) > 300) THEN
    RAISE EXCEPTION 'Adresse ou ville trop longue' USING ERRCODE='23514'; END IF;
  IF p_patch ? 'phone' AND NOT public.wg_valid_phone(p_patch->>'phone') THEN
    RAISE EXCEPTION 'Téléphone invalide' USING ERRCODE='23514'; END IF;
  IF p_patch ? 'hours' AND NOT public.wg_setup_hours_valid(p_patch->'hours') THEN
    RAISE EXCEPTION 'Horaires invalides : sept jours distincts et horaires valides requis' USING ERRCODE='23514'; END IF;
  IF p_patch ? 'paymentMethods' THEN
    IF jsonb_typeof(p_patch->'paymentMethods') <> 'array' OR jsonb_array_length(p_patch->'paymentMethods') > 7 THEN
      RAISE EXCEPTION 'Liste de moyens de paiement invalide' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch->'paymentMethods') x
      WHERE jsonb_typeof(x) <> 'string' OR trim(both '"' from x::text) NOT IN
        ('especes','mobile_money','wave','orange_money','mtn_momo','carte','virement'))
      OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(p_patch->'paymentMethods')) THEN
      RAISE EXCEPTION 'Moyens de paiement invalides ou en double' USING ERRCODE='23514'; END IF;
  END IF;
  FOR k IN SELECT unnest(ARRAY['commissionRate','monthlyTarget']) LOOP
    IF p_patch ? k THEN
      IF jsonb_typeof(p_patch->k) <> 'number' OR (p_patch->>k) !~ '^(0|[1-9][0-9]*)$' THEN
        RAISE EXCEPTION 'Valeur numérique invalide' USING ERRCODE='23514'; END IF;
      n := (p_patch->>k)::numeric;
      IF n > (CASE WHEN k='commissionRate' THEN 100 ELSE 1000000000000 END) THEN
        RAISE EXCEPTION 'Valeur numérique hors limites' USING ERRCODE='23514'; END IF;
    END IF;
  END LOOP;
  SELECT settings INTO v_settings FROM public.stations WHERE id=p_station_id AND company_id=v_company;
  IF jsonb_typeof(v_settings) <> 'object' THEN RAISE EXCEPTION 'Paramètres historiques illisibles' USING ERRCODE='23514'; END IF;
  IF p_patch ? 'paymentMethods' THEN v_settings := v_settings || jsonb_build_object('accepted_payment_methods',p_patch->'paymentMethods'); END IF;
  IF p_patch ? 'commissionRate' THEN v_settings := v_settings || jsonb_build_object('commission_rate',(p_patch->>'commissionRate')::numeric); END IF;
  IF p_patch ? 'monthlyTarget' THEN v_settings := v_settings || jsonb_build_object('monthly_target',(p_patch->>'monthlyTarget')::numeric); END IF;
  UPDATE public.stations SET
    name=CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE name END,
    address=CASE WHEN p_patch ? 'address' THEN btrim(p_patch->>'address') ELSE address END,
    city=CASE WHEN p_patch ? 'city' THEN btrim(p_patch->>'city') ELSE city END,
    phone=CASE WHEN p_patch ? 'phone' THEN btrim(p_patch->>'phone') ELSE phone END,
    hours=CASE WHEN p_patch ? 'hours' THEN p_patch->'hours' ELSE hours END,
    settings=v_settings WHERE id=p_station_id AND company_id=v_company;
  IF p_patch ? 'paymentMethods' THEN
    FOR method IN SELECT value FROM jsonb_array_elements_text(p_patch->'paymentMethods') LOOP
      dbkey := CASE method WHEN 'especes' THEN 'cash' WHEN 'carte' THEN 'card' WHEN 'virement' THEN 'transfer' ELSE method END;
      PERFORM public.ensure_payment_method(v_company,p_station_id,dbkey);
    END LOOP;
    -- Ne pas modifier les canaux historiques inconnus : ils peuvent encore
    -- servir aux rapprochements. Le trigger interdit de nouveaux paiements
    -- sur ces canaux tant qu'une liste explicite est configurée.
    UPDATE public.payment_methods SET active=false WHERE company_id=v_company AND station_id=p_station_id
      AND key IN ('cash','mobile_money','wave','orange_money','mtn_momo','card','transfer')
      AND NOT ((p_patch->'paymentMethods') ? public.payment_method_ui_key(key));
  END IF;
  PERFORM public.wg_setup_audit(v_company,p_station_id,'setup.station_updated','stations',p_station_id);
END $$;
REVOKE ALL ON FUNCTION public.save_station_setup(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_station_setup(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_station_category(p_station_id uuid, p_id uuid, p_name text, p_active boolean, p_remove boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_lock(p_station_id, 'catalog.manage'); v_id uuid;
BEGIN
  IF p_active IS NULL OR p_remove IS NULL OR (NOT p_remove AND (p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200)) THEN
    RAISE EXCEPTION 'Catégorie invalide' USING ERRCODE='23514'; END IF;
  IF p_id IS NULL THEN
    IF p_remove THEN RAISE EXCEPTION 'Catégorie introuvable' USING ERRCODE='P0002'; END IF;
    INSERT INTO public.vehicle_categories(company_id,station_id,name,active) VALUES(v_company,p_station_id,btrim(p_name),p_active) RETURNING id INTO v_id;
  ELSE
    UPDATE public.vehicle_categories SET name=CASE WHEN p_remove THEN name ELSE btrim(p_name) END,
      active=CASE WHEN p_remove THEN false ELSE p_active END, deleted_at=CASE WHEN p_remove THEN now() ELSE deleted_at END
      WHERE id=p_id AND company_id=v_company AND station_id=p_station_id AND deleted_at IS NULL RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Catégorie hors périmètre ou introuvable' USING ERRCODE='P0002'; END IF;
  END IF;
  PERFORM public.wg_setup_audit(v_company,p_station_id,'setup.category_updated','vehicle_categories',v_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_station_category(uuid,uuid,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_station_category(uuid,uuid,text,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_station_service(p_station_id uuid, p_id uuid, p_name text, p_description text, p_active boolean, p_remove boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_lock(p_station_id, 'catalog.manage'); v_id uuid;
BEGIN
  IF p_active IS NULL OR p_remove IS NULL OR (NOT p_remove AND (p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
    OR p_description IS NULL OR length(p_description)>2000)) THEN RAISE EXCEPTION 'Prestation invalide' USING ERRCODE='23514'; END IF;
  IF p_id IS NULL THEN
    IF p_remove THEN RAISE EXCEPTION 'Prestation introuvable' USING ERRCODE='P0002'; END IF;
    INSERT INTO public.services(company_id,station_id,name,description,active)
    VALUES(v_company,p_station_id,btrim(p_name),btrim(p_description),p_active) RETURNING id INTO v_id;
  ELSE
    UPDATE public.services SET name=CASE WHEN p_remove THEN name ELSE btrim(p_name) END,
      description=CASE WHEN p_remove THEN description ELSE btrim(p_description) END,
      active=CASE WHEN p_remove THEN false ELSE p_active END, deleted_at=CASE WHEN p_remove THEN now() ELSE deleted_at END
      WHERE id=p_id AND company_id=v_company AND station_id=p_station_id AND deleted_at IS NULL RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Prestation hors périmètre ou introuvable' USING ERRCODE='P0002'; END IF;
  END IF;
  PERFORM public.wg_setup_audit(v_company,p_station_id,'setup.service_updated','services',v_id);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_station_service(uuid,uuid,text,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_station_service(uuid,uuid,text,text,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_station_price(p_station_id uuid, p_service_id uuid, p_category_id uuid, p_price_minor bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_lock(p_station_id, 'catalog.manage'); v_old bigint; v_currency char(3);
BEGIN
  IF p_price_minor IS NULL OR p_price_minor NOT BETWEEN 0 AND 1000000000000 THEN
    RAISE EXCEPTION 'Prix invalide' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE id=p_service_id AND station_id=p_station_id AND company_id=v_company AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.vehicle_categories WHERE id=p_category_id AND station_id=p_station_id AND company_id=v_company AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Prestation ou catégorie hors périmètre' USING ERRCODE='42501'; END IF;
  SELECT currency_code INTO v_currency FROM public.stations WHERE id=p_station_id AND company_id=v_company;
  IF EXISTS (SELECT 1 FROM public.service_prices WHERE service_id=p_service_id AND vehicle_category_id=p_category_id
    AND (company_id<>v_company OR station_id<>p_station_id)) THEN
    RAISE EXCEPTION 'Tarif historique hors périmètre : vérification requise' USING ERRCODE='42501'; END IF;
  SELECT price_minor INTO v_old FROM public.service_prices WHERE service_id=p_service_id AND vehicle_category_id=p_category_id;
  INSERT INTO public.service_prices(company_id,station_id,service_id,vehicle_category_id,price_minor,currency_code)
  VALUES(v_company,p_station_id,p_service_id,p_category_id,p_price_minor,v_currency)
  ON CONFLICT(service_id,vehicle_category_id) DO UPDATE SET price_minor=EXCLUDED.price_minor, currency_code=EXCLUDED.currency_code;
  IF v_old IS DISTINCT FROM p_price_minor THEN
    INSERT INTO public.service_price_history(company_id,station_id,service_id,vehicle_category_id,old_price_minor,new_price_minor,changed_by)
    VALUES(v_company,p_station_id,p_service_id,p_category_id,v_old,p_price_minor,auth.uid());
    PERFORM public.wg_setup_audit(v_company,p_station_id,'setup.price_updated','services',p_service_id);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_station_price(uuid,uuid,uuid,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_station_price(uuid,uuid,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_station_setup(p_station_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.wg_setup_lock(p_station_id, 'settings.manage'); v_station public.stations%ROWTYPE;
BEGIN
  SELECT * INTO v_station FROM public.stations WHERE id=p_station_id AND company_id=v_company;
  IF v_station.activated THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id=v_company AND btrim(name)<>'' AND btrim(city)<>'' AND btrim(phone)<>'')
    OR btrim(v_station.name)='' OR btrim(v_station.address)='' OR btrim(v_station.city)=''
    OR NOT public.wg_setup_hours_valid(v_station.hours)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_station.hours) h WHERE h->>'closed'='false')
    OR jsonb_typeof(v_station.settings->'accepted_payment_methods') IS DISTINCT FROM 'array'
    OR jsonb_array_length(CASE WHEN jsonb_typeof(v_station.settings->'accepted_payment_methods')='array'
      THEN v_station.settings->'accepted_payment_methods' ELSE '[]'::jsonb END)=0
    OR NOT EXISTS (SELECT 1 FROM public.vehicle_categories WHERE company_id=v_company AND station_id=p_station_id AND active AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.services WHERE company_id=v_company AND station_id=p_station_id AND active AND deleted_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.services s CROSS JOIN public.vehicle_categories c
      WHERE s.company_id=v_company AND s.station_id=p_station_id AND s.active AND s.deleted_at IS NULL
        AND c.company_id=v_company AND c.station_id=p_station_id AND c.active AND c.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.service_prices p WHERE p.company_id=v_company AND p.station_id=p_station_id
          AND p.service_id=s.id AND p.vehicle_category_id=c.id AND p.price_minor>0)
    ) THEN RAISE EXCEPTION 'onboarding_incomplete' USING ERRCODE='23514'; END IF;
  UPDATE public.stations SET activated=true, activated_at=COALESCE(activated_at,now()) WHERE id=p_station_id AND company_id=v_company;
  PERFORM public.wg_setup_audit(v_company,p_station_id,'setup.station_activated','stations',p_station_id);
END $$;
REVOKE ALL ON FUNCTION public.activate_station_setup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_station_setup(uuid) TO authenticated;

-- Les politiques RLS historiques autorisaient des écritures directes sans la
-- permission fine. Les lectures restent sous RLS ; seules les RPC ci-dessus
-- peuvent modifier ces tables pour les rôles client.
REVOKE INSERT, UPDATE, DELETE ON public.companies, public.stations, public.vehicle_categories,
  public.services, public.service_prices, public.payment_methods FROM PUBLIC, anon, authenticated;
