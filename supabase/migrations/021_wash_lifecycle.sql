-- 021 — Prompt 05 : cycle de lavage, état machine et RPC serveur
-- Autorité serveur : aucune écriture directe sur les tables du cycle depuis le
-- navigateur. company_id reste dérivé de auth.uid() ; seuls station_id et les
-- identifiens métier sont reçus. « ready » (terminé) n'est PAS « delivered ».

CREATE OR REPLACE FUNCTION public.assert_wash_status_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_allowed boolean := false;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- La permission est vérifiée dans les RPC ; la REVOKE ci-dessous interdit
    -- toute UPDATE directe depuis le navigateur. Ce trigger reste la garde
    -- d'état machine, y compris pour les fonctions internes.
    v_allowed := CASE NEW.status
      WHEN 'assigned' THEN OLD.status = 'pending'
      WHEN 'in_progress' THEN OLD.status IN ('assigned','quality_check')
      WHEN 'quality_check' THEN OLD.status = 'in_progress'
      WHEN 'ready' THEN OLD.status = 'quality_check'
      WHEN 'delivered' THEN OLD.status = 'ready'
      WHEN 'cancelled' THEN OLD.status NOT IN ('cancelled','delivered')
      ELSE false
    END;
    IF NOT v_allowed THEN
      RAISE EXCEPTION 'Transition de statut invalide : % → %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_washes_status_guard ON public.washes;
CREATE TRIGGER trg_washes_status_guard
  BEFORE UPDATE ON public.washes
  FOR EACH ROW EXECUTE FUNCTION public.assert_wash_status_transition();

CREATE OR REPLACE FUNCTION public.log_wash_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (company_id, station_id, actor_user_id, action, entity_type, entity_id, detail)
    VALUES (
      NEW.company_id, NEW.station_id, auth.uid(),
      CASE WHEN TG_OP = 'INSERT' THEN 'wash.created' ELSE 'wash.status_changed' END,
      'washes', NEW.id::text,
      jsonb_build_object(
        'number', NEW.number,
        'from', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
        'to', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_washes_lifecycle_audit ON public.washes;
CREATE TRIGGER trg_washes_lifecycle_audit
  AFTER INSERT OR UPDATE ON public.washes
  FOR EACH ROW EXECUTE FUNCTION public.log_wash_lifecycle();

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
  v_reason := btrim(COALESCE(p_reason,''));
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
  VALUES (v_company, v_wash.station_id, p_wash_id, v_from, p_to_status, auth.uid(), NULLIF(v_reason,''));
END $$;

CREATE OR REPLACE FUNCTION public.create_wash_full(p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_station uuid := (p_payload->>'station_id')::uuid;
  v_category uuid := (p_payload->>'category_id')::uuid;
  v_plate text := COALESCE(p_payload->>'plate','');
  v_label text := COALESCE(NULLIF(btrim(p_payload->>'vehicle_label'),''), '');
  v_customer uuid := NULLIF(p_payload->>'customer_id','')::uuid;
  v_customer_name text := COALESCE(p_payload->>'customer_name','');
  v_discount bigint := COALESCE((p_payload->>'discount_minor')::bigint, 0);
  v_items jsonb;
  v_employees jsonb := COALESCE(p_payload->'employee_ids','[]'::jsonb);
  v_post uuid := NULLIF(p_payload->>'post_id','')::uuid;
  v_key text := NULLIF(p_payload->>'idempotency_key','');
  v_wash uuid; v_vehicle uuid; v_user uuid; v_name text;
BEGIN
  IF NOT public.has_permission('washes.create') THEN
    RAISE EXCEPTION 'Permission washes.create requise' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_station(v_station) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_wash FROM public.washes WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN RETURN v_wash; END IF;
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'items','[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Prestations invalides' USING ERRCODE = '23514';
  END IF;
  -- Projection camelCase UI → contrat serveur `create_wash_with_items`.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'service_id', t.i->>'serviceId', 'qty', (t.i->>'qty')::integer
  )), '[]'::jsonb) INTO v_items
  FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) AS t(i);
  IF jsonb_typeof(v_employees) <> 'array' THEN
    RAISE EXCEPTION 'Affectations invalides' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(v_employees) > 0 AND NOT public.has_permission('washes.assign') THEN
    RAISE EXCEPTION 'Permission washes.assign requise' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO v_name FROM public.vehicle_categories
    WHERE id = v_category AND company_id = v_company AND station_id = v_station AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catégorie invalide' USING ERRCODE = '23514'; END IF;
  IF v_post IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.wash_posts WHERE id = v_post AND company_id = v_company AND station_id = v_station AND active
  ) THEN
    RAISE EXCEPTION 'Poste invalide' USING ERRCODE = '23514';
  END IF;
  FOR v_user IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(v_employees) AS t(value) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles p
      JOIN public.user_station_assignments a ON a.user_id = p.id
      WHERE p.id = v_user AND p.active = true
        AND p.company_id = v_company AND a.station_id = v_station
    ) THEN
      RAISE EXCEPTION 'Employé hors périmètre' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  v_wash := public.create_wash_with_items(
    v_station, v_category, COALESCE(NULLIF(v_label,''), v_name), v_plate,
    v_customer, v_customer_name, v_discount, v_items, v_key
  );

  IF btrim(v_plate) <> '' THEN
    SELECT id INTO v_vehicle FROM public.vehicles
      WHERE company_id = v_company AND upper(plate) = upper(btrim(v_plate)) AND deleted_at IS NULL
      LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.vehicles (company_id, station_id, customer_id, vehicle_category_id, plate)
      VALUES (v_company, v_station, v_customer, v_category, upper(btrim(v_plate)))
      RETURNING id INTO v_vehicle;
    END IF;
    UPDATE public.washes SET vehicle_id = v_vehicle WHERE id = v_wash;
  END IF;

  IF jsonb_array_length(v_employees) > 0 THEN
    INSERT INTO public.wash_assignments (company_id, station_id, wash_id, user_id, post_id, assigned_by)
    SELECT v_company, v_station, v_wash, t.value::uuid, v_post, auth.uid()
    FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(v_employees)) AS t(value);
    UPDATE public.washes SET status = 'assigned' WHERE id = v_wash;
    INSERT INTO public.wash_status_history (company_id, station_id, wash_id, from_status, to_status, actor_user_id, reason)
    VALUES (v_company, v_station, v_wash, 'pending', 'assigned', auth.uid(), 'Affectation initiale');
  END IF;
  RETURN v_wash;
