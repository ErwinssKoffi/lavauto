-- 053 — Notifications transactionnelles WhatsApp « lavage prêt ».
-- ADDITIF : l'ancienne notification_outbox CRM reste volontairement inerte.
-- Aucun secret ni fournisseur n'est configuré par cette migration. Le worker
-- doit être déployé/configuré et appelé par un ordonnanceur séparé.

CREATE TABLE public.whatsapp_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('granted','revoked')),
  phone_e164 text,
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 5 AND 500),
  actor_user_id uuid REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_whatsapp_consent_customer ON public.whatsapp_consent_events (customer_id, created_at DESC);

ALTER TABLE public.customers
  ADD COLUMN whatsapp_consent_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN whatsapp_consent_phone text,
  ADD COLUMN whatsapp_consent_event_id uuid REFERENCES public.whatsapp_consent_events(id) ON DELETE RESTRICT,
  ADD COLUMN whatsapp_consent_at timestamptz,
  ADD CONSTRAINT customers_whatsapp_consent_complete CHECK (
    NOT whatsapp_consent_granted OR
    (whatsapp_consent_phone IS NOT NULL AND whatsapp_consent_event_id IS NOT NULL AND whatsapp_consent_at IS NOT NULL)
  );

CREATE TABLE public.wash_whatsapp_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  consent_event_id uuid REFERENCES public.whatsapp_consent_events(id) ON DELETE RESTRICT,
  recipient_e164 text,
  origin text NOT NULL CHECK (origin IN ('automatic','manual')),
  request_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('blocked','pending','sending','accepted','sent','delivered','read','failed','cancelled','unknown')),
  reason_code text,
  provider_phone_number_id text,
  provider_message_id text,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  UNIQUE (company_id, request_key),
  CHECK (status = 'blocked' OR (customer_id IS NOT NULL AND consent_event_id IS NOT NULL AND recipient_e164 IS NOT NULL))
);
CREATE UNIQUE INDEX uq_wash_whatsapp_automatic ON public.wash_whatsapp_notifications (wash_id) WHERE origin = 'automatic';
-- Une tentative incertaine ne peut jamais être réémise par accident.
CREATE UNIQUE INDEX uq_wash_whatsapp_inflight ON public.wash_whatsapp_notifications (wash_id)
  WHERE status IN ('pending','sending','unknown');
CREATE UNIQUE INDEX uq_wash_whatsapp_provider_id ON public.wash_whatsapp_notifications (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX ix_wash_whatsapp_pending ON public.wash_whatsapp_notifications (company_id, created_at) WHERE status = 'pending';
CREATE INDEX ix_wash_whatsapp_wash ON public.wash_whatsapp_notifications (wash_id, created_at DESC);

CREATE TABLE public.wash_whatsapp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.wash_whatsapp_notifications(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('blocked','pending','sending','accepted','sent','delivered','read','failed','cancelled','unknown')),
  reason_code text,
  provider_at timestamptz,
  provider_event_key text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (notification_id, provider_event_key)
);
CREATE INDEX ix_wash_whatsapp_events_notification ON public.wash_whatsapp_events (notification_id, created_at);

ALTER TABLE public.whatsapp_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wash_whatsapp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wash_whatsapp_events ENABLE ROW LEVEL SECURITY;
-- Aucun accès direct public ; les projections et commandes contrôlent aussi le tenant.
REVOKE ALL ON public.whatsapp_consent_events, public.wash_whatsapp_notifications, public.wash_whatsapp_events FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_whatsapp_consent_events_immutable BEFORE UPDATE OR DELETE ON public.whatsapp_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.assert_immutable();
CREATE TRIGGER trg_wash_whatsapp_events_immutable BEFORE UPDATE OR DELETE ON public.wash_whatsapp_events
  FOR EACH ROW EXECUTE FUNCTION public.assert_immutable();

