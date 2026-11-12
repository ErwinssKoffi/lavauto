-- 037 — Prompt 08 : architecture de notifications sans fournisseur.
-- La file d'attente est la seule sortie : aucun envoi, aucun simulacre d'envoi,
-- aucun e-mail, SMS, WhatsApp, webhook, secret ou clé API.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_station_id uuid, p_template_key text,
  p_customer_id uuid DEFAULT NULL, p_fleet_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_template text := btrim(COALESCE(p_template_key, ''));
  v_channel text := 'none';
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_id uuid;
BEGIN
  IF NOT (public.has_permission('notifications.enqueue')
    OR public.has_permission('crm.manage')
    OR public.has_permission('customers.manage')) THEN
    RAISE EXCEPTION 'Permission notifications.enqueue requise' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_crm_station(p_station_id);
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF length(v_template) < 2
    OR jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object'
    OR (p_customer_id IS NULL AND p_fleet_id IS NULL)
    OR (p_customer_id IS NOT NULL AND p_fleet_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Notification en attente invalide' USING ERRCODE = '23514';
  END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT preferred_channel INTO v_channel FROM public.customers
    WHERE id = p_customer_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Client hors perimetre' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT preferred_channel INTO v_channel FROM public.fleets
    WHERE id = p_fleet_id AND company_id = v_company
      AND station_id = p_station_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Flotte hors perimetre' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_channel = 'none' THEN
    RAISE EXCEPTION 'Aucun canal de communication choisi : notification non mise en attente'
      USING ERRCODE = '23514';
  END IF;
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.notification_outbox
    WHERE company_id = v_company AND idempotency_key = v_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO public.notification_outbox (company_id, station_id,
    customer_id, fleet_id, channel, template_key, payload, status,
    idempotency_key, created_by)
  VALUES (v_company, p_station_id, p_customer_id, p_fleet_id,
    v_channel, v_template, COALESCE(p_payload, '{}'::jsonb), 'pending',
    v_key, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_pending_notification(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT (public.has_permission('notifications.enqueue')
    OR public.has_permission('crm.manage')) THEN
    RAISE EXCEPTION 'Permission notifications.enqueue requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notification_outbox
  SET status = 'cancelled'
  WHERE id = p_notification_id AND company_id = v_company
    AND status = 'pending' AND public.can_access_station(station_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification en attente introuvable' USING ERRCODE = 'P0002';
  END IF;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('enqueue_notification','cancel_pending_notification')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