END $$;

CREATE OR REPLACE FUNCTION public.assign_wash(
  p_wash_id uuid, p_user_ids uuid[], p_post_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_wash record; v_post uuid := p_post_id;
BEGIN
  IF NOT public.has_permission('washes.assign') THEN
    RAISE EXCEPTION 'Permission washes.assign requise' USING ERRCODE = '42501';
  END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RAISE EXCEPTION 'Au moins un employé requis' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  IF v_wash.status IN ('ready','delivered','cancelled') THEN
    RAISE EXCEPTION 'Affectation impossible sur une fiche %', v_wash.status USING ERRCODE = '23514';
  END IF;
  IF v_post IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.wash_posts WHERE id = v_post AND company_id = v_company AND station_id = v_wash.station_id AND active
  ) THEN
    RAISE EXCEPTION 'Poste invalide' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_user_ids) u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_profiles p JOIN public.user_station_assignments a ON a.user_id = p.id
      WHERE p.id = u AND p.active = true AND p.company_id = v_company AND a.station_id = v_wash.station_id
    )
  ) THEN
    RAISE EXCEPTION 'Employé hors périmètre' USING ERRCODE = '42501';
  END IF;
  UPDATE public.wash_assignments SET unassigned_at = now()
    WHERE wash_id = p_wash_id AND company_id = v_company AND unassigned_at IS NULL;
  INSERT INTO public.wash_assignments (company_id, station_id, wash_id, user_id, post_id, assigned_by)
  SELECT v_company, v_wash.station_id, p_wash_id, u, v_post, auth.uid()
    FROM (SELECT DISTINCT u FROM unnest(p_user_ids) AS t(u)) AS d(u);
  IF v_wash.status = 'pending' THEN
    PERFORM public.transition_wash_status(p_wash_id, 'assigned', 'Affectation des employés');
  ELSE
    INSERT INTO public.wash_status_history (company_id, station_id, wash_id, from_status, to_status, actor_user_id, reason)
    VALUES (v_company, v_wash.station_id, p_wash_id, v_wash.status, v_wash.status, auth.uid(), 'Réaffectation');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_wash_quality_check(
  p_wash_id uuid, p_result text, p_notes text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_wash record; v_notes text := btrim(COALESCE(p_notes,''));
BEGIN
  IF NOT public.has_permission('washes.quality') THEN
    RAISE EXCEPTION 'Permission washes.quality requise' USING ERRCODE = '42501';
  END IF;
  IF p_result NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Résultat de contrôle qualité invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL FOR UPDATE;
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
    PERFORM public.transition_wash_status(p_wash_id, 'ready', 'Contrôle qualité validé');
  ELSE
    PERFORM public.transition_wash_status(p_wash_id, 'in_progress', 'Contrôle qualité refusé : ' || COALESCE(NULLIF(v_notes,''), 'reprise demandée'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_wash_post(p_name text, p_capacity integer DEFAULT 1) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_station uuid; v_post uuid; v_name text := btrim(COALESCE(p_name,''));
BEGIN
  IF NOT public.has_permission('washes.assign') THEN
    RAISE EXCEPTION 'Permission washes.assign requise' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) < 2 OR COALESCE(p_capacity,0) < 1 THEN
    RAISE EXCEPTION 'Nom ou capacité de poste invalide' USING ERRCODE = '23514';
  END IF;
  SELECT station_id INTO v_station FROM public.user_station_assignments
    WHERE user_id = auth.uid() AND company_id = v_company LIMIT 1;
  IF v_station IS NULL THEN
    SELECT id INTO v_station FROM public.stations WHERE company_id = v_company AND deleted_at IS NULL LIMIT 1;
  END IF;
  IF v_station IS NULL OR NOT public.can_access_station(v_station) THEN
    RAISE EXCEPTION 'Aucune station accessible' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.wash_posts (company_id, station_id, name, capacity)
  VALUES (v_company, v_station, v_name, p_capacity) RETURNING id INTO v_post;
  RETURN v_post;
END $$;

CREATE OR REPLACE FUNCTION public.record_wash_payment_by_key(
  p_wash_id uuid, p_amount_minor bigint, p_method_key text,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_wash record; v_method uuid;
  v_label text; v_kind text; v_cash boolean;
BEGIN
  IF NOT public.has_permission('payments.create') THEN
    RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
  END IF;
  CASE p_method_key
    WHEN 'cash' THEN v_label := 'Espèces'; v_kind := 'cash'; v_cash := true;
    WHEN 'mobile_money' THEN v_label := 'Mobile Money'; v_kind := 'mobile_money'; v_cash := false;
    WHEN 'card' THEN v_label := 'Carte'; v_kind := 'card'; v_cash := false;
    WHEN 'transfer' THEN v_label := 'Virement'; v_kind := 'transfer'; v_cash := false;
    ELSE RAISE EXCEPTION 'Moyen de paiement invalide' USING ERRCODE = '23514';
  END CASE;
  INSERT INTO public.payment_methods (company_id, station_id, key, label, kind, affects_cash)
  VALUES (v_company, v_wash.station_id, p_method_key, v_label, v_kind, v_cash)
  ON CONFLICT (station_id, key) DO UPDATE SET
    active = true, label = EXCLUDED.label, kind = EXCLUDED.kind, affects_cash = EXCLUDED.affects_cash
  RETURNING id INTO v_method;
  RETURN public.record_payment(p_wash_id, p_amount_minor, v_method, p_reference, p_idempotency_key);
END $$;

-- Écritures directes interdites : seules les fonctions SECURITY DEFINER ci-dessus
-- et celles du Prompt 03 peuvent modifier le cycle de lavage.
REVOKE INSERT, UPDATE, DELETE ON
  public.washes, public.wash_items, public.wash_status_history, public.wash_assignments,
  public.wash_quality_checks, public.wash_posts, public.vehicles, public.payment_methods
FROM anon, authenticated;
GRANT SELECT ON
  public.washes, public.wash_items, public.wash_status_history, public.wash_assignments,
  public.wash_quality_checks, public.wash_posts, public.vehicles, public.payment_methods
TO authenticated;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'create_wash_full','transition_wash_status','assign_wash','record_wash_quality_check',
      'create_wash_post','record_wash_payment_by_key'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