-- On accepte seulement un numéro international explicite, sans deviner le pays.
CREATE OR REPLACE FUNCTION public.whatsapp_normalize_phone(p_phone text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v_phone text := regexp_replace(btrim(COALESCE(p_phone,'')), '[[:space:]()-]', '', 'g');
BEGIN
  IF v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RETURN NULL; END IF;
  RETURN v_phone;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_log_event(
  p_notification_id uuid, p_kind text, p_reason text DEFAULT NULL,
  p_provider_at timestamptz DEFAULT NULL, p_provider_event_key text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.wash_whatsapp_events (notification_id, company_id, station_id, kind, reason_code, provider_at, provider_event_key)
  SELECT n.id, n.company_id, n.station_id, p_kind, p_reason, p_provider_at, p_provider_event_key
  FROM public.wash_whatsapp_notifications n WHERE n.id = p_notification_id
  ON CONFLICT (notification_id, provider_event_key) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_cancel_pending_for_customer(p_customer_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  -- Même si une notification historique a été corrompue par un rôle
  -- privilégié, ne jamais modifier une autre entreprise ou station à partir
  -- du seul identifiant client. Le claim recontrôle lui aussi cette portée.
  FOR v_id IN UPDATE public.wash_whatsapp_notifications n
    SET status='cancelled', reason_code=p_reason, updated_at=clock_timestamp()
    FROM public.customers c
    WHERE c.id=p_customer_id AND n.customer_id=c.id AND n.company_id=c.company_id
      AND n.station_id=c.station_id AND n.status='pending' RETURNING n.id
  LOOP
    PERFORM public.whatsapp_log_event(v_id, 'cancelled', p_reason);
  END LOOP;
END $$;

-- Une modification du numéro révoque l'accord pour l'ancien numéro ; revenir
-- ensuite à l'ancien numéro ne le réactive pas. Les lignes déjà en vol ne sont
-- pas rappelables : seul leur résultat fournisseur peut les résoudre.
CREATE OR REPLACE FUNCTION public.whatsapp_revoke_on_phone_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event uuid; v_at timestamptz := clock_timestamp();
BEGIN
  IF OLD.whatsapp_consent_granted AND
    public.whatsapp_normalize_phone(NEW.phone) IS DISTINCT FROM OLD.whatsapp_consent_phone THEN
    INSERT INTO public.whatsapp_consent_events (company_id, station_id, customer_id, kind, phone_e164, source, actor_user_id, created_at)
    VALUES (OLD.company_id, OLD.station_id, OLD.id, 'revoked', OLD.whatsapp_consent_phone,
      'Révocation automatique après changement de numéro', auth.uid(), v_at) RETURNING id INTO v_event;
    NEW.whatsapp_consent_granted := false;
    NEW.whatsapp_consent_phone := NULL;
    NEW.whatsapp_consent_event_id := v_event;
    NEW.whatsapp_consent_at := v_at;
    PERFORM public.whatsapp_cancel_pending_for_customer(OLD.id, 'phone_changed');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_customer_whatsapp_phone BEFORE UPDATE OF phone ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_revoke_on_phone_change();

CREATE OR REPLACE FUNCTION public.save_customer_whatsapp_consent(
  p_customer_id uuid, p_granted boolean, p_source text, p_expected_phone text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_customer public.customers%ROWTYPE;
  v_phone text; v_source text := btrim(COALESCE(p_source,'')); v_event uuid; v_at timestamptz := clock_timestamp();
BEGIN
  IF v_company IS NULL OR NOT public.has_permission('customers.manage') THEN
    RAISE EXCEPTION 'Permission customers.manage requise' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND company_id=v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable' USING ERRCODE='P0002'; END IF;
  PERFORM public.assert_crm_station(v_customer.station_id);
  IF p_granted IS NULL OR length(v_source) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Décrivez la source de l’accord ou du retrait (5 à 500 caractères)' USING ERRCODE='23514';
  END IF;
  v_phone := public.whatsapp_normalize_phone(v_customer.phone);
  IF p_granted AND v_phone IS NULL THEN
    RAISE EXCEPTION 'Téléphone international requis, par exemple +2250700000000' USING ERRCODE='23514';
  END IF;
  -- L'accord vise le numéro présenté à l'opérateur, pas un numéro modifié
  -- par une autre session après le chargement de la fiche. La comparaison est
  -- faite après verrouillage du client et avant tout événement ou annulation.
  IF p_granted AND public.whatsapp_normalize_phone(p_expected_phone) IS DISTINCT FROM v_phone THEN
    RAISE EXCEPTION 'Numéro confirmé différent du numéro enregistré. Rechargez la page et vérifiez la fiche client avant de réessayer.' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.whatsapp_consent_events (company_id, station_id, customer_id, kind, phone_e164, source, actor_user_id, created_at)
  VALUES (v_company, v_customer.station_id, v_customer.id,
    CASE WHEN p_granted THEN 'granted' ELSE 'revoked' END,
    CASE WHEN p_granted THEN v_phone ELSE COALESCE(v_customer.whatsapp_consent_phone, v_phone) END,
    v_source, auth.uid(), v_at) RETURNING id INTO v_event;
  UPDATE public.customers SET whatsapp_consent_granted=p_granted,
    whatsapp_consent_phone=CASE WHEN p_granted THEN v_phone ELSE NULL END,
    whatsapp_consent_event_id=v_event, whatsapp_consent_at=v_at, updated_at=v_at
  WHERE id=v_customer.id;
  -- Une nouvelle preuve invalide aussi les anciennes mises en attente : elles
  -- ne peuvent être expédiées sur la base d'un consentement remplacé.
  PERFORM public.whatsapp_cancel_pending_for_customer(v_customer.id, CASE WHEN p_granted THEN 'consent_replaced' ELSE 'consent_revoked' END);
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.my_customer_whatsapp_consent(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_customer public.customers%ROWTYPE;
BEGIN
  IF v_company IS NULL OR NOT (public.has_permission('customers.view') OR public.has_permission('customers.manage')) THEN
    RAISE EXCEPTION 'Permission customers.view requise' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND company_id=v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable' USING ERRCODE='P0002'; END IF;
  PERFORM public.assert_crm_station(v_customer.station_id);
  RETURN jsonb_build_object(
    'granted', v_customer.whatsapp_consent_granted,
    'phone', v_customer.whatsapp_consent_phone,
    'at', v_customer.whatsapp_consent_at,
    'history', COALESCE((SELECT jsonb_agg(q.event ORDER BY q.created_at DESC) FROM (
      SELECT e.created_at, jsonb_build_object('kind',e.kind, 'phone',e.phone_e164, 'source',e.source,
        'at',e.created_at, 'actor',COALESCE(u.full_name,'Système')) AS event
      FROM public.whatsapp_consent_events e LEFT JOIN public.user_profiles u ON u.id=e.actor_user_id
      WHERE e.customer_id=v_customer.id AND e.company_id=v_company
      ORDER BY e.created_at DESC LIMIT 20
    ) q), '[]'::jsonb)
  );
END $$;

-- À la transition unique vers ready, le journal explique même les blocages.
-- Aucun appel réseau n'a lieu dans la transaction métier.
CREATE OR REPLACE FUNCTION public.whatsapp_wash_status_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_customer public.customers%ROWTYPE; v_phone text; v_status text; v_reason text;
  v_id uuid; v_changed uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'ready' AND NEW.deleted_at IS NULL THEN
    SELECT * INTO v_customer FROM public.customers
      WHERE id=NEW.customer_id AND company_id=NEW.company_id
        AND station_id=NEW.station_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      v_status := 'blocked'; v_reason := 'no_customer';
    ELSE
      v_phone := public.whatsapp_normalize_phone(v_customer.phone);
      IF NOT v_customer.whatsapp_consent_granted OR v_customer.whatsapp_consent_event_id IS NULL THEN
        v_status := 'blocked'; v_reason := 'no_consent';
      ELSIF v_phone IS NULL OR v_phone IS DISTINCT FROM v_customer.whatsapp_consent_phone THEN
        v_status := 'blocked'; v_reason := 'invalid_phone';
      ELSE
        v_status := 'pending'; v_reason := NULL;
      END IF;
    END IF;
    INSERT INTO public.wash_whatsapp_notifications (company_id, station_id, wash_id, customer_id, consent_event_id,
      recipient_e164, origin, request_key, status, reason_code, created_by)
    VALUES (NEW.company_id, NEW.station_id, NEW.id, v_customer.id,
      CASE WHEN v_status='pending' THEN v_customer.whatsapp_consent_event_id ELSE NULL END,
      CASE WHEN v_status='pending' THEN v_phone ELSE NULL END,
      'automatic', 'ready:' || NEW.id::text, v_status, v_reason, auth.uid())
    ON CONFLICT (wash_id) WHERE origin='automatic' DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.whatsapp_log_event(v_id, v_status, v_reason); END IF;
  ELSIF NEW.status IN ('delivered','cancelled') THEN
    FOR v_changed IN UPDATE public.wash_whatsapp_notifications
      SET status='cancelled', reason_code='wash_no_longer_ready', updated_at=clock_timestamp()
      WHERE wash_id=NEW.id AND company_id=NEW.company_id AND status='pending' RETURNING id
    LOOP
      PERFORM public.whatsapp_log_event(v_changed, 'cancelled', 'wash_no_longer_ready');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_wash_whatsapp_status AFTER UPDATE OF status ON public.washes
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_wash_status_changed();

CREATE OR REPLACE FUNCTION public.enqueue_wash_whatsapp(p_wash_id uuid, p_idempotency_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_wash public.washes%ROWTYPE;
  v_customer public.customers%ROWTYPE; v_existing public.wash_whatsapp_notifications%ROWTYPE;
  v_key text := btrim(COALESCE(p_idempotency_key,'')); v_phone text; v_id uuid;
BEGIN
  IF v_company IS NULL OR NOT (public.has_permission('notifications.enqueue') OR public.has_permission('customers.manage')) THEN
    RAISE EXCEPTION 'Permission d’envoi de notification requise' USING ERRCODE='42501';
  END IF;
  IF length(v_key) NOT BETWEEN 16 AND 128 THEN RAISE EXCEPTION 'Clé de demande invalide' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_wash FROM public.washes
    WHERE id=p_wash_id AND company_id=v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE='P0002'; END IF;
  PERFORM public.assert_crm_station(v_wash.station_id);
  SELECT * INTO v_existing FROM public.wash_whatsapp_notifications
    WHERE company_id=v_company AND request_key='manual:' || v_key;
  IF FOUND THEN
    IF v_existing.wash_id IS DISTINCT FROM v_wash.id THEN RAISE EXCEPTION 'Clé déjà utilisée pour une autre fiche' USING ERRCODE='23505'; END IF;
    RETURN v_existing.id;
  END IF;
  IF v_wash.status <> 'ready' THEN RAISE EXCEPTION 'Seul un lavage prêt peut être notifié' USING ERRCODE='23514'; END IF;
  -- Le clic manuel ne double pas une mise en attente, un envoi en cours,
  -- incertain ou déjà accepté/livré. Un refus ou un blocage peut être corrigé.
  SELECT * INTO v_existing FROM public.wash_whatsapp_notifications
    WHERE wash_id=v_wash.id AND company_id=v_company
      AND status IN ('pending','sending','unknown','accepted','sent','delivered','read')
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_existing.id; END IF;
  SELECT * INTO v_customer FROM public.customers
    WHERE id=v_wash.customer_id AND company_id=v_company AND station_id=v_wash.station_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR NOT v_customer.whatsapp_consent_granted OR v_customer.whatsapp_consent_event_id IS NULL THEN
    RAISE EXCEPTION 'Accord WhatsApp explicite absent pour ce client' USING ERRCODE='23514';
  END IF;
  v_phone := public.whatsapp_normalize_phone(v_customer.phone);
  IF v_phone IS NULL OR v_phone IS DISTINCT FROM v_customer.whatsapp_consent_phone THEN
    RAISE EXCEPTION 'Numéro international ou consentement périmé' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.wash_whatsapp_notifications (company_id, station_id, wash_id, customer_id, consent_event_id,
    recipient_e164, origin, request_key, status, created_by)
  VALUES (v_company, v_wash.station_id, v_wash.id, v_customer.id, v_customer.whatsapp_consent_event_id,
    v_phone, 'manual', 'manual:' || v_key, 'pending', auth.uid()) RETURNING id INTO v_id;
  PERFORM public.whatsapp_log_event(v_id, 'pending');
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.my_wash_whatsapp_journal(p_wash_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_wash public.washes%ROWTYPE;
BEGIN
  IF v_company IS NULL OR NOT (public.has_permission('washes.view') OR public.has_permission('notifications.view')) THEN
    RAISE EXCEPTION 'Permission de consultation requise' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_wash FROM public.washes WHERE id=p_wash_id AND company_id=v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE='P0002'; END IF;
  PERFORM public.assert_crm_station(v_wash.station_id);
  RETURN COALESCE((SELECT jsonb_agg(q.entry ORDER BY q.created_at DESC) FROM (
    SELECT n.created_at, jsonb_build_object(
      'id',n.id, 'origin',n.origin, 'status',n.status, 'reason',n.reason_code,
      'providerMessageId',n.provider_message_id, 'createdAt',n.created_at, 'updatedAt',n.updated_at,
      'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'reason',e.reason_code,
        'at',e.created_at,'providerAt',e.provider_at) ORDER BY e.created_at)
        FROM public.wash_whatsapp_events e WHERE e.notification_id=n.id), '[]'::jsonb)
    ) AS entry FROM public.wash_whatsapp_notifications n
    WHERE n.wash_id=v_wash.id AND n.company_id=v_company AND n.station_id=v_wash.station_id
    ORDER BY n.created_at DESC LIMIT 50
  ) q), '[]'::jsonb);
END $$;

-- API privée réservée au service : claim atomique, recontrôle du consentement,
-- puis statut incertain si l'issue du POST ne peut être établie. Aucun retry
-- automatique après claim. Verrouiller fiche, client puis notification évite
-- les interblocages et ne réclame pas une fiche en cours de restitution.
CREATE OR REPLACE FUNCTION public.claim_wash_whatsapp(p_company uuid, p_phone_number_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidate record; v_customer public.customers%ROWTYPE; v_n public.wash_whatsapp_notifications%ROWTYPE;
  v_wash public.washes%ROWTYPE; v_station_name text; v_reason text;
BEGIN
  IF p_company IS NULL OR COALESCE(p_phone_number_id,'') !~ '^[0-9]{3,32}$' THEN
    RAISE EXCEPTION 'Configuration expéditeur invalide' USING ERRCODE='23514';
  END IF;
  FOR v_candidate IN SELECT id, customer_id, wash_id FROM public.wash_whatsapp_notifications
    WHERE company_id=p_company AND status='pending' ORDER BY created_at LIMIT 100
  LOOP
    -- La transition vers livré/annulé détient déjà ce verrou : ne pas lire un
    -- ancien statut ready pendant que cette transition est en cours.
    SELECT * INTO v_wash FROM public.washes WHERE id=v_candidate.wash_id
      AND company_id=p_company FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO v_customer FROM public.customers WHERE id=v_candidate.customer_id
      AND company_id=p_company FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO v_n FROM public.wash_whatsapp_notifications
      WHERE id=v_candidate.id AND company_id=p_company AND status='pending' FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_reason := NULL;
    IF v_wash.id IS NULL OR v_wash.deleted_at IS NOT NULL OR v_wash.status <> 'ready'
      OR v_wash.station_id <> v_n.station_id OR v_wash.customer_id IS DISTINCT FROM v_n.customer_id THEN
      v_reason := 'wash_no_longer_ready';
    ELSIF v_customer.deleted_at IS NOT NULL OR v_customer.station_id IS DISTINCT FROM v_n.station_id
      OR NOT v_customer.whatsapp_consent_granted
      OR v_customer.whatsapp_consent_event_id IS DISTINCT FROM v_n.consent_event_id
      OR v_customer.whatsapp_consent_phone IS DISTINCT FROM v_n.recipient_e164
      OR public.whatsapp_normalize_phone(v_customer.phone) IS DISTINCT FROM v_n.recipient_e164 THEN
      v_reason := 'consent_changed';
    END IF;
    IF v_reason IS NOT NULL THEN
      UPDATE public.wash_whatsapp_notifications SET status='cancelled', reason_code=v_reason,
        updated_at=clock_timestamp() WHERE id=v_n.id;
      PERFORM public.whatsapp_log_event(v_n.id, 'cancelled', v_reason);
      CONTINUE;
    END IF;
    SELECT name INTO v_station_name FROM public.stations WHERE id=v_n.station_id AND company_id=p_company AND deleted_at IS NULL;
    IF v_station_name IS NULL THEN
      UPDATE public.wash_whatsapp_notifications SET status='cancelled', reason_code='station_unavailable', updated_at=clock_timestamp() WHERE id=v_n.id;
      PERFORM public.whatsapp_log_event(v_n.id, 'cancelled', 'station_unavailable');
      CONTINUE;
    END IF;
    UPDATE public.wash_whatsapp_notifications SET status='sending', claimed_at=clock_timestamp(),
      updated_at=clock_timestamp(), provider_phone_number_id=p_phone_number_id WHERE id=v_n.id;
    PERFORM public.whatsapp_log_event(v_n.id, 'sending');
    RETURN jsonb_build_object('id',v_n.id, 'phone',v_n.recipient_e164,
      'washNumber',v_wash.number, 'stationName',v_station_name);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.expire_wash_whatsapp_claims(p_company uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_count integer := 0;
BEGIN
  IF p_company IS NULL THEN RAISE EXCEPTION 'Entreprise requise' USING ERRCODE='23514'; END IF;
  FOR v_id IN UPDATE public.wash_whatsapp_notifications SET status='unknown', reason_code='claim_expired', updated_at=clock_timestamp()
    WHERE company_id=p_company AND status='sending' AND claimed_at < clock_timestamp() - interval '5 minutes' RETURNING id
  LOOP
    v_count := v_count + 1;
    PERFORM public.whatsapp_log_event(v_id, 'unknown', 'claim_expired');
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.finish_wash_whatsapp(
  p_company uuid, p_notification uuid, p_result text, p_message_id text DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n public.wash_whatsapp_notifications%ROWTYPE; v_reason text := left(regexp_replace(COALESCE(p_reason,''), '[^a-zA-Z0-9_:.-]', '', 'g'), 80);
BEGIN
  IF p_result NOT IN ('accepted','failed','unknown') OR p_company IS NULL THEN
    RAISE EXCEPTION 'Résultat fournisseur invalide' USING ERRCODE='23514';
  END IF;
  IF p_result='accepted' AND (COALESCE(p_message_id,'') NOT LIKE 'wamid.%' OR length(p_message_id)>256) THEN
    RAISE EXCEPTION 'Identifiant fournisseur absent' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_n FROM public.wash_whatsapp_notifications WHERE id=p_notification AND company_id=p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification introuvable' USING ERRCODE='P0002'; END IF;
  IF v_n.status NOT IN ('sending','unknown','accepted','sent','delivered','read','failed') THEN
    RAISE EXCEPTION 'Notification non réclamée' USING ERRCODE='23514';
  END IF;
  IF p_result='accepted' AND v_n.provider_message_id IS NOT NULL AND v_n.provider_message_id <> p_message_id THEN
    RAISE EXCEPTION 'Identifiant fournisseur contradictoire' USING ERRCODE='23514';
  END IF;
  -- Un webhook peut arriver avant la réponse HTTP ; ne jamais le rétrograder.
  IF v_n.status IN ('sending','unknown') THEN
    UPDATE public.wash_whatsapp_notifications SET status=p_result,
      provider_message_id=CASE WHEN p_result='accepted' THEN p_message_id ELSE provider_message_id END,
      accepted_at=CASE WHEN p_result='accepted' THEN COALESCE(accepted_at,clock_timestamp()) ELSE accepted_at END,
      reason_code=NULLIF(v_reason,''), updated_at=clock_timestamp() WHERE id=v_n.id;
    PERFORM public.whatsapp_log_event(v_n.id, p_result, NULLIF(v_reason,''), NULL,
      CASE WHEN p_result='accepted' THEN 'http:accepted:' || p_message_id ELSE NULL END);
  ELSIF p_result='accepted' THEN
    IF v_n.provider_message_id IS NULL THEN
      UPDATE public.wash_whatsapp_notifications SET provider_message_id=p_message_id,
        accepted_at=COALESCE(accepted_at,clock_timestamp()), updated_at=clock_timestamp() WHERE id=v_n.id;
    END IF;
    -- Même si le webhook précède la réponse, conserver aussi l'acceptation HTTP.
    PERFORM public.whatsapp_log_event(v_n.id, 'accepted', NULLIF(v_reason,''), NULL, 'http:accepted:' || p_message_id);
  END IF;
END $$;

-- Appelée uniquement après vérification HMAC, WABA et numéro expéditeur. Le
-- callback opaque permet de corréler un webhook reçu avant la réponse HTTP.
CREATE OR REPLACE FUNCTION public.apply_wash_whatsapp_status(
  p_company uuid, p_phone_number_id text, p_notification uuid, p_message_id text,
  p_status text, p_timestamp bigint, p_reason text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n public.wash_whatsapp_notifications%ROWTYPE; v_event_key text; v_inserted uuid;
  v_wash_id uuid; v_cancelled uuid;
  v_at timestamptz; v_next text; v_reason text := left(regexp_replace(COALESCE(p_reason,''), '[^a-zA-Z0-9_:.-]', '', 'g'), 80);
BEGIN
  IF p_company IS NULL OR COALESCE(p_phone_number_id,'') !~ '^[0-9]{3,32}$'
    OR p_status NOT IN ('sent','delivered','read','failed') OR COALESCE(p_message_id,'') NOT LIKE 'wamid.%'
    OR length(p_message_id)>256 OR p_timestamp IS NULL OR p_timestamp < 0 OR p_timestamp > 4102444800 THEN
    RAISE EXCEPTION 'Événement fournisseur invalide' USING ERRCODE='23514';
  END IF;
  SELECT n.wash_id INTO v_wash_id FROM public.wash_whatsapp_notifications n
    WHERE n.company_id=p_company AND n.provider_phone_number_id=p_phone_number_id
      AND n.status IN ('sending','unknown','accepted','sent','delivered','read','failed')
      AND ((p_notification IS NOT NULL AND n.id=p_notification AND (n.provider_message_id IS NULL OR n.provider_message_id=p_message_id))
        OR (p_notification IS NULL AND n.provider_message_id=p_message_id));
  IF NOT FOUND THEN RETURN false; END IF;
  -- Même ordre de verrouillage que l'envoi manuel et le claim : une livraison
  -- tardive d'une ancienne tentative doit pouvoir annuler une relance en attente.
  PERFORM 1 FROM public.washes WHERE id=v_wash_id AND company_id=p_company FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_n FROM public.wash_whatsapp_notifications n
    WHERE n.company_id=p_company AND n.provider_phone_number_id=p_phone_number_id
      AND n.status IN ('sending','unknown','accepted','sent','delivered','read','failed')
      AND ((p_notification IS NOT NULL AND n.id=p_notification AND (n.provider_message_id IS NULL OR n.provider_message_id=p_message_id))
        OR (p_notification IS NULL AND n.provider_message_id=p_message_id)) FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_at := to_timestamp(p_timestamp);
  v_event_key := p_status || ':' || p_timestamp::text || ':' || p_message_id;
  INSERT INTO public.wash_whatsapp_events (notification_id, company_id, station_id, kind, reason_code, provider_at, provider_event_key)
  VALUES (v_n.id, v_n.company_id, v_n.station_id, p_status, NULLIF(v_reason,''), v_at, v_event_key)
  ON CONFLICT (notification_id, provider_event_key) DO NOTHING RETURNING id INTO v_inserted;
  IF v_inserted IS NULL THEN RETURN true; END IF;
  v_next := CASE
    WHEN v_n.status='read' THEN 'read'
    WHEN p_status='read' THEN 'read'
    WHEN v_n.status='delivered' THEN 'delivered'
    WHEN p_status='delivered' THEN 'delivered'
    WHEN p_status='failed' THEN 'failed'
    WHEN v_n.status='failed' THEN 'failed'
    ELSE 'sent' END;
  UPDATE public.wash_whatsapp_notifications SET
    status=v_next, provider_message_id=p_message_id,
    accepted_at=COALESCE(accepted_at,v_at),
    delivered_at=CASE WHEN p_status IN ('delivered','read') THEN COALESCE(delivered_at,v_at) ELSE delivered_at END,
    read_at=CASE WHEN p_status='read' THEN COALESCE(read_at,v_at) ELSE read_at END,
    reason_code=CASE WHEN v_next='failed' THEN NULLIF(v_reason,'') ELSE NULL END,
    updated_at=clock_timestamp() WHERE id=v_n.id;
  IF v_next IN ('delivered','read') THEN
    -- Un fournisseur peut corriger tardivement un échec. Si une relance a déjà
    -- été créée mais pas réclamée, ne pas envoyer un second avis après livraison.
    FOR v_cancelled IN UPDATE public.wash_whatsapp_notifications SET status='cancelled',
      reason_code='delivery_confirmed_elsewhere', updated_at=clock_timestamp()
      WHERE company_id=p_company AND wash_id=v_n.wash_id AND id<>v_n.id AND status='pending' RETURNING id
    LOOP
      PERFORM public.whatsapp_log_event(v_cancelled, 'cancelled', 'delivery_confirmed_elsewhere');
    END LOOP;
  END IF;
  RETURN true;
END $$;

-- Les fonctions internes et de service ne sont jamais appelables par un JWT
-- utilisateur ; les quatre commandes utilisateur dérivent le tenant du JWT.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (
      'whatsapp_normalize_phone','whatsapp_log_event','whatsapp_cancel_pending_for_customer','whatsapp_revoke_on_phone_change',
      'whatsapp_wash_status_changed','save_customer_whatsapp_consent','my_customer_whatsapp_consent',
      'enqueue_wash_whatsapp','my_wash_whatsapp_journal','claim_wash_whatsapp','expire_wash_whatsapp_claims',
      'finish_wash_whatsapp','apply_wash_whatsapp_status')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    IF f.proname IN ('save_customer_whatsapp_consent','my_customer_whatsapp_consent','enqueue_wash_whatsapp','my_wash_whatsapp_journal') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    ELSIF f.proname IN ('claim_wash_whatsapp','expire_wash_whatsapp_claims','finish_wash_whatsapp','apply_wash_whatsapp_status') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
  END LOOP;
END $$;
