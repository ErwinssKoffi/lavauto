-- 035 — Prompt 08 : commandes CRM, fidélité, forfaits, promotions et flottes.
-- Toutes les écritures passent par des RPC SECURITY DEFINER ; le tenant est
-- déduit de auth.uid(), jamais fourni par le navigateur.
CREATE OR REPLACE FUNCTION public.assert_crm_station(p_station_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF p_station_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL
  ) OR NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_customer_profile(
  p_station_id uuid, p_name text, p_phone text DEFAULT '', p_email text DEFAULT '',
  p_notes text DEFAULT '', p_channel text DEFAULT 'none',
  p_loyalty_opt_in boolean DEFAULT false, p_customer_id uuid DEFAULT NULL,
  p_fleet_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_channel text := lower(btrim(COALESCE(p_channel, 'none')));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('customers.manage') THEN
    RAISE EXCEPTION 'Permission customers.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF length(v_name) < 2 OR v_channel NOT IN ('none','sms','email','whatsapp') THEN
    RAISE EXCEPTION 'Fiche client invalide' USING ERRCODE = '23514';
  END IF;
  IF p_fleet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleets f
    WHERE f.id = p_fleet_id AND f.company_id = v_company
      AND f.station_id = p_station_id AND f.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Flotte hors perimetre' USING ERRCODE = '42501'; END IF;
  IF p_customer_id IS NOT NULL THEN
    UPDATE public.customers SET
      name = v_name, phone = btrim(COALESCE(p_phone, '')),
      email = btrim(COALESCE(p_email, '')), notes = btrim(COALESCE(p_notes, '')),
      preferred_channel = v_channel, loyalty_opt_in = COALESCE(p_loyalty_opt_in, false),
      customer_type = CASE WHEN p_fleet_id IS NOT NULL THEN 'fleet' ELSE 'individual' END,
      fleet_id = p_fleet_id,
      communication_preferences = jsonb_build_object('channel', v_channel, 'optIn', COALESCE(p_loyalty_opt_in, false)),
      updated_at = clock_timestamp()
    WHERE id = p_customer_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL;
    IF FOUND THEN RETURN p_customer_id; END IF;
    RAISE EXCEPTION 'Client introuvable' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.customers (company_id, station_id, name, phone, email, notes,
    preferred_channel, loyalty_opt_in, customer_type, fleet_id, communication_preferences)
  VALUES (v_company, p_station_id, v_name, btrim(COALESCE(p_phone, '')),
    btrim(COALESCE(p_email, '')), btrim(COALESCE(p_notes, '')), v_channel,
    COALESCE(p_loyalty_opt_in, false),
    CASE WHEN p_fleet_id IS NOT NULL THEN 'fleet' ELSE 'individual' END, p_fleet_id,
    jsonb_build_object('channel', v_channel, 'optIn', COALESCE(p_loyalty_opt_in, false)))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_customer_vehicle(
  p_station_id uuid, p_customer_id uuid, p_plate text,
  p_brand text DEFAULT '', p_model text DEFAULT '', p_color text DEFAULT '',
  p_category_id uuid DEFAULT NULL, p_vehicle_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_plate text := upper(btrim(COALESCE(p_plate, '')));
  v_id uuid;
  v_fleet uuid;
BEGIN
  IF NOT public.has_permission('customers.manage') THEN
    RAISE EXCEPTION 'Permission customers.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  SELECT fleet_id INTO v_fleet FROM public.customers
  WHERE id = p_customer_id AND company_id = v_company
    AND station_id = p_station_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable' USING ERRCODE = 'P0002'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_categories c
    WHERE c.id = p_category_id AND c.company_id = v_company
      AND c.station_id = p_station_id AND c.active
  ) THEN RAISE EXCEPTION 'Categorie vehicule invalide' USING ERRCODE = '23514'; END IF;
  IF v_plate <> '' AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.company_id = v_company AND upper(v.plate) = v_plate
      AND v.deleted_at IS NULL AND v.id IS DISTINCT FROM p_vehicle_id
  ) THEN RAISE EXCEPTION 'Plaque deja utilisee' USING ERRCODE = '23514'; END IF;
  IF p_vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles SET
      customer_id = p_customer_id, plate = v_plate,
      brand = btrim(COALESCE(p_brand, '')), model = btrim(COALESCE(p_model, '')),
      color = btrim(COALESCE(p_color, '')), vehicle_category_id = p_category_id,
      fleet_id = v_fleet, is_active = true, updated_at = clock_timestamp()
    WHERE id = p_vehicle_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL;
    IF FOUND THEN RETURN p_vehicle_id; END IF;
    RAISE EXCEPTION 'Vehicule introuvable' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.vehicles (company_id, station_id, customer_id,
    vehicle_category_id, plate, brand, model, color, fleet_id)
  VALUES (v_company, p_station_id, p_customer_id, p_category_id, v_plate,
    btrim(COALESCE(p_brand, '')), btrim(COALESCE(p_model, '')),
    btrim(COALESCE(p_color, '')), v_fleet)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_loyalty_program(
  p_station_id uuid, p_name text, p_points_per_1000_minor integer DEFAULT 1,
  p_redemption_threshold integer DEFAULT 100, p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('loyalty.manage') THEN
    RAISE EXCEPTION 'Permission loyalty.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF length(v_name) < 2 OR COALESCE(p_points_per_1000_minor, 0) <= 0
    OR COALESCE(p_redemption_threshold, 0) <= 0 THEN
    RAISE EXCEPTION 'Programme de fidelite invalide' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_id FROM public.loyalty_programs
  WHERE company_id = v_company AND station_id = p_station_id
    AND lower(name) = lower(v_name) AND deleted_at IS NULL;
  IF FOUND THEN
    UPDATE public.loyalty_programs SET
      points_per_1000_minor = p_points_per_1000_minor,
      redemption_threshold = p_redemption_threshold,
      active = COALESCE(p_active, true), updated_at = clock_timestamp()
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.loyalty_programs (company_id, station_id, name,
    points_per_1000_minor, redemption_threshold, active)
  VALUES (v_company, p_station_id, v_name, p_points_per_1000_minor,
    p_redemption_threshold, COALESCE(p_active, true))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.enroll_loyalty_customer(
  p_station_id uuid, p_customer_id uuid, p_program_id uuid,
  p_card_number text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_number text := upper(btrim(COALESCE(p_card_number, '')));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('loyalty.manage') THEN
    RAISE EXCEPTION 'Permission loyalty.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF NOT EXISTS (SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.loyalty_programs
      WHERE id = p_program_id AND company_id = v_company
        AND station_id = p_station_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Client ou programme hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_number = '' THEN v_number := 'LC-' || replace(gen_random_uuid()::text, '-', ''); END IF;
  INSERT INTO public.loyalty_cards (company_id, station_id, customer_id,
    program_id, card_number)
  VALUES (v_company, p_station_id, p_customer_id, p_program_id, v_number)
  ON CONFLICT (company_id, customer_id, program_id) DO UPDATE
    SET status = 'active', updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_loyalty_transaction(
  p_card_id uuid, p_kind text, p_points_delta integer,
  p_reason text DEFAULT '', p_wash_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_card record;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_id uuid;
  v_balance integer;
BEGIN
  IF NOT public.has_permission('loyalty.manage') THEN
    RAISE EXCEPTION 'Permission loyalty.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Aucune entreprise rattachee' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_card FROM public.loyalty_cards
  WHERE id = p_card_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Carte de fidelite introuvable' USING ERRCODE = 'P0002'; END IF;
  IF p_kind NOT IN ('earn','redeem','adjustment') OR COALESCE(p_points_delta, 0) = 0
    OR (p_kind = 'earn' AND p_points_delta < 0)
    OR (p_kind = 'redeem' AND p_points_delta > 0) THEN
    RAISE EXCEPTION 'Transaction de fidelite invalide' USING ERRCODE = '23514';
  END IF;
  v_balance := v_card.points_balance + p_points_delta;
  IF v_balance < 0 THEN RAISE EXCEPTION 'Solde de points insuffisant' USING ERRCODE = '23514'; END IF;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.loyalty_transactions
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.loyalty_transactions (company_id, station_id, card_id,
    wash_id, kind, points_delta, reason, idempotency_key, created_by)
  VALUES (v_company, v_card.station_id, p_card_id, p_wash_id, p_kind,
    p_points_delta, btrim(COALESCE(p_reason, '')), v_key, auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.loyalty_cards SET points_balance = v_balance,
    updated_at = clock_timestamp() WHERE id = p_card_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.accrue_loyalty_for_wash(
  p_wash_id uuid, p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_card record; v_program record;
  v_points integer; v_key text; v_tx uuid;
BEGIN
  IF NOT (public.has_permission('loyalty.manage') OR public.has_permission('customers.manage')) THEN
    RAISE EXCEPTION 'Permission loyalty.manage ou customers.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Aucune entreprise rattachee' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_wash FROM public.washes
  WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  v_key := COALESCE(NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''), 'loyalty:' || p_wash_id::text);
  IF EXISTS (SELECT 1 FROM public.loyalty_transactions
    WHERE company_id = v_company AND idempotency_key = v_key) THEN
    RETURN jsonb_build_object('points', 0, 'duplicate', true);
  END IF;
  SELECT lc.* INTO v_card FROM public.loyalty_cards lc
  WHERE lc.company_id = v_company AND lc.customer_id = v_wash.customer_id
    AND lc.status = 'active' ORDER BY lc.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('points', 0, 'duplicate', false, 'reason', 'no_card'); END IF;
  SELECT * INTO v_program FROM public.loyalty_programs
  WHERE id = v_card.program_id AND company_id = v_company AND active AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('points', 0, 'duplicate', false, 'reason', 'inactive_program'); END IF;
  v_points := floor((v_wash.total_minor + v_wash.discount_minor)::numeric / 1000)::integer
    * v_program.points_per_1000_minor;
  IF v_points <= 0 THEN RETURN jsonb_build_object('points', 0, 'duplicate', false, 'reason', 'below_threshold'); END IF;
  INSERT INTO public.loyalty_transactions (company_id, station_id, card_id,
    wash_id, kind, points_delta, reason, idempotency_key, created_by)
  VALUES (v_company, v_wash.station_id, v_card.id, p_wash_id, 'earn',
    v_points, 'Points gagnes sur lavage', v_key, auth.uid())
  RETURNING id INTO v_tx;
  UPDATE public.loyalty_cards SET points_balance = points_balance + v_points,
    updated_at = clock_timestamp() WHERE id = v_card.id;
  UPDATE public.washes SET loyalty_points_earned = loyalty_points_earned + v_points,
    updated_at = clock_timestamp() WHERE id = p_wash_id;
  RETURN jsonb_build_object('points', v_points, 'duplicate', false, 'transactionId', v_tx);
END $$;

CREATE OR REPLACE FUNCTION public.save_package_plan(
  p_station_id uuid, p_name text, p_price_minor bigint,
  p_wash_count integer, p_validity_days integer,
  p_starts_at date DEFAULT current_date, p_ends_at date DEFAULT NULL,
  p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('packages.manage') THEN
    RAISE EXCEPTION 'Permission packages.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF length(v_name) < 2 OR COALESCE(p_price_minor, -1) < 0
    OR COALESCE(p_wash_count, 0) <= 0 OR COALESCE(p_validity_days, 0) <= 0
    OR p_starts_at IS NULL OR (p_ends_at IS NOT NULL AND p_ends_at < p_starts_at) THEN
    RAISE EXCEPTION 'Forfait invalide' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_id FROM public.packages
  WHERE company_id = v_company AND station_id = p_station_id
    AND lower(name) = lower(v_name) AND deleted_at IS NULL;
  IF FOUND THEN
    UPDATE public.packages SET price_minor = p_price_minor,
      wash_count = p_wash_count, validity_days = p_validity_days,
      starts_at = p_starts_at, ends_at = p_ends_at,
      active = COALESCE(p_active, true), updated_at = clock_timestamp()
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.packages (company_id, station_id, name, price_minor,
    wash_count, validity_days, starts_at, ends_at, active)
  VALUES (v_company, p_station_id, v_name, p_price_minor, p_wash_count,
    p_validity_days, p_starts_at, p_ends_at, COALESCE(p_active, true))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.sell_package_to_customer(
  p_station_id uuid, p_customer_id uuid, p_package_id uuid,
  p_purchased_at date DEFAULT current_date,
  p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_package record; v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_id uuid;
BEGIN
  IF NOT public.has_permission('packages.manage') THEN
    RAISE EXCEPTION 'Permission packages.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF NOT EXISTS (SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Client hors perimetre' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_package FROM public.packages
  WHERE id = p_package_id AND company_id = v_company
    AND station_id = p_station_id AND active AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Forfait introuvable ou inactif' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(p_purchased_at, current_date) < v_package.starts_at
    OR (v_package.ends_at IS NOT NULL AND COALESCE(p_purchased_at, current_date) > v_package.ends_at)
    OR current_date > COALESCE(v_package.ends_at, current_date) THEN
    RAISE EXCEPTION 'Forfait hors periode de validite' USING ERRCODE = '23514';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.customer_packages
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.customer_packages (company_id, station_id, customer_id,
    package_id, purchased_at, expires_at, washes_remaining, status, idempotency_key)
  VALUES (v_company, p_station_id, p_customer_id, p_package_id,
    COALESCE(p_purchased_at, current_date),
    COALESCE(p_purchased_at, current_date) + (v_package.validity_days - 1),
    v_package.wash_count, 'active', v_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.consume_package_for_wash(p_wash_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_cp record; v_key text; v_usage uuid;
BEGIN
  IF NOT (public.has_permission('packages.manage') OR public.has_permission('washes.update_status')) THEN
    RAISE EXCEPTION 'Permission packages.manage ou washes.update_status requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Aucune entreprise rattachee' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_wash FROM public.washes
  WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_wash.status = 'cancelled' THEN RAISE EXCEPTION 'Fiche annulee' USING ERRCODE = '23514'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  IF v_wash.package_id IS NOT NULL THEN
    RETURN jsonb_build_object('consumed', false, 'duplicate', true, 'customerPackageId', v_wash.package_id);
  END IF;
  SELECT cp.* INTO v_cp FROM public.customer_packages cp
  JOIN public.packages pk ON pk.id = cp.package_id AND pk.company_id = v_company
    AND pk.active AND pk.deleted_at IS NULL
    AND current_date >= pk.starts_at
    AND (pk.ends_at IS NULL OR current_date <= pk.ends_at)
  WHERE cp.company_id = v_company AND cp.customer_id = v_wash.customer_id
    AND cp.status = 'active' AND cp.washes_remaining > 0
    AND cp.expires_at >= current_date
  ORDER BY cp.expires_at, cp.created_at LIMIT 1 FOR UPDATE OF cp;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('consumed', false, 'duplicate', false, 'reason', 'no_active_package');
  END IF;
  v_key := 'package:' || p_wash_id::text;
  INSERT INTO public.package_usages (company_id, station_id, customer_package_id,
    wash_id, idempotency_key, created_by)
  VALUES (v_company, v_wash.station_id, v_cp.id, p_wash_id, v_key, auth.uid())
  ON CONFLICT (company_id, wash_id) DO NOTHING RETURNING id INTO v_usage;
  IF v_usage IS NULL THEN
    RETURN jsonb_build_object('consumed', false, 'duplicate', true, 'customerPackageId', v_cp.id);
  END IF;
  UPDATE public.customer_packages SET
    washes_remaining = washes_remaining - 1,
    status = CASE WHEN washes_remaining - 1 = 0 THEN 'exhausted' ELSE 'active' END,
    updated_at = clock_timestamp()
  WHERE id = v_cp.id;
  UPDATE public.washes SET package_id = v_cp.id,
    updated_at = clock_timestamp()
  WHERE id = p_wash_id;
  RETURN jsonb_build_object('consumed', true, 'duplicate', false,
    'customerPackageId', v_cp.id, 'remaining', v_cp.washes_remaining - 1);
END $$;

CREATE OR REPLACE FUNCTION public.save_promotion(
  p_station_id uuid, p_name text, p_code text, p_kind text,
  p_value integer, p_starts_at date DEFAULT current_date,
  p_ends_at date DEFAULT (current_date + 30), p_max_usages integer DEFAULT NULL,
  p_min_amount_minor bigint DEFAULT 0, p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('promotions.manage') THEN
    RAISE EXCEPTION 'Permission promotions.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF length(v_name) < 2 OR length(v_code) < 2 OR p_kind NOT IN ('percent','amount')
    OR COALESCE(p_value, 0) <= 0 OR (p_kind = 'percent' AND p_value > 100)
    OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at < p_starts_at
    OR COALESCE(p_min_amount_minor, -1) < 0
    OR (p_max_usages IS NOT NULL AND p_max_usages <= 0) THEN
    RAISE EXCEPTION 'Promotion invalide' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_id FROM public.promotions
  WHERE company_id = v_company AND station_id = p_station_id
    AND upper(code) = v_code AND deleted_at IS NULL;
  IF FOUND THEN
    UPDATE public.promotions SET name = v_name, kind = p_kind, value = p_value,
      min_amount_minor = COALESCE(p_min_amount_minor, 0),
      max_usages = p_max_usages, starts_at = p_starts_at, ends_at = p_ends_at,
      active = COALESCE(p_active, true), updated_at = clock_timestamp()
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.promotions (company_id, station_id, name, code, kind,
    value, min_amount_minor, max_usages, starts_at, ends_at, active)
  VALUES (v_company, p_station_id, v_name, v_code, p_kind, p_value,
    COALESCE(p_min_amount_minor, 0), p_max_usages, p_starts_at, p_ends_at,
    COALESCE(p_active, true))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.apply_promotion_to_wash(
  p_wash_id uuid, p_code text, p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_wash record; v_promo record; v_existing record;
  v_base bigint; v_discount bigint; v_key text; v_usage uuid;
BEGIN
  IF NOT (public.has_permission('promotions.manage') OR public.has_permission('customers.manage')) THEN
    RAISE EXCEPTION 'Permission promotions.manage ou customers.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Aucune entreprise rattachee' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_wash FROM public.washes
  WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_wash.status = 'cancelled' THEN RAISE EXCEPTION 'Fiche annulee' USING ERRCODE = '23514'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.wash_id = p_wash_id) THEN
    RAISE EXCEPTION 'Promotion impossible apres encaissement' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_promo FROM public.promotions
  WHERE company_id = v_company AND station_id = v_wash.station_id
    AND upper(code) = v_code AND active AND deleted_at IS NULL
    AND current_date BETWEEN starts_at AND ends_at FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promotion inactive ou hors validite' USING ERRCODE = '23514'; END IF;
  IF v_promo.max_usages IS NOT NULL AND v_promo.usage_count >= v_promo.max_usages THEN
    RAISE EXCEPTION 'Quota de promotion atteint' USING ERRCODE = '23514';
  END IF;
  v_base := v_wash.total_minor + v_wash.discount_minor;
  IF v_base < v_promo.min_amount_minor THEN
    RAISE EXCEPTION 'Montant minimum non atteint' USING ERRCODE = '23514';
  END IF;
  v_discount := CASE WHEN v_promo.kind = 'percent'
    THEN LEAST(v_base, ROUND(v_base::numeric * v_promo.value / 100)::bigint)
    ELSE LEAST(v_base, v_promo.value::bigint) END;
  IF v_discount <= 0 THEN RAISE EXCEPTION 'Remise nulle interdite' USING ERRCODE = '23514'; END IF;
  v_key := COALESCE(NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
    'promo:' || p_wash_id::text || ':' || v_promo.id::text);
  SELECT * INTO v_existing FROM public.promotion_usages
  WHERE company_id = v_company AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('applied', false, 'duplicate', true,
      'discountMinor', v_existing.discount_minor, 'promotionId', v_existing.promotion_id);
  END IF;
  IF v_wash.promotion_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.promotion_usages
    WHERE company_id = v_company AND wash_id = p_wash_id
  ) THEN RAISE EXCEPTION 'Une seule promotion par fiche' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.promotion_usages (company_id, station_id, promotion_id,
    wash_id, customer_id, discount_minor, idempotency_key, created_by)
  VALUES (v_company, v_wash.station_id, v_promo.id, p_wash_id,
    v_wash.customer_id, v_discount, v_key, auth.uid())
  RETURNING id INTO v_usage;
  UPDATE public.promotions SET usage_count = usage_count + 1,
    updated_at = clock_timestamp() WHERE id = v_promo.id;
  UPDATE public.washes SET
    discount_minor = v_wash.discount_minor + v_discount,
    total_minor = GREATEST(0, v_base - v_wash.discount_minor - v_discount),
    promotion_id = v_promo.id, promotion_discount_minor = v_discount,
    updated_at = clock_timestamp()
  WHERE id = p_wash_id;
  RETURN jsonb_build_object('applied', true, 'duplicate', false,
    'discountMinor', v_discount, 'promotionId', v_promo.id, 'usageId', v_usage);
END $$;

CREATE OR REPLACE FUNCTION public.save_fleet(
  p_station_id uuid, p_name text, p_contact_name text DEFAULT '',
  p_phone text DEFAULT '', p_email text DEFAULT '',
  p_credit_limit_minor bigint DEFAULT 0,
  p_channel text DEFAULT 'none', p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_name text := btrim(COALESCE(p_name, ''));
  v_channel text := lower(btrim(COALESCE(p_channel, 'none')));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('fleets.manage') THEN
    RAISE EXCEPTION 'Permission fleets.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF length(v_name) < 2 OR COALESCE(p_credit_limit_minor, -1) < 0
    OR v_channel NOT IN ('none','sms','email','whatsapp') THEN
    RAISE EXCEPTION 'Flotte invalide' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO v_id FROM public.fleets
  WHERE company_id = v_company AND station_id = p_station_id
    AND lower(name) = lower(v_name) AND deleted_at IS NULL;
  IF FOUND THEN
    UPDATE public.fleets SET contact_name = btrim(COALESCE(p_contact_name, '')),
      phone = btrim(COALESCE(p_phone, '')), email = btrim(COALESCE(p_email, '')),
      credit_limit_minor = p_credit_limit_minor, preferred_channel = v_channel,
      active = COALESCE(p_active, true), updated_at = clock_timestamp()
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.fleets (company_id, station_id, name, contact_name,
    phone, email, credit_limit_minor, preferred_channel, active)
  VALUES (v_company, p_station_id, v_name,
    btrim(COALESCE(p_contact_name, '')), btrim(COALESCE(p_phone, '')),
    btrim(COALESCE(p_email, '')), p_credit_limit_minor, v_channel,
    COALESCE(p_active, true))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_fleet_contract(
  p_station_id uuid, p_fleet_id uuid, p_number text,
  p_start_date date DEFAULT current_date,
  p_end_date date DEFAULT (current_date + 365),
  p_discount_percent integer DEFAULT 0,
  p_credit_limit_minor bigint DEFAULT 0,
  p_status text DEFAULT 'active'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_number text := upper(btrim(COALESCE(p_number, '')));
  v_id uuid;
BEGIN
  IF NOT public.has_permission('fleets.manage') THEN
    RAISE EXCEPTION 'Permission fleets.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF length(v_number) < 2 OR p_start_date IS NULL OR p_end_date IS NULL
    OR p_end_date < p_start_date OR COALESCE(p_discount_percent, -1) NOT BETWEEN 0 AND 100
    OR COALESCE(p_credit_limit_minor, -1) < 0
    OR p_status NOT IN ('draft','active','suspended','closed') THEN
    RAISE EXCEPTION 'Contrat de flotte invalide' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fleets
    WHERE id = p_fleet_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Flotte hors perimetre' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM public.fleet_contracts
  WHERE company_id = v_company AND upper(number) = v_number AND fleet_id = p_fleet_id;
  IF FOUND THEN
    UPDATE public.fleet_contracts SET
      start_date = p_start_date, end_date = p_end_date,
      discount_percent = p_discount_percent,
      credit_limit_minor = p_credit_limit_minor,
      status = p_status, updated_at = clock_timestamp()
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.fleet_contracts
    WHERE company_id = v_company AND upper(number) = v_number) THEN
    RAISE EXCEPTION 'Numero de contrat deja utilise par une autre flotte' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.fleet_contracts (company_id, station_id, fleet_id,
    number, start_date, end_date, discount_percent, credit_limit_minor, status)
  VALUES (v_company, p_station_id, p_fleet_id, v_number, p_start_date,
    p_end_date, p_discount_percent, p_credit_limit_minor, p_status)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.attach_fleet_vehicle(
  p_station_id uuid, p_fleet_id uuid, p_vehicle_id uuid,
  p_contract_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_id uuid;
BEGIN
  IF NOT public.has_permission('fleets.manage') THEN
    RAISE EXCEPTION 'Permission fleets.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF NOT EXISTS (SELECT 1 FROM public.fleets
    WHERE id = p_fleet_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.vehicles
      WHERE id = p_vehicle_id AND company_id = v_company
        AND station_id = p_station_id AND deleted_at IS NULL)
    OR (p_contract_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.fleet_contracts
      WHERE id = p_contract_id AND company_id = v_company
        AND station_id = p_station_id AND fleet_id = p_fleet_id
    )) THEN
    RAISE EXCEPTION 'Flotte, vehicule ou contrat hors perimetre' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM public.fleet_vehicles
  WHERE company_id = v_company AND fleet_id = p_fleet_id
    AND vehicle_id = p_vehicle_id AND active;
  IF FOUND THEN
    UPDATE public.fleet_vehicles SET contract_id = p_contract_id,
      updated_at = clock_timestamp() WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.fleet_vehicles (company_id, station_id, fleet_id,
    vehicle_id, contract_id)
  VALUES (v_company, p_station_id, p_fleet_id, p_vehicle_id, p_contract_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_fleet_receivable(
  p_station_id uuid, p_fleet_id uuid, p_contract_id uuid,
  p_amount_minor bigint, p_wash_id uuid DEFAULT NULL,
  p_due_date date DEFAULT current_date,
  p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_contract record; v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_open bigint; v_id uuid;
BEGIN
  IF NOT public.has_permission('fleets.manage') THEN
    RAISE EXCEPTION 'Permission fleets.manage requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF COALESCE(p_amount_minor, 0) <= 0 THEN
    RAISE EXCEPTION 'Creance invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_contract FROM public.fleet_contracts
  WHERE id = p_contract_id AND company_id = v_company
    AND station_id = p_station_id AND fleet_id = p_fleet_id
    AND status = 'active' AND current_date BETWEEN start_date AND end_date;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrat de flotte inactif' USING ERRCODE = '23514'; END IF;
  IF p_wash_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.washes WHERE id = p_wash_id
      AND company_id = v_company AND station_id = p_station_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Fiche hors perimetre' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(amount_minor), 0) INTO v_open FROM public.fleet_receivables
  WHERE company_id = v_company AND fleet_id = p_fleet_id
    AND contract_id = p_contract_id AND status = 'open';
  IF v_open + p_amount_minor > v_contract.credit_limit_minor THEN
    RAISE EXCEPTION 'Limite de credit flotte depassee' USING ERRCODE = '23514';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.fleet_receivables
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.fleet_receivables (company_id, station_id, fleet_id,
    contract_id, wash_id, amount_minor, due_date, status, idempotency_key)
  VALUES (v_company, p_station_id, p_fleet_id, p_contract_id, p_wash_id,
    p_amount_minor, COALESCE(p_due_date, current_date), 'open', v_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'save_customer_profile','save_customer_vehicle','create_loyalty_program',
      'enroll_loyalty_customer','record_loyalty_transaction','accrue_loyalty_for_wash',
      'save_package_plan','sell_package_to_customer','consume_package_for_wash',
      'save_promotion','apply_promotion_to_wash','save_fleet',
      'save_fleet_contract','attach_fleet_vehicle','record_fleet_receivable'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assert_crm_station'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
