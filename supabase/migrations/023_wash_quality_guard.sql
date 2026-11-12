-- 023 — Prompt 05 : contrôle qualité obligatoire, postes et clients par station
-- Correction additive après 021/022 (déjà appliqués) : ne jamais réappliquer
-- 021/022. Aucune donnée, aucun compte, aucun identifiant d'entreprise reçu.

-- 1. « ready » n'est accessible QUE depuis record_wash_quality_check().
-- Un GUC local à la transaction est posé par cette RPC ; il est remis à vide
-- immédiatement après la transition. transition_wash_status() reste publiable
-- mais refuse désormais tout appel direct vers ready.
CREATE OR REPLACE FUNCTION public.transition_wash_status(
  p_wash_id uuid, p_to_status text, p_reason text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_from text; v_allowed boolean; v_reason text;
BEGIN
  IF NOT (
    public.has_permission('washes.update_status')
    OR (p_to_status = 'assigned' AND public.has_permission('washes.assign'))
    OR (p_to_status IN ('quality_check','ready','delivered') AND public.has_permission('washes.quality'))
  ) THEN
    RAISE EXCEPTION 'Permission de changement de statut requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wash FROM public.washes
    WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  v_from := v_wash.status;
  v_allowed := CASE p_to_status
    WHEN 'assigned' THEN v_from = 'pending'
    WHEN 'in_progress' THEN v_from IN ('assigned','quality_check')
    WHEN 'quality_check' THEN v_from = 'in_progress'
    WHEN 'ready' THEN v_from = 'quality_check'
    WHEN 'delivered' THEN v_from = 'ready'
    WHEN 'cancelled' THEN v_from NOT IN ('cancelled','delivered')
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transition de statut invalide : % → %', v_from, p_to_status USING ERRCODE = '23514';
  END IF;
  IF p_to_status = 'ready' AND COALESCE(current_setting('washguard.quality_approved', true), '') <> '1' THEN
    RAISE EXCEPTION 'Le statut ready exige un contrôle qualité approuvé' USING ERRCODE = '23514';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));
  IF p_to_status = 'cancelled' AND v_reason = '' THEN
    RAISE EXCEPTION 'Motif d’annulation requis' USING ERRCODE = '23514';
  END IF;
  UPDATE public.washes SET
    status = p_to_status,
    finished_at = CASE WHEN p_to_status = 'ready' THEN now() ELSE finished_at END,
    delivered_at = CASE WHEN p_to_status = 'delivered' THEN now() ELSE delivered_at END,
    cancelled_at = CASE WHEN p_to_status = 'cancelled' THEN now() ELSE cancelled_at END,
    cancelled_reason = CASE WHEN p_to_status = 'cancelled' THEN v_reason ELSE cancelled_reason END,
    updated_at = now()
  WHERE id = p_wash_id;
  INSERT INTO public.wash_status_history (company_id, station_id, wash_id, from_status, to_status, actor_user_id, reason)
  VALUES (v_company, v_wash.station_id, p_wash_id, v_from, p_to_status, auth.uid(), NULLIF(v_reason, ''));
END $$;

