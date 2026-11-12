-- 038 — Prompt 08 : ordre correct de l'idempotence des promotions.
-- Correctif ADDITIF : une clé déjà vue répond « duplicate » AVANT le contrôle
-- de quota. Aucune réécriture de 001–037, aucune donnée, aucun envoi simulé.
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
  -- 1. Une clé explicite déjà consommée est un doublon, jamais une nouvelle
  --    consommation de quota.
  v_key := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.promotion_usages
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('applied', false, 'duplicate', true,
        'discountMinor', v_existing.discount_minor, 'promotionId', v_existing.promotion_id);
    END IF;
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
  -- 2. Clé dérivée par défaut : vérifiée après lecture de la promotion mais
  --    avant toute insertion ou incrémentation du compteur.
  IF v_key IS NULL THEN
    v_key := 'promo:' || p_wash_id::text || ':' || v_promo.id::text;
    SELECT * INTO v_existing FROM public.promotion_usages
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('applied', false, 'duplicate', true,
        'discountMinor', v_existing.discount_minor, 'promotionId', v_existing.promotion_id);
    END IF;
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

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'apply_promotion_to_wash'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