-- 2. Approbation = unique chemin quality_check → ready ; refus = reprise tracée.
CREATE OR REPLACE FUNCTION public.record_wash_quality_check(
  p_wash_id uuid, p_result text, p_notes text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_wash record; v_notes text := btrim(COALESCE(p_notes, ''));
BEGIN
  IF NOT public.has_permission('washes.quality') THEN
    RAISE EXCEPTION 'Permission washes.quality requise' USING ERRCODE = '42501';
  END IF;
  IF p_result NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Résultat de contrôle qualité invalide' USING ERRCODE = '23514';
  END IF;
  IF p_result = 'rejected' AND v_notes = '' THEN
    RAISE EXCEPTION 'Motif de reprise requis' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_wash FROM public.washes
    WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  IF v_wash.status <> 'quality_check' THEN
    RAISE EXCEPTION 'Contrôle qualité disponible uniquement au statut quality_check' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.wash_quality_checks (company_id, station_id, wash_id, checked_by, result, notes)
  VALUES (v_company, v_wash.station_id, p_wash_id, auth.uid(), p_result, v_notes);
  IF p_result = 'approved' THEN
    PERFORM set_config('washguard.quality_approved', '1', true);
    PERFORM public.transition_wash_status(p_wash_id, 'ready', 'Contrôle qualité validé');
    PERFORM set_config('washguard.quality_approved', '', true);
  ELSE
    PERFORM public.transition_wash_status(p_wash_id, 'in_progress', 'Contrôle qualité refusé : ' || v_notes);
  END IF;
END $$;

-- 3. Création d'un poste sur la station courante (ou station explicitement
-- accessible), au lieu de la première affectation arbitraire de l'utilisateur.
DROP FUNCTION IF EXISTS public.create_wash_post(text, integer);
CREATE OR REPLACE FUNCTION public.create_wash_post(
  p_name text, p_capacity integer DEFAULT 1, p_station_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_station uuid := p_station_id; v_post uuid; v_name text := btrim(COALESCE(p_name, ''));
BEGIN
  IF NOT public.has_permission('washes.assign') THEN
    RAISE EXCEPTION 'Permission washes.assign requise' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) < 2 OR COALESCE(p_capacity, 0) < 1 THEN
    RAISE EXCEPTION 'Nom ou capacité de poste invalide' USING ERRCODE = '23514';
  END IF;
  IF v_station IS NULL THEN
    SELECT station_id INTO v_station FROM public.user_station_assignments
      WHERE user_id = auth.uid() AND company_id = v_company LIMIT 1;
  END IF;
  IF v_station IS NULL THEN
    SELECT id INTO v_station FROM public.stations
      WHERE company_id = v_company AND deleted_at IS NULL LIMIT 1;
  END IF;
  IF v_station IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.stations s
    WHERE s.id = v_station AND s.company_id = v_company AND s.deleted_at IS NULL
  ) OR NOT public.can_access_station(v_station) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.wash_posts (company_id, station_id, name, capacity)
  VALUES (v_company, v_station, v_name, p_capacity) RETURNING id INTO v_post;
  RETURN v_post;
END $$;

-- 4. my_wash_posts() expose stationId : l'UI n'affiche que les postes de la
-- station courante et ne propose jamais un poste d'une autre station.
CREATE OR REPLACE FUNCTION public.my_wash_posts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'stationId', p.station_id, 'name', p.name,
    'capacity', p.capacity, 'active', p.active
  ) ORDER BY p.name), '[]'::jsonb)
  INTO v_result
  FROM public.wash_posts p
  WHERE (p.company_id = v_company OR public.is_platform_admin())
    AND public.can_access_station(p.station_id) AND p.deleted_at IS NULL;
  RETURN v_result;
END $$;

-- 5. Clients lisibles pour la création de fiche : UUID serveur uniquement.
CREATE OR REPLACE FUNCTION public.my_company_clients() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'stationId', c.station_id, 'name', c.name, 'phone', c.phone,
    'plate', COALESCE((
      SELECT v.plate FROM public.vehicles v
      WHERE v.customer_id = c.id AND v.deleted_at IS NULL AND v.plate <> ''
      ORDER BY v.created_at DESC LIMIT 1
    ), ''),
    'notes', c.notes, 'createdAt', c.created_at
  ) ORDER BY c.name), '[]'::jsonb)
  INTO v_result
  FROM public.customers c
  WHERE (c.company_id = v_company OR public.is_platform_admin())
    AND public.can_access_station(c.station_id) AND c.deleted_at IS NULL;
  RETURN v_result;
END $$;

-- 6. Droits d'exécution : aucune fonction anonyme / PUBLIC, authenticated seul.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'transition_wash_status','record_wash_quality_check','create_wash_post',
      'my_wash_posts','my_company_clients'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
