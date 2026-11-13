-- 057 — Formules, demandes d'abonnement et droits effectifs.
-- Préparation locale uniquement. Aucun paiement n'est déclenché ici : un choix
-- payant reste une demande jusqu'à décision explicite d'un administrateur.

CREATE TABLE public.plan_entitlements (
  plan_id text NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key IN ('stock','loyalty','fleets','consolidation','audit')),
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (plan_id, feature_key)
);
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_plan_entitlements_read ON public.plan_entitlements
  FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.plan_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plan_entitlements TO anon, authenticated;
INSERT INTO public.plan_entitlements (plan_id, feature_key, enabled)
SELECT p.id, f.key, p.id IN ('essai','premium')
FROM public.plans p
CROSS JOIN (VALUES ('stock'),('loyalty'),('fleets'),('consolidation'),('audit')) AS f(key)
WHERE p.id IN ('essai','standard','premium');

-- 008 a semé le libellé « Lavages illimités » alors qu'un quota existe.
-- Corriger uniquement ce texte historique exact, sans réinitialiser les prix,
-- les quotas ou les autres avantages personnalisés par la plateforme. La
-- limite effective reste lue dans plan_limits, jamais figée dans ce libellé.
UPDATE public.plans p SET features = (
  SELECT COALESCE(jsonb_agg(CASE WHEN item = '"Lavages illimités"'::jsonb
    THEN to_jsonb('Quota mensuel défini par la formule'::text) ELSE item END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(p.features) WITH ORDINALITY AS x(item,ord)
)
WHERE p.id='premium' AND jsonb_typeof(p.features)='array'
  AND p.features @> '["Lavages illimités"]'::jsonb;

-- Créer l’essai avant les autres objets : les gardes ne prévoient aucune
-- exception « abonnement manquant », même pour une clé service.
CREATE OR REPLACE FUNCTION public.bootstrap_company_from_auth_user(
  p_user_id uuid, p_email text, p_meta jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid; v_station uuid; v_role uuid;
  v_company_name text := btrim(COALESCE(p_meta->>'company_name', ''));
  v_station_name text := btrim(COALESCE(p_meta->>'station_name', ''));
  v_owner_name text := btrim(COALESCE(p_meta->>'owner_name', COALESCE(p_email, 'Propriétaire')));
  v_city text := COALESCE(p_meta->>'city', '');
  v_phone text := COALESCE(p_meta->>'phone', '');
BEGIN
  IF v_company_name = '' OR COALESCE((p_meta->>'invitation')::boolean, false) THEN
    RETURN; -- compte invité ou compte sans entreprise : aucun bootstrap
  END IF;
  IF length(v_company_name) < 2 OR length(v_station_name) < 2 THEN
    RAISE EXCEPTION 'Nom d’entreprise ou de station invalide' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user_id) THEN
    RETURN; -- idempotence : un compte = une seule entreprise
  END IF;
  SELECT id INTO v_role FROM public.roles WHERE company_id IS NULL AND key = 'owner';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Rôle propriétaire absent' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.companies (name, city, phone, country_code, currency_code)
    VALUES (v_company_name, v_city, v_phone, 'CI', 'XOF') RETURNING id INTO v_company;
  INSERT INTO public.subscriptions (company_id, plan_id, status, trial_ends_at)
    VALUES (v_company, 'essai', 'trial', now() + interval '14 days');
  INSERT INTO public.stations (company_id, name, city, phone, activated, hours)
    VALUES (v_company, v_station_name, v_city, v_phone, false, '[]'::jsonb) RETURNING id INTO v_station;
  INSERT INTO public.user_profiles (id, company_id, full_name, email, phone, role_id, active)
    VALUES (p_user_id, v_company, v_owner_name, COALESCE(p_email, ''), v_phone, v_role, true);
  INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
    VALUES (v_company, p_user_id, v_station);
  INSERT INTO public.audit_logs (company_id, station_id, actor_user_id, action, entity_type, entity_id)
    VALUES (v_company, v_station, p_user_id, 'company.created', 'companies', v_company::text);
END $$;

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
  INSERT INTO public.subscriptions (company_id, plan_id, status, trial_ends_at)
    VALUES (v_company, 'essai', 'trial', now() + interval '14 days');
  INSERT INTO public.stations (company_id, name, city, phone, activated, hours)
    VALUES (v_company, btrim(p_station_name), COALESCE(p_city,''), COALESCE(p_phone,''), false, '[]'::jsonb) RETURNING id INTO v_station;
  INSERT INTO public.user_profiles (id, company_id, full_name, email, role_id, active)
    VALUES (v_user, v_company, btrim(p_owner_name), COALESCE((SELECT email FROM auth.users WHERE id = v_user), ''), v_role, true);
  INSERT INTO public.user_station_assignments (company_id, user_id, station_id) VALUES (v_company, v_user, v_station);
  INSERT INTO public.audit_logs (company_id, station_id, actor_user_id, action, entity_type, entity_id)
    VALUES (v_company, v_station, v_user, 'company.created', 'companies', v_company::text);
  RETURN v_company;
END $$;
REVOKE ALL ON FUNCTION public.bootstrap_company_from_auth_user(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;

-- La date de fin payante est exclusive à minuit UTC. Un seul calcul est
-- partagé entre l'autorisation et son motif ; l'instant est toujours fourni
-- par le serveur, jamais par le client. Le helper pur permet de tester aussi
-- la microseconde qui précède et celle qui suit exactement la frontière.
CREATE FUNCTION public.subscription_period_reason(
  p_plan text, p_status text, p_trial_ends_at timestamptz, p_period_end date, p_now timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_now IS NULL THEN 'invalid_time'
    WHEN p_status IS NULL OR p_plan IS NULL THEN 'invalid_status'
    WHEN p_status NOT IN ('trial','active') THEN p_status
    WHEN (p_plan = 'essai') IS DISTINCT FROM (p_status = 'trial') THEN 'invalid_status'
    WHEN p_status = 'trial' AND (p_trial_ends_at IS NULL OR p_trial_ends_at <= p_now) THEN 'trial_expired'
    WHEN p_status = 'active' AND (p_period_end IS NULL OR (p_period_end::timestamp AT TIME ZONE 'UTC') <= p_now)
      THEN 'period_expired'
    ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.subscription_period_reason(text,text,timestamptz,date,timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Ces helpers internes ne donnent aucun accès direct au navigateur.
CREATE OR REPLACE FUNCTION public.subscription_writable(p_company uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT NOT c.suspended AND public.subscription_period_reason(
      s.plan_id, s.status, s.trial_ends_at, s.current_period_end, clock_timestamp()) IS NULL
    FROM public.subscriptions s JOIN public.companies c ON c.id = s.company_id
    WHERE s.company_id = p_company
    ORDER BY (s.status IN ('trial','active','past_due')) DESC, s.started_at DESC, s.id DESC
    LIMIT 1
  ), false)
$$;

-- Les lectures d'une formule expirée restent disponibles ; seules les écritures
-- sont bloquées. La formule réellement activée, pas la demande, détermine les modules.
-- VOLATILE permet une nouvelle lecture après une attente sur le verrou de
-- l'abonnement : une validation administrateur concurrente doit être visible.
CREATE OR REPLACE FUNCTION public.subscription_has_feature(p_company uuid, p_feature text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT e.enabled FROM public.subscriptions s
    LEFT JOIN public.plan_entitlements e ON e.plan_id = s.plan_id AND e.feature_key = p_feature
    WHERE s.company_id = p_company
    ORDER BY (s.status IN ('trial','active','past_due')) DESC, s.started_at DESC, s.id DESC
    LIMIT 1
  ), false)
$$;
REVOKE ALL ON FUNCTION public.subscription_writable(uuid), public.subscription_has_feature(uuid,text)
  FROM PUBLIC, anon, authenticated;

-- Utilisé par les politiques RLS restrictives : impossible d'interroger un
-- autre tenant en fournissant son UUID.
CREATE OR REPLACE FUNCTION public.my_company_has_feature(p_company uuid, p_feature text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_platform_admin() OR
    (p_company = public.current_company_id() AND public.subscription_has_feature(p_company, p_feature))
$$;
CREATE OR REPLACE FUNCTION public.my_subscription_can_write() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_platform_admin() OR public.subscription_writable(public.current_company_id())
$$;
REVOKE ALL ON FUNCTION public.my_company_has_feature(uuid,text), public.my_subscription_can_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_has_feature(uuid,text), public.my_subscription_can_write() TO authenticated;

-- Un profil supprimé logiquement ne compte plus dans le quota. Il ne doit pas
-- conserver de droits si une donnée historique a néanmoins active=true.
-- Les administrateurs plateforme restent un mécanisme distinct (platform_admins).
CREATE OR REPLACE FUNCTION public.current_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT company_id FROM public.user_profiles
  WHERE id=auth.uid() AND active=true AND deleted_at IS NULL LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.can_access_station(p_station_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    -- Le rôle propriétaire/gérant donne accès aux stations de SON entreprise,
    -- pas à un UUID arbitraire (ni à une station d'un autre tenant).
    SELECT 1 FROM public.user_profiles p
    JOIN public.stations s ON s.id=p_station_id AND s.company_id=p.company_id
    WHERE p.id=auth.uid() AND p.active=true AND p.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM public.roles r WHERE r.id=p.role_id AND r.key IN ('owner','manager'))
      OR EXISTS (SELECT 1 FROM public.user_station_assignments a
        WHERE a.user_id=p.id AND a.station_id=s.id AND a.company_id=p.company_id)
    )
  )
$$;

-- Les permissions RBAC restent nécessaires, mais ne confèrent jamais un module
-- exclu par la formule. Les comptes client et véhicule restent dans le cœur.
CREATE OR REPLACE FUNCTION public.has_permission(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_platform_admin() OR (
    EXISTS (
      SELECT 1 FROM public.user_profiles p JOIN public.role_permissions rp ON rp.role_id = p.role_id
      WHERE p.id = auth.uid() AND p.active = true AND p.deleted_at IS NULL AND rp.permission_id = p_key
    ) AND CASE
      WHEN p_key LIKE 'inventory.%' THEN public.subscription_has_feature(public.current_company_id(), 'stock')
      WHEN p_key LIKE 'loyalty.%' OR p_key LIKE 'packages.%' OR p_key LIKE 'promotions.%'
        OR p_key LIKE 'notifications.%' OR p_key LIKE 'crm.%'
        THEN public.subscription_has_feature(public.current_company_id(), 'loyalty')
      WHEN p_key LIKE 'fleets.%' THEN public.subscription_has_feature(public.current_company_id(), 'fleets')
      WHEN p_key IN ('analytics.view','analytics.compare')
        THEN public.subscription_has_feature(public.current_company_id(), 'consolidation')
      WHEN p_key = 'audit.view' THEN public.subscription_has_feature(public.current_company_id(), 'audit')
      ELSE true
    END
  )
$$;

-- Le contexte Auth doit annoncer le même état que les helpers RBAC ci-dessus.
-- Reprise de la projection station de 054, sans réactiver un profil supprimé.
CREATE OR REPLACE FUNCTION public.my_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid(); v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin(); v_profile public.user_profiles%ROWTYPE;
  v_role_key text; v_permissions text[]; v_company_json jsonb; v_stations jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('userId',NULL,'authenticated',false);
  END IF;
  SELECT * INTO v_profile FROM public.user_profiles WHERE id=v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId',v_user,'authenticated',true,'profileReady',false,
      'isPlatformAdmin',v_admin,'company',NULL,'stations','[]'::jsonb,'permissions','[]'::jsonb);
  END IF;
  SELECT key INTO v_role_key FROM public.roles WHERE id=v_profile.role_id;
  IF v_admin THEN
    SELECT array_agg(key ORDER BY key) INTO v_permissions FROM public.permissions;
  ELSIF v_profile.active AND v_profile.deleted_at IS NULL THEN
    SELECT COALESCE(array_agg(rp.permission_id ORDER BY rp.permission_id),ARRAY[]::text[])
      INTO v_permissions FROM public.role_permissions rp WHERE rp.role_id=v_profile.role_id;
  ELSE
    v_permissions := ARRAY[]::text[];
  END IF;
  SELECT to_jsonb(c)-'updated_at'-'deleted_at' INTO v_company_json
    FROM public.companies c WHERE c.id=v_company;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'city',s.city,'address',s.address,'phone',s.phone,
    'hours',s.hours,'activated',s.activated,'activatedAt',s.activated_at,'logoPath',s.logo_path
  ) ORDER BY s.created_at),'[]'::jsonb) INTO v_stations
    FROM public.stations s WHERE s.company_id=v_company AND s.deleted_at IS NULL
      AND (v_admin OR public.can_access_station(s.id));
  RETURN jsonb_build_object(
    'userId',v_user,'authenticated',true,'profileReady',true,
    'active',v_profile.active AND v_profile.deleted_at IS NULL
      AND COALESCE(v_company_json->>'suspended','false')<>'true',
    'email',COALESCE((SELECT email FROM auth.users WHERE id=v_user),v_profile.email),
    'fullName',v_profile.full_name,'roleKey',COALESCE(v_role_key,''),
    'isPlatformAdmin',v_admin,'company',v_company_json,'companyId',v_company,
    'stations',v_stations,'permissions',to_jsonb(COALESCE(v_permissions,ARRAY[]::text[]))
  );
END $$;
REVOKE ALL ON FUNCTION public.my_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_context() TO authenticated;

-- Lecture accessible à chaque membre du tenant. Les limites et les capacités
-- proviennent de la formule effective ; un changement demandé n'est pas une activation.
CREATE OR REPLACE FUNCTION public.my_subscription_access() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_sub public.subscriptions%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_reason text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Session et entreprise actives requises' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM public.subscriptions s WHERE s.company_id = v_company
    ORDER BY (s.status IN ('trial','active','past_due')) DESC, s.started_at DESC, s.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Abonnement introuvable : contactez un administrateur' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id = v_sub.plan_id;
  v_reason := CASE
    WHEN (SELECT suspended FROM public.companies WHERE id = v_company) THEN 'company_suspended'
    ELSE public.subscription_period_reason(v_sub.plan_id, v_sub.status, v_sub.trial_ends_at, v_sub.current_period_end, v_now)
  END;
  RETURN jsonb_build_object(
    'id', v_sub.id, 'companyId', v_company, 'planId', v_sub.plan_id,
    'planName', v_plan.name, 'status', v_sub.status, 'startedAt', v_sub.started_at,
    'trialEndsAt', v_sub.trial_ends_at, 'currentPeriodEnd', v_sub.current_period_end,
    'pendingPlanId', v_sub.pending_plan_id,
    'canWrite', v_reason IS NULL, 'reason', v_reason,
    'serverTime', v_now,
    'employeeLimit', public.current_plan_limit(v_company, 'employees'),
    'activeAccounts', (SELECT count(*) FROM public.user_profiles u
      WHERE u.company_id = v_company AND u.active AND u.deleted_at IS NULL),
    'features', jsonb_build_object(
      'stock', public.subscription_has_feature(v_company,'stock'),
      'loyalty', public.subscription_has_feature(v_company,'loyalty'),
      'fleets', public.subscription_has_feature(v_company,'fleets'),
      'consolidation', public.subscription_has_feature(v_company,'consolidation'),
      'audit', public.subscription_has_feature(v_company,'audit'))
  );
END $$;
REVOKE ALL ON FUNCTION public.my_subscription_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_subscription_access() TO authenticated;

-- Capacité éphémère, non forgeable par un JWT ou un paramètre de session :
-- seule la RPC SECURITY DEFINER de retrait crée cette ligne, après contrôle du
-- rôle, du tenant, de la station et de la preuve. Elle la supprime avant de
-- rendre la main ; une erreur annule aussi la ligne dans la transaction. Le
-- PID et le numéro de transaction empêchent son usage par une autre session.
-- Aucun rôle d'API, y compris service_role, n'a accès au schéma ou à la table.
CREATE SCHEMA lavauto_private;
REVOKE ALL ON SCHEMA lavauto_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE lavauto_private.whatsapp_withdrawal_context (
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  company_id uuid NOT NULL,
  station_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_at timestamptz NOT NULL,
  phone_e164 text,
  source text NOT NULL,
  PRIMARY KEY (transaction_id, backend_pid, customer_id)
);
ALTER TABLE lavauto_private.whatsapp_withdrawal_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lavauto_private.whatsapp_withdrawal_context FROM PUBLIC, anon, authenticated, service_role;

-- Toute écriture métier est contrôlée au niveau de la table, y compris depuis
-- une ancienne RPC SECURITY DEFINER. Les journaux, demandes et snapshots d'usage
-- restent disponibles en lecture seule ; les rôles de maintenance sont fiables.
CREATE OR REPLACE FUNCTION public.enforce_subscription_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_feature text := NULLIF(TG_ARGV[0], '');
BEGIN
  IF public.is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  -- Le fournisseur peut répondre après expiration. Le rôle de service ne peut
  -- pas mettre une nouvelle demande en attente ni réclamer un envoi en lecture
  -- seule, mais il doit pouvoir enregistrer un résultat déjà en vol et annuler
  -- une relance devenue inutile. Ces tables ne sont pas accessibles au client.
  IF current_setting('role', true) = 'service_role' THEN
    -- Les champs NEW diffèrent selon la table : séparer les branches évite
    -- leur résolution sur une autre table (ex. stations n'a pas de kind).
    IF TG_TABLE_NAME = 'wash_whatsapp_events' THEN
      IF TG_OP = 'INSERT' AND NEW.kind IN ('unknown','accepted','sent','delivered','read','failed','cancelled') THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'wash_whatsapp_notifications' THEN
      IF TG_OP = 'UPDATE' AND NEW.company_id = OLD.company_id AND NEW.station_id = OLD.station_id
        AND NEW.wash_id = OLD.wash_id AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
        AND NEW.consent_event_id IS NOT DISTINCT FROM OLD.consent_event_id
        AND NEW.recipient_e164 IS NOT DISTINCT FROM OLD.recipient_e164
        AND NEW.origin = OLD.origin AND NEW.request_key = OLD.request_key
        AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by AND NEW.created_at = OLD.created_at
        AND ((OLD.status = 'pending' AND NEW.status = 'cancelled') OR
          (OLD.status IN ('sending','unknown','accepted','sent','delivered','read','failed')
            AND NEW.status IN ('unknown','accepted','sent','delivered','read','failed'))) THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN v_company := OLD.company_id; ELSE v_company := NEW.company_id; END IF;
  IF v_company IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  -- Les décisions administrateur prennent un verrou exclusif sur cette ligne.
  -- Une opération déjà engagée se termine avant le changement de formule ;
  -- en son absence on refuse, même lorsque l'appel vient du rôle service.
  PERFORM 1 FROM public.subscriptions WHERE company_id = v_company
    ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC
    LIMIT 1 FOR SHARE;
  IF NOT public.subscription_writable(v_company) THEN
    -- Exception strictement réservée au retrait demandé par le client lorsque
    -- l'essai ou la période payante ont expiré. Une simple variable de session
    -- ou un UPDATE direct ne peut pas la fabriquer. Les autres motifs de
    -- lecture seule et les gardes d'identité/station restent inchangés.
    IF TG_TABLE_NAME IN ('whatsapp_consent_events','customers','wash_whatsapp_notifications','wash_whatsapp_events')
      AND EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context x
        WHERE x.transaction_id=txid_current() AND x.backend_pid=pg_backend_pid()
          AND x.company_id=v_company AND x.actor_user_id=auth.uid()) THEN
      -- Une suspension concurrente est ordonnée avec ce retrait ; le verrou
      -- d'abonnement ci-dessus ordonne aussi une éventuelle réactivation.
      PERFORM 1 FROM public.companies WHERE id=v_company AND NOT suspended AND deleted_at IS NULL FOR SHARE;
      IF FOUND AND EXISTS (
        SELECT 1 FROM public.subscriptions s WHERE s.company_id=v_company
          AND s.id=(SELECT id FROM public.subscriptions WHERE company_id=v_company
            ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC LIMIT 1)
          AND public.subscription_period_reason(s.plan_id,s.status,s.trial_ends_at,s.current_period_end,clock_timestamp())
            IN ('trial_expired','period_expired')
      ) THEN
        IF TG_TABLE_NAME='whatsapp_consent_events' AND TG_OP='INSERT' THEN
          IF NEW.kind='revoked' AND EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context x
            WHERE x.transaction_id=txid_current() AND x.backend_pid=pg_backend_pid()
              AND x.company_id=NEW.company_id AND x.station_id=NEW.station_id AND x.customer_id=NEW.customer_id
              AND x.actor_user_id=auth.uid() AND NEW.actor_user_id=x.actor_user_id AND NEW.id=x.event_id
              AND NEW.created_at=x.event_at AND NEW.source=x.source AND NEW.phone_e164 IS NOT DISTINCT FROM x.phone_e164)
          THEN RETURN NEW; END IF;
        ELSIF TG_TABLE_NAME='customers' AND TG_OP='UPDATE' THEN
          IF NOT NEW.whatsapp_consent_granted AND NEW.whatsapp_consent_phone IS NULL
            AND (to_jsonb(NEW)-ARRAY['whatsapp_consent_granted','whatsapp_consent_phone','whatsapp_consent_event_id','whatsapp_consent_at','updated_at'])
              IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['whatsapp_consent_granted','whatsapp_consent_phone','whatsapp_consent_event_id','whatsapp_consent_at','updated_at'])
            AND EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context x
              WHERE x.transaction_id=txid_current() AND x.backend_pid=pg_backend_pid()
                AND x.company_id=NEW.company_id AND x.station_id=NEW.station_id AND x.customer_id=NEW.id
                AND x.actor_user_id=auth.uid() AND NEW.whatsapp_consent_event_id=x.event_id
                AND NEW.whatsapp_consent_at=x.event_at AND NEW.updated_at=x.event_at)
          THEN RETURN NEW; END IF;
        ELSIF TG_TABLE_NAME='wash_whatsapp_notifications' AND TG_OP='UPDATE' THEN
          IF OLD.status='pending' AND NEW.status='cancelled' AND NEW.reason_code='consent_revoked'
            AND (to_jsonb(NEW)-ARRAY['status','reason_code','updated_at'])
              IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reason_code','updated_at'])
            AND EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context x
              WHERE x.transaction_id=txid_current() AND x.backend_pid=pg_backend_pid()
                AND x.company_id=NEW.company_id AND x.station_id=NEW.station_id AND x.customer_id=NEW.customer_id
                AND x.actor_user_id=auth.uid())
          THEN RETURN NEW; END IF;
        ELSIF TG_TABLE_NAME='wash_whatsapp_events' AND TG_OP='INSERT' THEN
          IF NEW.kind='cancelled' AND NEW.reason_code='consent_revoked'
            AND NEW.provider_at IS NULL AND NEW.provider_event_key IS NULL
            AND EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context x
              JOIN public.wash_whatsapp_notifications n ON n.id=NEW.notification_id
                AND n.company_id=x.company_id AND n.station_id=x.station_id AND n.customer_id=x.customer_id
              WHERE x.transaction_id=txid_current() AND x.backend_pid=pg_backend_pid()
                AND x.company_id=NEW.company_id AND x.station_id=NEW.station_id AND x.actor_user_id=auth.uid()
                AND n.status='cancelled' AND n.reason_code='consent_revoked')
          THEN RETURN NEW; END IF;
        END IF;
      END IF;
    END IF;
    RAISE EXCEPTION 'Abonnement en lecture seule : verifiez la formule avant toute operation'
      USING ERRCODE = '42501';
  END IF;
  IF v_feature IS NOT NULL AND NOT public.subscription_has_feature(v_company, v_feature) THEN
    RAISE EXCEPTION 'Module % non inclus dans la formule active', v_feature USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.enforce_subscription_access() FROM PUBLIC, anon, authenticated;

-- Même contrat public qu'en 053. La capacité privée n'existe que pendant un
-- retrait contrôlé ; les déclencheurs ci-dessus n'acceptent que les lignes et
-- colonnes nécessaires à cette opération. Un accord n'obtient jamais cette
-- capacité et reste soumis à la garde habituelle d'abonnement.
CREATE OR REPLACE FUNCTION public.save_customer_whatsapp_consent(
  p_customer_id uuid, p_granted boolean, p_source text, p_expected_phone text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid; v_customer public.customers%ROWTYPE; v_profile public.user_profiles%ROWTYPE;
  v_actor uuid := auth.uid(); v_platform boolean := false; v_role_key text;
  v_phone text; v_source text := btrim(COALESCE(p_source,''));
  v_event uuid := gen_random_uuid(); v_at timestamptz;
BEGIN
  -- Fixer les droits pendant le retrait : une désactivation, un changement de
  -- rôle ou la suppression de la permission déjà engagés doivent gagner ;
  -- ceux qui arrivent après attendent la fin de cette transaction.
  SELECT * INTO v_profile FROM public.user_profiles WHERE id=v_actor FOR SHARE;
  IF NOT FOUND OR NOT v_profile.active OR v_profile.deleted_at IS NOT NULL OR v_profile.company_id IS NULL THEN
    RAISE EXCEPTION 'Permission customers.manage requise' USING ERRCODE='42501';
  END IF;
  v_company := v_profile.company_id;
  PERFORM 1 FROM public.platform_admins WHERE user_id=v_actor FOR SHARE;
  v_platform := FOUND;
  SELECT key INTO v_role_key FROM public.roles WHERE id=v_profile.role_id FOR SHARE;
  IF NOT v_platform THEN
    PERFORM 1 FROM public.role_permissions WHERE role_id=v_profile.role_id AND permission_id='customers.manage' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Permission customers.manage requise' USING ERRCODE='42501'; END IF;
  END IF;
  IF NOT public.has_permission('customers.manage') THEN
    RAISE EXCEPTION 'Permission customers.manage requise' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND company_id=v_company AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable' USING ERRCODE='P0002'; END IF;
  -- Le propriétaire/gérant a accès aux stations de son entreprise ; pour les
  -- autres rôles, verrouiller aussi l'affectation qui justifie cet accès.
  PERFORM 1 FROM public.stations WHERE id=v_customer.station_id AND company_id=v_company AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Station inaccessible' USING ERRCODE='42501'; END IF;
  IF NOT v_platform AND v_role_key NOT IN ('owner','manager') THEN
    PERFORM 1 FROM public.user_station_assignments WHERE user_id=v_actor AND company_id=v_company
      AND station_id=v_customer.station_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Station inaccessible' USING ERRCODE='42501'; END IF;
  END IF;
  PERFORM public.assert_crm_station(v_customer.station_id);
  IF p_granted IS NULL OR length(v_source) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Décrivez la source de l’accord ou du retrait (5 à 500 caractères)' USING ERRCODE='23514';
  END IF;
  v_phone := public.whatsapp_normalize_phone(v_customer.phone);
  IF p_granted AND v_phone IS NULL THEN
    RAISE EXCEPTION 'Téléphone international requis, par exemple +2250700000000' USING ERRCODE='23514';
  END IF;
  IF p_granted AND public.whatsapp_normalize_phone(p_expected_phone) IS DISTINCT FROM v_phone THEN
    RAISE EXCEPTION 'Numéro confirmé différent du numéro enregistré. Rechargez la page et vérifiez la fiche client avant de réessayer.' USING ERRCODE='23514';
  END IF;
  -- La date reflète la prise du verrou client, pas le début d'une attente.
  v_at := clock_timestamp();
  IF NOT p_granted THEN
    INSERT INTO lavauto_private.whatsapp_withdrawal_context
      (transaction_id,backend_pid,company_id,station_id,customer_id,actor_user_id,event_id,event_at,phone_e164,source)
    VALUES (txid_current(),pg_backend_pid(),v_company,v_customer.station_id,v_customer.id,auth.uid(),v_event,v_at,
      COALESCE(v_customer.whatsapp_consent_phone,v_phone),v_source);
  END IF;
  INSERT INTO public.whatsapp_consent_events (id,company_id,station_id,customer_id,kind,phone_e164,source,actor_user_id,created_at)
  VALUES (v_event,v_company,v_customer.station_id,v_customer.id,
    CASE WHEN p_granted THEN 'granted' ELSE 'revoked' END,
    CASE WHEN p_granted THEN v_phone ELSE COALESCE(v_customer.whatsapp_consent_phone,v_phone) END,
    v_source,auth.uid(),v_at);
  UPDATE public.customers SET whatsapp_consent_granted=p_granted,
    whatsapp_consent_phone=CASE WHEN p_granted THEN v_phone ELSE NULL END,
    whatsapp_consent_event_id=v_event, whatsapp_consent_at=v_at, updated_at=v_at
  WHERE id=v_customer.id;
  PERFORM public.whatsapp_cancel_pending_for_customer(v_customer.id,CASE WHEN p_granted THEN 'consent_replaced' ELSE 'consent_revoked' END);
  IF NOT p_granted THEN
    DELETE FROM lavauto_private.whatsapp_withdrawal_context
      WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND customer_id=v_customer.id;
  END IF;
  RETURN v_event;
END $$;
REVOKE ALL ON FUNCTION public.save_customer_whatsapp_consent(uuid,boolean,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_customer_whatsapp_consent(uuid,boolean,text,text) TO authenticated;

DO $$
DECLARE t record; v_feature text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='company_id' AND x.table_type='BASE TABLE'
      AND c.table_name NOT IN ('subscriptions','subscription_changes','subscription_usage',
        'audit_logs','platform_audit_logs','roles')
  LOOP
    v_feature := CASE
      WHEN t.table_name IN ('product_categories','suppliers','products','purchase_orders','purchase_order_items',
        'stock_movements','stock_levels','inventory_sessions','inventory_items','service_product_consumptions',
        'stock_receipt_events','stock_consumption_runs','finance_cost_periods') THEN 'stock'
      WHEN t.table_name IN ('loyalty_programs','loyalty_cards','loyalty_transactions','packages',
        'customer_packages','package_usages','promotions','promotion_usages','notification_outbox') THEN 'loyalty'
      WHEN t.table_name IN ('fleets','fleet_contracts','fleet_vehicles','fleet_receivables') THEN 'fleets'
      ELSE '' END;
    -- Avant les triggers de quota : même ordre abonnement → verrou de quota
    -- dans les RPC multi-tables, pour éviter les inversions de verrous.
    EXECUTE format('CREATE TRIGGER aa_subscription_access BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_access(%L)', t.table_name, v_feature);
  END LOOP;
END $$;

-- Les modifications de l'entreprise n'ont pas de colonne company_id.
CREATE OR REPLACE FUNCTION public.enforce_company_subscription_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    PERFORM 1 FROM public.subscriptions WHERE company_id=OLD.id
      ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC
      LIMIT 1 FOR SHARE;
    IF NOT public.subscription_writable(OLD.id) THEN
      RAISE EXCEPTION 'Abonnement en lecture seule : modification impossible' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wg_company_subscription_access BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_subscription_access();
REVOKE ALL ON FUNCTION public.enforce_company_subscription_access() FROM PUBLIC, anon, authenticated;

-- 012 autorisait encore les écritures directes d'identité aux gestionnaires :
-- un gérant pouvait ainsi modifier role_id et se donner les droits du
-- propriétaire, ou contourner les permissions fines de la RPC. Fermer à la
-- fois les grants ET les anciennes policies d'écriture ; les policies SELECT
-- restent en place. Les commandes SECURITY DEFINER et le service de confiance
-- continuent à fonctionner, sous leurs contrôles et les triggers d'abonnement.
DROP POLICY IF EXISTS p_user_profiles_insert ON public.user_profiles;
DROP POLICY IF EXISTS p_user_profiles_update ON public.user_profiles;
DROP POLICY IF EXISTS p_user_station_assignments_manage ON public.user_station_assignments;
DROP POLICY IF EXISTS p_user_invitations_insert ON public.user_invitations;
DROP POLICY IF EXISTS p_user_invitations_update ON public.user_invitations;
REVOKE INSERT, UPDATE, DELETE ON public.user_profiles, public.user_station_assignments,
  public.user_invitations FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_profiles','user_station_assignments','user_invitations'] LOOP
    EXECUTE format('CREATE POLICY wg_identity_no_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false)',t);
    EXECUTE format('CREATE POLICY wg_identity_no_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false)',t);
    EXECUTE format('CREATE POLICY wg_identity_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)',t);
  END LOOP;
END $$;

-- Les fiches client et véhicule appartiennent au cœur Standard. Lors d'un
-- retour depuis Premium, une modification ordinaire ne doit ni effacer ni
-- modifier silencieusement l'adhésion ou l'affectation à une flotte conservée.
CREATE OR REPLACE FUNCTION public.preserve_advanced_customer_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.is_platform_admin() THEN RETURN NEW; END IF;
  -- Un changement portant uniquement sur le consentement ne doit pas
  -- réécrire les préférences CRM héritées d'une ancienne formule, en
  -- particulier lors d'un retrait autorisé après expiration.
  IF TG_TABLE_NAME='customers' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['whatsapp_consent_granted','whatsapp_consent_phone','whatsapp_consent_event_id','whatsapp_consent_at','updated_at'])
      IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['whatsapp_consent_granted','whatsapp_consent_phone','whatsapp_consent_event_id','whatsapp_consent_at','updated_at'])
    THEN RETURN NEW; END IF;
  END IF;
  IF NOT public.subscription_has_feature(NEW.company_id,'fleets') THEN
    IF TG_OP='UPDATE' THEN
      NEW.fleet_id := OLD.fleet_id;
      IF TG_TABLE_NAME='customers' THEN NEW.customer_type := OLD.customer_type; END IF;
    ELSE
      NEW.fleet_id := NULL;
      IF TG_TABLE_NAME='customers' THEN NEW.customer_type := 'individual'; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME='customers' AND NOT public.subscription_has_feature(NEW.company_id,'loyalty') THEN
    IF TG_OP='UPDATE' THEN NEW.loyalty_opt_in := OLD.loyalty_opt_in;
    ELSE NEW.loyalty_opt_in := false; END IF;
    NEW.communication_preferences := jsonb_set(COALESCE(NEW.communication_preferences, '{}'::jsonb),
      '{optIn}', to_jsonb(NEW.loyalty_opt_in), true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wg_customer_advanced_fields BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.preserve_advanced_customer_fields();
CREATE TRIGGER wg_vehicle_advanced_fields BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.preserve_advanced_customer_fields();
REVOKE ALL ON FUNCTION public.preserve_advanced_customer_fields() FROM PUBLIC, anon, authenticated;

-- Défense en profondeur pour les lectures de tables exposées par RLS.
DO $$
DECLARE t text; f text;
BEGIN
  FOR t, f IN SELECT * FROM (VALUES
    ('product_categories','stock'),('suppliers','stock'),('products','stock'),('purchase_orders','stock'),
    ('purchase_order_items','stock'),('stock_movements','stock'),('stock_levels','stock'),
    ('inventory_sessions','stock'),('inventory_items','stock'),('service_product_consumptions','stock'),
    ('stock_receipt_events','stock'),('stock_consumption_runs','stock'),('finance_cost_periods','stock'),
    ('loyalty_programs','loyalty'),('loyalty_cards','loyalty'),('loyalty_transactions','loyalty'),
    ('packages','loyalty'),('customer_packages','loyalty'),('package_usages','loyalty'),
    ('promotions','loyalty'),('promotion_usages','loyalty'),('notification_outbox','loyalty'),
    ('fleets','fleets'),('fleet_contracts','fleets'),('fleet_vehicles','fleets'),('fleet_receivables','fleets'),
    ('audit_logs','audit')
  ) AS x(table_name, feature_key) LOOP
    EXECUTE format('CREATE POLICY wg_plan_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.my_company_has_feature(company_id, %L))', t, f);
  END LOOP;
END $$;

-- Quelques tables du cœur contiennent aussi des colonnes propres au CRM
-- Premium. PostgreSQL ne peut pas masquer une colonne selon une politique de
-- ligne : ne laisser aux clients directs que les colonnes essentielles. Les
-- projections SECURITY DEFINER exposent les champs avancés selon la formule.
-- Les anciens clients qui utilisent SELECT * sur ces tables doivent migrer.
REVOKE SELECT ON public.customers, public.vehicles, public.washes FROM PUBLIC, anon, authenticated;
REVOKE SELECT (communication_preferences, customer_type, loyalty_opt_in, fleet_id,
  whatsapp_consent_granted, whatsapp_consent_phone, whatsapp_consent_event_id, whatsapp_consent_at)
  ON public.customers FROM PUBLIC, anon, authenticated;
REVOKE SELECT (fleet_id) ON public.vehicles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (promotion_id, promotion_discount_minor, package_id, fleet_contract_id,
  loyalty_points_earned, loyalty_points_redeemed) ON public.washes FROM PUBLIC, anon, authenticated;
-- Le consentement transactionnel et ses preuves ne sont consultables que par
-- my_customer_whatsapp_consent(), qui vérifie clients et station, pas par un
-- simple SELECT accordé à tous les profils du tenant.
GRANT SELECT (id, company_id, station_id, name, phone, email, notes, created_at, updated_at, deleted_at,
  preferred_channel) ON public.customers TO authenticated;
GRANT SELECT (id, company_id, station_id, customer_id, vehicle_category_id, plate, brand, model,
  color, created_at, updated_at, deleted_at, is_active) ON public.vehicles TO authenticated;
GRANT SELECT (id, company_id, station_id, number, customer_id, customer_name, vehicle_id, vehicle_category_id,
  vehicle_label, plate, discount_minor, total_minor, paid_minor, status, idempotency_key, created_by,
  created_at, updated_at, finished_at, delivered_at, cancelled_at, cancelled_reason, deleted_at)
  ON public.washes TO authenticated;

-- Le board CRM partage clients/véhicules (Standard) et modules Premium. Ses
-- anciennes versions SECURITY DEFINER sont enveloppées pour masquer les parties
-- non incluses, sans effacer les données lors d'un changement de formule.
ALTER FUNCTION public.my_station_crm_board(uuid) RENAME TO wg_station_crm_board_unfiltered;
ALTER FUNCTION public.my_crm_board() RENAME TO wg_crm_board_unfiltered;
REVOKE ALL ON FUNCTION public.wg_station_crm_board_unfiltered(uuid), public.wg_crm_board_unfiltered()
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.redact_crm_for_subscription(p_board jsonb, p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb := p_board; k text;
BEGIN
  IF NOT public.subscription_has_feature(p_company,'loyalty') AND NOT public.is_platform_admin() THEN
    FOREACH k IN ARRAY ARRAY['loyaltyPrograms','loyaltyCards','loyaltyTransactions','packagePlans',
      'customerPackages','packageUsages','promotions','promotionUsages','notificationOutbox'] LOOP
      v := jsonb_set(v, ARRAY[k], '[]'::jsonb, true);
    END LOOP;
    FOREACH k IN ARRAY ARRAY['activeCards','activePackages','activePromotions','pendingNotifications'] LOOP
      v := jsonb_set(v, ARRAY['stats',k], 'null'::jsonb, true);
    END LOOP;
    v := jsonb_set(v, '{clients}', COALESCE((SELECT jsonb_agg(item - 'loyaltyOptIn' ORDER BY ord)
      FROM jsonb_array_elements(v->'clients') WITH ORDINALITY AS x(item,ord)), '[]'::jsonb));
  END IF;
  IF NOT public.subscription_has_feature(p_company,'fleets') AND NOT public.is_platform_admin() THEN
    FOREACH k IN ARRAY ARRAY['fleets','fleetContracts','fleetVehicles','fleetReceivables'] LOOP
      v := jsonb_set(v, ARRAY[k], '[]'::jsonb, true);
    END LOOP;
    FOREACH k IN ARRAY ARRAY['fleets','openReceivablesMinor'] LOOP
      v := jsonb_set(v, ARRAY['stats',k], 'null'::jsonb, true);
    END LOOP;
    v := jsonb_set(v, '{clients}', COALESCE((SELECT jsonb_agg(item - 'fleetId' - 'customerType' ORDER BY ord)
      FROM jsonb_array_elements(v->'clients') WITH ORDINALITY AS x(item,ord)), '[]'::jsonb));
    v := jsonb_set(v, '{vehicles}', COALESCE((SELECT jsonb_agg(item - 'fleetId' ORDER BY ord)
      FROM jsonb_array_elements(v->'vehicles') WITH ORDINALITY AS x(item,ord)), '[]'::jsonb));
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.redact_crm_for_subscription(jsonb,uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.my_station_crm_board(p_station_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.redact_crm_for_subscription(public.wg_station_crm_board_unfiltered(p_station_id), public.current_company_id())
$$;
CREATE FUNCTION public.my_crm_board() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.redact_crm_for_subscription(public.wg_crm_board_unfiltered(), public.current_company_id())
$$;
REVOKE ALL ON FUNCTION public.my_station_crm_board(uuid), public.my_crm_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_station_crm_board(uuid), public.my_crm_board() TO authenticated;

-- Les rapports essentiels sont inclus dans Standard, mais les anciennes RPC
-- SECURITY DEFINER lisaient aussi les mouvements et attestations de stock en
-- contournant la RLS. Les montants masqués sont NULL, jamais des zéros. Il faut
-- filtrer les deux entrées : le rapport consolidé peut relire une attestation
-- même lorsque le rapport de station a déjà été filtré.
ALTER FUNCTION public.my_station_profitability(uuid,date,date) RENAME TO wg_station_profitability_unfiltered;
ALTER FUNCTION public.my_accessible_profitability(date,date) RENAME TO wg_accessible_profitability_unfiltered;
REVOKE ALL ON FUNCTION public.wg_station_profitability_unfiltered(uuid,date,date),
  public.wg_accessible_profitability_unfiltered(date,date) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.redact_profitability_for_subscription(p_report jsonb, p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() AND NOT public.subscription_has_feature(p_company,'stock') THEN
    RETURN p_report || jsonb_build_object(
      'purchases', NULL, 'consumptions', NULL, 'operatingExpenses', NULL, 'fixedCosts', NULL,
      'grossMargin', NULL, 'result', NULL, 'certified', false, 'costsMissing', true,
      'certifiedAt', NULL, 'attestation', NULL,
      'label', 'Coûts de stock et certification non disponibles dans cette formule',
      'missing', jsonb_build_array('Module stock et certification non inclus')
    );
  END IF;
  RETURN p_report;
END $$;
REVOKE ALL ON FUNCTION public.redact_profitability_for_subscription(jsonb,uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.my_station_profitability(p_station_id uuid, p_start date, p_end date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.redact_profitability_for_subscription(
    public.wg_station_profitability_unfiltered(p_station_id,p_start,p_end), public.current_company_id())
$$;
CREATE FUNCTION public.my_accessible_profitability(p_start date, p_end date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.redact_profitability_for_subscription(
    public.wg_accessible_profitability_unfiltered(p_start,p_end), public.current_company_id())
$$;
REVOKE ALL ON FUNCTION public.my_station_profitability(uuid,date,date), public.my_accessible_profitability(date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_station_profitability(uuid,date,date), public.my_accessible_profitability(date,date)
  TO authenticated;

-- Les droits sont indépendants : une formule personnalisée pourrait inclure
-- la consolidation sans le stock. Filtrer aussi les agrégats par station des
-- deux versions du board analytique dans ce cas.
ALTER FUNCTION public.my_accessible_analytics_board(date,date,date,date) RENAME TO wg_accessible_analytics_unfiltered;
ALTER FUNCTION public.my_analytics_board(date,date,date,date) RENAME TO wg_analytics_unfiltered;
REVOKE ALL ON FUNCTION public.wg_accessible_analytics_unfiltered(date,date,date,date),
  public.wg_analytics_unfiltered(date,date,date,date) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.redact_analytics_for_subscription(p_board jsonb, p_company uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb := p_board;
BEGIN
  IF NOT public.is_platform_admin() AND NOT public.subscription_has_feature(p_company,'stock') THEN
    v := jsonb_set(v, '{period}', public.redact_profitability_for_subscription(v->'period',p_company));
    IF v->'compare' IS NOT NULL AND v->'compare' <> 'null'::jsonb THEN
      v := jsonb_set(v, '{compare}', public.redact_profitability_for_subscription(v->'compare',p_company));
    END IF;
    v := jsonb_set(v, '{stations}', COALESCE((SELECT jsonb_agg(
      item || jsonb_build_object('consumptions',NULL,'grossMargin',NULL,'result',NULL,'certified',false) ORDER BY ord)
      FROM jsonb_array_elements(v->'stations') WITH ORDINALITY AS x(item,ord)), '[]'::jsonb));
    v := jsonb_set(v, '{stats,certified}', 'false'::jsonb);
  END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.redact_analytics_for_subscription(jsonb,uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.my_accessible_analytics_board(
  p_start date DEFAULT (date_trunc('month',now()))::date, p_end date DEFAULT current_date,
  p_compare_start date DEFAULT NULL, p_compare_end date DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.redact_analytics_for_subscription(
    public.wg_accessible_analytics_unfiltered(p_start,p_end,p_compare_start,p_compare_end), public.current_company_id())
$$;
CREATE FUNCTION public.my_analytics_board(
  p_start date DEFAULT (date_trunc('month',now()))::date, p_end date DEFAULT current_date,
  p_compare_start date DEFAULT NULL, p_compare_end date DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.redact_analytics_for_subscription(
    public.wg_analytics_unfiltered(p_start,p_end,p_compare_start,p_compare_end), public.current_company_id())
$$;
REVOKE ALL ON FUNCTION public.my_accessible_analytics_board(date,date,date,date),
  public.my_analytics_board(date,date,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_accessible_analytics_board(date,date,date,date),
  public.my_analytics_board(date,date,date,date) TO authenticated;

-- Certaines anciennes commandes acceptaient une permission du cœur (catalogue,
-- clients, lavage ou paramètres) comme alternative à la permission du module.
-- Contrôler le module avant toute lecture/idempotence, puis garder le verrou
-- jusqu'à la fin de la commande : un changement de formule ne peut s'intercaler.
CREATE FUNCTION public.assert_subscription_module(p_feature text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF public.is_platform_admin() THEN RETURN; END IF;
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Session et entreprise requises' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.subscriptions WHERE company_id = v_company
    ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC
    LIMIT 1 FOR SHARE;
  IF NOT public.subscription_writable(v_company) OR NOT public.subscription_has_feature(v_company,p_feature) THEN
    RAISE EXCEPTION 'Module non inclus ou abonnement en lecture seule' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_subscription_module(text) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.save_product_category(uuid,text,boolean) RENAME TO wg_save_product_category_unchecked;
ALTER FUNCTION public.save_product(uuid,text,text,text,text,integer,boolean,uuid) RENAME TO wg_save_product_unchecked;
ALTER FUNCTION public.save_service_consumption(uuid,uuid,numeric,boolean) RENAME TO wg_save_service_consumption_unchecked;
ALTER FUNCTION public.link_expense_to_purchase_order(uuid,uuid) RENAME TO wg_link_expense_to_purchase_order_unchecked;
ALTER FUNCTION public.certify_profitability_period(date,date,text) RENAME TO wg_certify_profitability_period_unchecked;
ALTER FUNCTION public.accrue_loyalty_for_wash(uuid,text) RENAME TO wg_accrue_loyalty_for_wash_unchecked;
ALTER FUNCTION public.consume_package_for_wash(uuid) RENAME TO wg_consume_package_for_wash_unchecked;
ALTER FUNCTION public.apply_promotion_to_wash(uuid,text,text) RENAME TO wg_apply_promotion_to_wash_unchecked;
REVOKE ALL ON FUNCTION public.wg_save_product_category_unchecked(uuid,text,boolean),
  public.wg_save_product_unchecked(uuid,text,text,text,text,integer,boolean,uuid),
  public.wg_save_service_consumption_unchecked(uuid,uuid,numeric,boolean),
  public.wg_link_expense_to_purchase_order_unchecked(uuid,uuid),
  public.wg_certify_profitability_period_unchecked(date,date,text),
  public.wg_accrue_loyalty_for_wash_unchecked(uuid,text),
  public.wg_consume_package_for_wash_unchecked(uuid),
  public.wg_apply_promotion_to_wash_unchecked(uuid,text,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_product_category(p_station_id uuid, p_name text, p_active boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('stock');
  RETURN public.wg_save_product_category_unchecked(p_station_id,p_name,p_active);
END $$;
CREATE FUNCTION public.save_product(p_station_id uuid, p_name text, p_sku text DEFAULT '', p_category text DEFAULT '',
  p_unit text DEFAULT 'unité', p_reorder_level integer DEFAULT 0, p_active boolean DEFAULT true, p_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('stock');
  RETURN public.wg_save_product_unchecked(p_station_id,p_name,p_sku,p_category,p_unit,p_reorder_level,p_active,p_id);
END $$;
CREATE FUNCTION public.save_service_consumption(p_service_id uuid, p_product_id uuid, p_qty_per_wash numeric,
  p_active boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('stock');
  RETURN public.wg_save_service_consumption_unchecked(p_service_id,p_product_id,p_qty_per_wash,p_active);
END $$;
CREATE FUNCTION public.link_expense_to_purchase_order(p_expense_id uuid, p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('stock');
  PERFORM public.wg_link_expense_to_purchase_order_unchecked(p_expense_id,p_order_id);
END $$;
CREATE FUNCTION public.certify_profitability_period(p_start date, p_end date, p_attestation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('stock');
  RETURN public.wg_certify_profitability_period_unchecked(p_start,p_end,p_attestation);
END $$;
CREATE FUNCTION public.accrue_loyalty_for_wash(p_wash_id uuid, p_idempotency_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('loyalty');
  RETURN public.wg_accrue_loyalty_for_wash_unchecked(p_wash_id,p_idempotency_key);
END $$;
CREATE FUNCTION public.consume_package_for_wash(p_wash_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('loyalty');
  RETURN public.wg_consume_package_for_wash_unchecked(p_wash_id);
END $$;
CREATE FUNCTION public.apply_promotion_to_wash(p_wash_id uuid, p_code text, p_idempotency_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_subscription_module('loyalty');
  RETURN public.wg_apply_promotion_to_wash_unchecked(p_wash_id,p_code,p_idempotency_key);
END $$;
REVOKE ALL ON FUNCTION public.save_product_category(uuid,text,boolean),
  public.save_product(uuid,text,text,text,text,integer,boolean,uuid), public.save_service_consumption(uuid,uuid,numeric,boolean),
  public.link_expense_to_purchase_order(uuid,uuid), public.certify_profitability_period(date,date,text),
  public.accrue_loyalty_for_wash(uuid,text), public.consume_package_for_wash(uuid),
  public.apply_promotion_to_wash(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_category(uuid,text,boolean),
  public.save_product(uuid,text,text,text,text,integer,boolean,uuid), public.save_service_consumption(uuid,uuid,numeric,boolean),
  public.link_expense_to_purchase_order(uuid,uuid), public.certify_profitability_period(date,date,text),
  public.accrue_loyalty_for_wash(uuid,text), public.consume_package_for_wash(uuid),
  public.apply_promotion_to_wash(uuid,text,text) TO authenticated;

-- Le bucket privé reste lisible ; aucun nouvel objet/modification/suppression
-- n'est autorisé à une session en lecture seule.
CREATE POLICY wg_subscription_object_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'station-assets' OR public.my_subscription_can_write());
CREATE POLICY wg_subscription_object_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'station-assets' OR public.my_subscription_can_write())
  WITH CHECK (bucket_id <> 'station-assets' OR public.my_subscription_can_write());
CREATE POLICY wg_subscription_object_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'station-assets' OR public.my_subscription_can_write());

-- Une place est réservée AVANT l'appel externe à Auth. Elle reste comptée si
-- l'appel ou sa réponse est incertain : on ne libère jamais automatiquement
-- une place alors qu'un compte ou un e-mail peut déjà avoir été créé.
CREATE TABLE public.invitation_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  role_id uuid NOT NULL REFERENCES public.roles(id),
  station_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','cleanup','finalized','cancelled')),
  auth_user_id uuid,
  invitation_id uuid REFERENCES public.user_invitations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_invitation_reservations_email_open
  ON public.invitation_reservations (lower(email)) WHERE status IN ('reserved','cleanup');
CREATE INDEX ix_invitation_reservations_company_open
  ON public.invitation_reservations (company_id) WHERE status IN ('reserved','cleanup');
-- Une invitation finale ne peut désigner qu'une seule réservation et donc un
-- seul profil Auth lors d'une révocation.
CREATE UNIQUE INDEX uq_invitation_reservations_invitation
  ON public.invitation_reservations (invitation_id) WHERE invitation_id IS NOT NULL;
ALTER TABLE public.invitation_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitation_reservations FROM PUBLIC, anon, authenticated;

-- Les limites restent consultables quand l'abonnement est suspendu ou expiré.
CREATE OR REPLACE FUNCTION public.current_plan_limit(p_company uuid, p_limit_key text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pl.value_int FROM public.plan_limits pl WHERE pl.key=p_limit_key AND pl.plan_id=(
    SELECT s.plan_id FROM public.subscriptions s WHERE s.company_id=p_company
    ORDER BY (s.status IN ('trial','active','past_due')) DESC, s.started_at DESC, s.id DESC LIMIT 1)
$$;
REVOKE ALL ON FUNCTION public.current_plan_limit(uuid,text) FROM PUBLIC, anon, authenticated;
-- Le mois du quota est calendaire UTC, quel que soit le fuseau de la session.
-- Un instant unique est utilisé pour les deux bornes, même à minuit.
CREATE OR REPLACE FUNCTION public.subscription_usage_snapshot(p_company uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH month AS MATERIALIZED (
    SELECT date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AS start_utc
  )
  SELECT jsonb_build_object(
    'stations',(SELECT count(*) FROM public.stations WHERE company_id=p_company AND deleted_at IS NULL),
    'employees',(SELECT count(*) FROM public.user_profiles WHERE company_id=p_company AND active AND deleted_at IS NULL)
      + (SELECT count(*) FROM public.invitation_reservations WHERE company_id=p_company AND status IN ('reserved','cleanup')),
    'washes',(SELECT count(*) FROM public.washes, month WHERE company_id=p_company AND deleted_at IS NULL AND status<>'cancelled'
      AND created_at >= (month.start_utc AT TIME ZONE 'UTC')
      AND created_at < ((month.start_utc + interval '1 month') AT TIME ZONE 'UTC')))
$$;
REVOKE ALL ON FUNCTION public.subscription_usage_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- La vue historique reste security_invoker. Ce compteur ne dévoile aucune
-- réservation ni adresse : il ne renvoie qu'un nombre, limité au tenant de
-- l'appelant (ou au super administrateur), sans grant sur la table privée.
CREATE FUNCTION public.my_quota_account_count(p_company uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND (public.is_platform_admin() OR p_company=public.current_company_id())
    THEN (SELECT count(*) FROM public.user_profiles WHERE company_id=p_company AND active AND deleted_at IS NULL)
       + (SELECT count(*) FROM public.invitation_reservations WHERE company_id=p_company AND status IN ('reserved','cleanup'))
    ELSE NULL::bigint END
$$;
REVOKE ALL ON FUNCTION public.my_quota_account_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_quota_account_count(uuid) TO authenticated;
CREATE OR REPLACE VIEW public.v_company_quota_usage WITH (security_invoker = true) AS
SELECT c.id AS company_id, s.plan_id,
  (SELECT count(*) FROM public.stations st WHERE st.company_id=c.id AND st.deleted_at IS NULL) AS stations_used,
  public.my_quota_account_count(c.id) AS employees_used,
  (SELECT count(*) FROM public.washes w WHERE w.company_id=c.id AND w.deleted_at IS NULL AND w.status<>'cancelled'
    AND w.created_at >= (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    AND w.created_at < ((date_trunc('month',now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC')) AS washes_month_used
FROM public.companies c JOIN public.subscriptions s ON s.company_id=c.id AND s.status IN ('trial','active','past_due');

-- Les lignes de relevé sauvegardées sont des instantanés au moment du recalcul
-- pour stations/comptes, et des lavages de la période indiquée. Les comptes
-- incluent les réservations non résolues, comme le contrôle effectif du quota.
CREATE OR REPLACE FUNCTION public.refresh_subscription_usage(
  p_period_start date DEFAULT (date_trunc('month',now() AT TIME ZONE 'UTC'))::date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_admin boolean := public.is_platform_admin(); v_rows integer;
BEGIN
  IF NOT (v_admin OR public.has_permission('subscription.manage') OR public.has_permission('platform.quotas.manage')) THEN
    RAISE EXCEPTION 'Permission subscription.manage ou platform.quotas.manage requise' USING ERRCODE='42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.subscription_usage(company_id,station_id,period_start,metric_key,value_int,updated_at)
  SELECT c.id, st.id, p_period_start, m.metric_key, m.value_int::integer, now()
  FROM public.companies c JOIN public.stations st ON st.company_id=c.id AND st.deleted_at IS NULL
  CROSS JOIN LATERAL (VALUES
    ('stations'::text, (SELECT count(*) FROM public.stations s2 WHERE s2.company_id=c.id AND s2.deleted_at IS NULL)),
    ('employees'::text, (SELECT count(*) FROM public.user_profiles u WHERE u.company_id=c.id AND u.active AND u.deleted_at IS NULL)
      + (SELECT count(*) FROM public.invitation_reservations r WHERE r.company_id=c.id AND r.status IN ('reserved','cleanup'))),
    ('washes'::text, (SELECT count(*) FROM public.washes w WHERE w.company_id=c.id AND w.station_id=st.id
      AND w.deleted_at IS NULL AND w.status<>'cancelled'
      AND w.created_at >= (p_period_start::timestamp AT TIME ZONE 'UTC')
      AND w.created_at < (((p_period_start + interval '1 month')::timestamp) AT TIME ZONE 'UTC')))
  ) AS m(metric_key,value_int)
  WHERE v_admin OR c.id=v_company
  ON CONFLICT (company_id,station_id,period_start,metric_key)
  DO UPDATE SET value_int=EXCLUDED.value_int,updated_at=now();
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  RETURN jsonb_build_object('periodStart',p_period_start::text,'rows',v_rows,
    'rule','Comptes et stations courants ; lavages de la periode UTC');
END $$;
REVOKE ALL ON FUNCTION public.refresh_subscription_usage(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_subscription_usage(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_subscription_usage(
  p_period_start date DEFAULT (date_trunc('month',now() AT TIME ZONE 'UTC'))::date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_admin boolean := public.is_platform_admin();
  v_usage jsonb := '{}'::jsonb; v_limits jsonb := '{}'::jsonb; v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (v_admin OR public.has_permission('analytics.view') OR public.has_permission('subscription.manage')) THEN
    RAISE EXCEPTION 'Permission analytics.view ou subscription.manage requise' USING ERRCODE='42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE='42501';
  END IF;
  IF NOT v_admin THEN
    v_usage := public.subscription_usage_snapshot(v_company);
    v_limits := jsonb_build_object('stations',public.current_plan_limit(v_company,'stations'),
      'employees',public.current_plan_limit(v_company,'employees'),
      'washesPerMonth',public.current_plan_limit(v_company,'washes_per_month'));
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('companyId',u.company_id,'stationId',u.station_id,
    'periodStart',u.period_start::text,'metricKey',u.metric_key,'valueInt',u.value_int,'updatedAt',u.updated_at::text)
    ORDER BY u.period_start DESC,u.metric_key),'[]'::jsonb) INTO v_rows
  FROM public.subscription_usage u WHERE u.period_start=p_period_start
    AND (v_admin OR u.company_id=v_company) AND (v_admin OR public.can_access_station(u.station_id));
  RETURN jsonb_build_object('periodStart',p_period_start::text,'usage',v_usage,'limits',v_limits,'rows',v_rows,
    'rules',jsonb_build_object('quota','Limites serveur ; comptes actifs et reservations non resolues ; mois UTC'));
END $$;
REVOKE ALL ON FUNCTION public.my_subscription_usage(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_subscription_usage(date) TO authenticated;

-- Les quotas sont sérialisés par entreprise (y compris deux stations concurrentes).
-- Une limite manquante ne signifie pas « illimité ».
CREATE OR REPLACE FUNCTION public.assert_subscription_limit(p_company uuid, p_limit_key text, p_increment integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_limit integer; v_used bigint; v_month_start timestamp; v_month_end timestamp;
BEGIN
  IF p_company IS NULL OR p_increment IS NULL OR p_increment < 1 OR p_limit_key IS NULL
    OR p_limit_key NOT IN ('stations','employees','washes_per_month') THEN
    RAISE EXCEPTION 'Parametres de quota invalides' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('washguard-quota:' || p_company::text, 0));
  v_month_start := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC');
  v_month_end := v_month_start + interval '1 month';
  SELECT public.current_plan_limit(p_company, p_limit_key) INTO v_limit;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'Limite de formule indisponible' USING ERRCODE='23514'; END IF;
  IF p_limit_key='stations' THEN
    SELECT count(*) INTO v_used FROM public.stations WHERE company_id=p_company AND deleted_at IS NULL;
  ELSIF p_limit_key='employees' THEN
    SELECT (SELECT count(*) FROM public.user_profiles WHERE company_id=p_company AND active AND deleted_at IS NULL)
      + (SELECT count(*) FROM public.invitation_reservations WHERE company_id=p_company AND status IN ('reserved','cleanup'))
      INTO v_used;
  ELSE
    SELECT count(*) INTO v_used FROM public.washes WHERE company_id=p_company AND deleted_at IS NULL AND status<>'cancelled'
      AND created_at >= (v_month_start AT TIME ZONE 'UTC') AND created_at < (v_month_end AT TIME ZONE 'UTC');
  END IF;
  IF v_used + p_increment > v_limit THEN
    RAISE EXCEPTION 'Quota % atteint : % deja utilises sur %', p_limit_key, v_used, v_limit USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('allowed',true,'unlimited',false,'limit',v_limit,'used',v_used,'remaining',v_limit-v_used-p_increment);
END $$;
REVOKE ALL ON FUNCTION public.assert_subscription_limit(uuid,text,integer) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.enforce_subscription_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid; v_key text;
  v_month_start timestamp := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC');
  v_month_end timestamp := v_month_start + interval '1 month';
BEGIN
  v_company := NEW.company_id;
  IF v_company IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='stations' THEN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.deleted_at IS NULL AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
    v_key := 'stations';
  ELSIF TG_TABLE_NAME='user_profiles' THEN
    IF NOT NEW.active OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.active AND OLD.deleted_at IS NULL AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
    v_key := 'employees';
  ELSIF TG_TABLE_NAME='washes' THEN
    IF NEW.deleted_at IS NOT NULL OR NEW.status='cancelled'
      OR NEW.created_at < (v_month_start AT TIME ZONE 'UTC') OR NEW.created_at >= (v_month_end AT TIME ZONE 'UTC') THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.deleted_at IS NULL AND OLD.status<>'cancelled'
      AND OLD.created_at >= (v_month_start AT TIME ZONE 'UTC') AND OLD.created_at < (v_month_end AT TIME ZONE 'UTC')
      AND OLD.company_id=NEW.company_id THEN RETURN NEW; END IF;
    v_key := 'washes_per_month';
  ELSE RETURN NEW; END IF;
  PERFORM public.assert_subscription_limit(v_company, v_key, 1);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_subscription_limit() FROM PUBLIC, anon, authenticated;

-- Empêcher le contournement du quota mensuel par antidatation d'une nouvelle
-- fiche ou déplacement ultérieur de sa date. Les historiques existants ne sont
-- pas modifiés ; seule une opération explicite de la plateforme peut les corriger.
CREATE OR REPLACE FUNCTION public.enforce_wash_creation_time() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.is_platform_admin() THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
    NEW.created_at := clock_timestamp();
  ELSIF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Date de creation du lavage immuable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ab_wash_creation_time BEFORE INSERT OR UPDATE OF created_at ON public.washes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_wash_creation_time();
REVOKE ALL ON FUNCTION public.enforce_wash_creation_time() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_quota_profiles_reactivation BEFORE UPDATE OF active, deleted_at, company_id ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();
CREATE TRIGGER trg_quota_stations_reactivation BEFORE UPDATE OF deleted_at, company_id ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();
CREATE TRIGGER trg_quota_washes_reactivation BEFORE UPDATE OF status, deleted_at, created_at, company_id ON public.washes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();

-- Point d'entrée utilisateur : validation et réservation atomiques AVANT Auth.
-- Les paramètres ne comprennent jamais d'identifiant de tenant choisi par le client.
CREATE OR REPLACE FUNCTION public.reserve_user_invitation(
  p_email text, p_full_name text, p_phone text, p_role_key text, p_station_ids uuid[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id(); v_actor uuid := auth.uid();
  v_email text := lower(btrim(COALESCE(p_email,'')));
  v_name text := btrim(COALESCE(p_full_name,'')); v_phone text := btrim(COALESCE(p_phone,''));
  v_role uuid; v_id uuid; v_station uuid;
BEGIN
  IF v_actor IS NULL OR v_company IS NULL OR NOT public.has_permission('employees.invite') THEN
    RAISE EXCEPTION 'Permission employees.invite requise' USING ERRCODE='42501';
  END IF;
  IF v_email = '' OR NOT public.wg_valid_email(v_email) OR length(v_name) NOT BETWEEN 2 AND 120
    OR NOT public.wg_valid_phone(v_phone) OR p_role_key NOT IN ('manager','cashier','washer') THEN
    RAISE EXCEPTION 'Invitation invalide : verifiez email, nom, telephone et role' USING ERRCODE='23514';
  END IF;
  IF p_station_ids IS NULL OR cardinality(p_station_ids) NOT BETWEEN 1 AND 50
    OR array_ndims(p_station_ids) <> 1 OR array_position(p_station_ids,NULL) IS NOT NULL
    OR (SELECT count(DISTINCT x) FROM unnest(p_station_ids) AS x) <> cardinality(p_station_ids) THEN
    RAISE EXCEPTION 'Affectation de station invalide' USING ERRCODE='23514';
  END IF;
  FOREACH v_station IN ARRAY p_station_ids LOOP
    PERFORM public.assert_my_station(v_station);
  END LOOP;
  SELECT id INTO v_role FROM public.roles WHERE company_id IS NULL AND key=p_role_key;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Role introuvable' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.subscriptions WHERE company_id=v_company
    ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC LIMIT 1 FOR SHARE;
  IF NOT public.subscription_writable(v_company) THEN
    RAISE EXCEPTION 'Abonnement en lecture seule : invitation bloquee' USING ERRCODE='42501';
  END IF;
  -- Ce verrou est aussi pris par les triggers de création/réactivation de profil.
  PERFORM public.assert_subscription_limit(v_company,'employees',1);
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE lower(email)=v_email)
    OR EXISTS (SELECT 1 FROM public.user_invitations WHERE lower(email)=v_email
      AND accepted_at IS NULL AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Adresse indisponible ou invitation deja en attente' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.invitation_reservations(company_id,requested_by,email,full_name,phone,role_id,station_ids)
    VALUES(v_company,v_actor,v_email,v_name,v_phone,v_role,p_station_ids) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.reserve_user_invitation(text,text,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_user_invitation(text,text,text,text,uuid[]) TO authenticated;

-- Réservée à l'Edge Function avec la clé service. Les trois écritures sont
-- réalisées dans UNE transaction et la place réservée devient un profil actif.
CREATE OR REPLACE FUNCTION public.finalize_user_invitation(p_reservation uuid, p_user uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.invitation_reservations%ROWTYPE; v_company uuid; v_invitation uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.invitation_reservations WHERE id=p_reservation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation introuvable' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.subscriptions WHERE company_id=v_company
    ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC LIMIT 1 FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('washguard-quota:' || v_company::text, 0));
  SELECT * INTO r FROM public.invitation_reservations WHERE id=p_reservation FOR UPDATE;
  IF r.status='finalized' AND r.auth_user_id=p_user AND r.invitation_id IS NOT NULL THEN
    RETURN jsonb_build_object('userId',r.auth_user_id,'invitationId',r.invitation_id);
  END IF;
  IF r.status <> 'reserved' OR p_user IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Reservation indisponible ou donnees invalides' USING ERRCODE='23514';
  END IF;
  IF NOT public.subscription_writable(v_company) THEN
    RAISE EXCEPTION 'Abonnement en lecture seule : invitation non finalisee' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles u JOIN public.role_permissions rp ON rp.role_id=u.role_id
      WHERE u.id=r.requested_by AND u.company_id=v_company AND u.active AND u.deleted_at IS NULL
        AND rp.permission_id='employees.invite') THEN
    RAISE EXCEPTION 'Permission de l’invitant retiree' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(r.station_ids) s WHERE NOT EXISTS (
      SELECT 1 FROM public.stations st WHERE st.id=s AND st.company_id=v_company AND st.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM public.user_profiles u JOIN public.roles ro ON ro.id=u.role_id
          WHERE u.id=r.requested_by AND ro.key IN ('owner','manager'))
          OR EXISTS (SELECT 1 FROM public.user_station_assignments a WHERE a.user_id=r.requested_by AND a.station_id=st.id)))) THEN
    RAISE EXCEPTION 'Station ou affectation de l’invitant indisponible' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p_user AND lower(u.email)=r.email
      AND u.raw_user_meta_data->>'invitation'='true'
      AND u.raw_user_meta_data->>'invitation_reservation_id'=p_reservation::text) THEN
    RAISE EXCEPTION 'Compte Auth non associe a cette reservation' USING ERRCODE='23514';
  END IF;
  UPDATE public.invitation_reservations SET status='finalized',auth_user_id=p_user,updated_at=now() WHERE id=r.id;
  INSERT INTO public.user_profiles(id,company_id,full_name,email,phone,role_id,active)
    VALUES(p_user,v_company,r.full_name,r.email,r.phone,r.role_id,true);
  INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
    SELECT v_company,p_user,s FROM unnest(r.station_ids) AS s;
  INSERT INTO public.user_invitations(company_id,email,role_id,station_ids,token_hash,invited_by,expires_at)
    VALUES(v_company,r.email,r.role_id,to_jsonb(r.station_ids),p_token_hash,r.requested_by,now()+interval '7 days')
    RETURNING id INTO v_invitation;
  UPDATE public.invitation_reservations SET invitation_id=v_invitation,updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('userId',p_user,'invitationId',v_invitation);
END $$;
REVOKE ALL ON FUNCTION public.finalize_user_invitation(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_user_invitation(uuid,uuid,text) TO service_role;

-- Marquer une invitation révoquée sans désactiver le profil ne coupe pas son
-- accès : le lien et le compte existent déjà dans Auth. Les deux écritures SQL
-- sont donc atomiques, liées par la réservation de 057 et sérialisées avec
-- accept_my_invitations() par le verrou de la ligne d'invitation. Cette RPC ne
-- supprime ni le compte Auth ni les sessions/tokens externes déjà émis.
CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_invitation public.user_invitations%ROWTYPE;
  v_reservation public.invitation_reservations%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT public.has_permission('employees.invite')
    OR NOT public.has_permission('employees.disable') THEN
    RAISE EXCEPTION 'Permissions employees.invite et employees.disable requises' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_invitation FROM public.user_invitations
    WHERE id=p_invitation_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND OR v_invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation introuvable ou deja acceptee' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_reservation FROM public.invitation_reservations
    WHERE invitation_id=v_invitation.id AND company_id=v_company AND status='finalized';
  IF NOT FOUND OR v_reservation.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Invitation historique sans compte lie : contactez le support pour rapprocher et desactiver le compte'
      USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_profile FROM public.user_profiles
    WHERE id=v_reservation.auth_user_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil lie introuvable ou hors entreprise : rapprochement requis' USING ERRCODE='55000';
  END IF;
  IF v_profile.id=auth.uid()
    OR EXISTS (SELECT 1 FROM public.roles WHERE id=v_profile.role_id AND key='owner')
    OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id=v_profile.id) THEN
    RAISE EXCEPTION 'Ce compte protege ne peut pas etre desactive par cette operation' USING ERRCODE='42501';
  END IF;
  -- Après réponse perdue, un rejeu est sûr tant que le compte est toujours
  -- désactivé. Ne pas désactiver une deuxième fois un compte réactivé depuis.
  IF v_invitation.revoked_at IS NOT NULL THEN
    IF NOT v_profile.active OR v_profile.deleted_at IS NOT NULL THEN RETURN; END IF;
    RAISE EXCEPTION 'Invitation deja revoquee mais compte reactive : relisez son etat' USING ERRCODE='55000';
  END IF;
  UPDATE public.user_invitations SET revoked_at=clock_timestamp() WHERE id=v_invitation.id;
  UPDATE public.user_profiles SET active=false WHERE id=v_profile.id AND company_id=v_company;
END $$;
REVOKE ALL ON FUNCTION public.revoke_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated;

-- Après une réponse perdue, verrouiller la réservation pour distinguer une
-- finalisation réellement commitée d'un compte Auth orphelin. Aucune suppression
-- Auth automatique : son propriétaire ne peut pas être établi avec certitude.
CREATE OR REPLACE FUNCTION public.inspect_user_invitation(p_reservation uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.invitation_reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.invitation_reservations WHERE id=p_reservation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation introuvable' USING ERRCODE='P0002'; END IF;
  IF r.status='finalized' AND r.auth_user_id=p_user AND r.invitation_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','finalized','userId',r.auth_user_id,'invitationId',r.invitation_id);
  END IF;
  IF r.status='reserved' THEN
    UPDATE public.invitation_reservations SET status='cleanup',auth_user_id=p_user,updated_at=now() WHERE id=r.id;
    RETURN jsonb_build_object('status','cleanup');
  END IF;
  IF r.status='cleanup' AND r.auth_user_id IS NOT DISTINCT FROM p_user THEN RETURN jsonb_build_object('status','cleanup'); END IF;
  RAISE EXCEPTION 'Reservation incoherente : intervention requise' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION public.inspect_user_invitation(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_user_invitation(uuid,uuid) TO service_role;

-- Procédure de rapprochement explicite : après vérification externe, seule une
-- réservation sans compte Auth ni profil peut être libérée. Jamais depuis l'UI.
CREATE OR REPLACE FUNCTION public.release_user_invitation(p_reservation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.invitation_reservations%ROWTYPE; v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.invitation_reservations WHERE id=p_reservation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation introuvable' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('washguard-quota:' || v_company::text, 0));
  SELECT * INTO r FROM public.invitation_reservations WHERE id=p_reservation FOR UPDATE;
  IF r.status NOT IN ('reserved','cleanup') OR EXISTS (SELECT 1 FROM auth.users WHERE lower(email)=r.email)
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE lower(email)=r.email) THEN
    RAISE EXCEPTION 'Rapprochement Auth requis avant liberation' USING ERRCODE='23514';
  END IF;
  UPDATE public.invitation_reservations SET status='cancelled',updated_at=now() WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION public.release_user_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_user_invitation(uuid) TO service_role;

-- Une demande est sérialisée par abonnement ; elle ne modifie jamais plan_id.
CREATE OR REPLACE FUNCTION public.request_subscription_plan(p_plan text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_sub public.subscriptions%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT public.has_permission('subscription.manage') THEN
    RAISE EXCEPTION 'Permission subscription.manage requise' USING ERRCODE='42501';
  END IF;
  IF p_plan IS NULL OR p_plan NOT IN ('standard','premium') OR NOT EXISTS(SELECT 1 FROM public.plans WHERE id=p_plan AND active) THEN
    RAISE EXCEPTION 'Formule demandee indisponible' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE company_id=v_company
    ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Abonnement introuvable' USING ERRCODE='P0002'; END IF;
  IF v_sub.plan_id=p_plan AND v_sub.status='active' AND public.subscription_writable(v_company) THEN
    RAISE EXCEPTION 'Cette formule est deja active' USING ERRCODE='23514';
  END IF;
  SELECT id INTO v_id FROM public.subscription_changes WHERE subscription_id=v_sub.id AND status='pending' AND to_plan_id=p_plan
    ORDER BY requested_at DESC, id DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  UPDATE public.subscription_changes SET status='rejected' WHERE subscription_id=v_sub.id AND status='pending';
  INSERT INTO public.subscription_changes(company_id,subscription_id,from_plan_id,to_plan_id,requested_by)
    VALUES(v_company,v_sub.id,v_sub.plan_id,p_plan,auth.uid()) RETURNING id INTO v_id;
  UPDATE public.subscriptions SET pending_plan_id=p_plan,updated_at=now() WHERE id=v_sub.id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.request_subscription_plan(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_subscription_plan(text) TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.subscription_changes FROM PUBLIC, anon, authenticated;
-- L'ancien sélecteur direct pouvait changer une formule sans traiter de demande.
-- Le back-office passe désormais par admin_decide_subscription_request ci-dessous.
REVOKE ALL ON FUNCTION public.admin_set_company_subscription(uuid,text,text) FROM PUBLIC, anon, authenticated;

-- L'inscription conserve seulement une intention en attente ; les métadonnées
-- utilisateur ne peuvent jamais activer une formule payante.
CREATE OR REPLACE FUNCTION public.capture_signup_plan_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan text := btrim(COALESCE(NEW.raw_user_meta_data->>'requested_plan_id',''));
  v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF v_plan NOT IN ('standard','premium') OR NOT EXISTS(SELECT 1 FROM public.plans WHERE id=v_plan AND active) THEN RETURN NEW; END IF;
  SELECT s.* INTO v_sub FROM public.user_profiles u JOIN public.subscriptions s ON s.company_id=u.company_id
    WHERE u.id=NEW.id AND s.status='trial' ORDER BY s.started_at DESC LIMIT 1 FOR UPDATE OF s;
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO public.subscription_changes(company_id,subscription_id,from_plan_id,to_plan_id,requested_by)
    VALUES(v_sub.company_id,v_sub.id,v_sub.plan_id,v_plan,NEW.id);
  UPDATE public.subscriptions SET pending_plan_id=v_plan,updated_at=now() WHERE id=v_sub.id;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auth_users_plan_request AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.capture_signup_plan_request();
REVOKE ALL ON FUNCTION public.capture_signup_plan_request() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_subscription_requests() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() OR NOT public.has_permission('platform.companies.manage') THEN
    RAISE EXCEPTION 'Permission platform.companies.manage requise' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',ch.id,'companyId',ch.company_id,'companyName',c.name,'fromPlanId',ch.from_plan_id,
    'toPlanId',ch.to_plan_id,'toPlanName',p.name,'requestedAt',ch.requested_at
  ) ORDER BY ch.requested_at) FROM public.subscription_changes ch
    JOIN public.companies c ON c.id=ch.company_id JOIN public.plans p ON p.id=ch.to_plan_id
    WHERE ch.status='pending'), '[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.admin_decide_subscription_request(p_request uuid, p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_change public.subscription_changes%ROWTYPE; v_sub public.subscriptions%ROWTYPE; v_today date;
BEGIN
  IF NOT public.is_platform_admin() OR NOT public.has_permission('platform.companies.manage') THEN
    RAISE EXCEPTION 'Permission platform.companies.manage requise' USING ERRCODE='42501';
  END IF;
  IF p_request IS NULL OR p_approve IS NULL THEN RAISE EXCEPTION 'Decision invalide' USING ERRCODE='23514'; END IF;
  -- Toujours verrouiller l'abonnement avant la demande, comme la création.
  SELECT s.* INTO v_sub FROM public.subscriptions s JOIN public.subscription_changes c ON c.subscription_id=s.id
    WHERE c.id=p_request FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_change FROM public.subscription_changes WHERE id=p_request FOR UPDATE;
  IF v_change.status <> 'pending' THEN RAISE EXCEPTION 'Demande deja traitee' USING ERRCODE='23514'; END IF;
  IF v_sub.pending_plan_id IS DISTINCT FROM v_change.to_plan_id THEN
    RAISE EXCEPTION 'Demande remplacee, relecture necessaire' USING ERRCODE='23514';
  END IF;
  IF p_approve AND NOT EXISTS(SELECT 1 FROM public.plans WHERE id=v_change.to_plan_id AND active) THEN
    RAISE EXCEPTION 'Formule indisponible' USING ERRCODE='23514';
  END IF;
  UPDATE public.subscription_changes SET status=CASE WHEN p_approve THEN 'applied' ELSE 'rejected' END,
    effective_at=CASE WHEN p_approve THEN now() ELSE NULL END WHERE id=p_request;
  -- Une validation ouvre une période mensuelle, sans présumer d'un paiement.
  -- La date de fin est exclusive, à 00:00 UTC. Aucun renouvellement automatique.
  v_today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  UPDATE public.subscriptions SET plan_id=CASE WHEN p_approve THEN v_change.to_plan_id ELSE plan_id END,
    status=CASE WHEN p_approve THEN 'active' ELSE status END,
    current_period_start=CASE WHEN p_approve THEN v_today ELSE current_period_start END,
    current_period_end=CASE WHEN p_approve THEN (v_today + interval '1 month')::date ELSE current_period_end END,
    pending_plan_id=NULL, updated_at=now()
    WHERE id=v_sub.id;
  INSERT INTO public.platform_audit_logs(actor_user_id,action,entity_type,entity_id,detail)
    VALUES(auth.uid(),CASE WHEN p_approve THEN 'subscription.request.approved' ELSE 'subscription.request.rejected' END,
      'subscription_changes',p_request::text,jsonb_build_object('companyId',v_sub.company_id,'planId',v_change.to_plan_id));
END $$;
REVOKE ALL ON FUNCTION public.admin_subscription_requests(), public.admin_decide_subscription_request(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_subscription_requests(), public.admin_decide_subscription_request(uuid,boolean) TO authenticated;

-- Le tableau plateforme historique ne comptait pas les réservations et
-- affichait un abonnement actif même après son échéance. Conserver ses autres
-- projections mais recalculer les compteurs avec les mêmes règles que la garde.
-- L'ancienne fonction ne doit pas rester un point d'entrée client alternatif.
ALTER FUNCTION public.my_platform_board() RENAME TO wg_platform_board_before_subscriptions;
REVOKE ALL ON FUNCTION public.wg_platform_board_before_subscriptions() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.my_platform_board() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_board jsonb; v_row jsonb; v_companies jsonb := '[]'::jsonb; v_used jsonb;
  v_company uuid; v_sub public.subscriptions%ROWTYPE; v_plan_name text; v_reason text;
  v_stations_limit integer; v_employees_limit integer; v_washes_limit integer;
  v_stations bigint; v_employees bigint; v_washes bigint; v_exceeded boolean;
  v_exceeded_count integer := 0; v_revenue numeric;
  v_month_start timestamp := date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC');
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acces reserve au super admin WashGuard' USING ERRCODE='42501';
  END IF;
  v_board := public.wg_platform_board_before_subscriptions();
  -- Une ancienne entreprise peut avoir plusieurs abonnements historiques
  -- suspendus : ne présenter qu'une ligne avec la même sélection que la garde.
  FOR v_row IN SELECT DISTINCT ON (entry->>'companyId') entry
    FROM jsonb_array_elements(v_board->'companies') AS x(entry)
    ORDER BY entry->>'companyId', entry->>'subscriptionStartedAt' DESC NULLS LAST
  LOOP
    v_company := (v_row->>'companyId')::uuid;
    SELECT * INTO v_sub FROM public.subscriptions WHERE company_id=v_company
      ORDER BY (status IN ('trial','active','past_due')) DESC, started_at DESC, id DESC LIMIT 1;
    IF FOUND THEN
      SELECT name INTO v_plan_name FROM public.plans WHERE id=v_sub.plan_id;
      v_reason := CASE WHEN (v_row->>'suspended')::boolean THEN 'company_suspended'
        ELSE public.subscription_period_reason(v_sub.plan_id,v_sub.status,v_sub.trial_ends_at,v_sub.current_period_end,clock_timestamp()) END;
    ELSE
      v_sub := NULL; v_plan_name := NULL; v_reason := 'missing_subscription';
    END IF;
    v_used := public.subscription_usage_snapshot(v_company);
    v_stations := (v_used->>'stations')::bigint;
    v_employees := (v_used->>'employees')::bigint;
    v_washes := (v_used->>'washes')::bigint;
    v_stations_limit := public.current_plan_limit(v_company,'stations');
    v_employees_limit := public.current_plan_limit(v_company,'employees');
    v_washes_limit := public.current_plan_limit(v_company,'washes_per_month');
    v_exceeded := (v_stations_limit IS NOT NULL AND v_stations>v_stations_limit)
      OR (v_employees_limit IS NOT NULL AND v_employees>v_employees_limit)
      OR (v_washes_limit IS NOT NULL AND v_washes>v_washes_limit);
    IF v_exceeded THEN v_exceeded_count := v_exceeded_count+1; END IF;
    SELECT COALESCE(sum(total_minor),0) INTO v_revenue FROM public.washes
      WHERE company_id=v_company AND deleted_at IS NULL AND status<>'cancelled'
        AND created_at >= (v_month_start AT TIME ZONE 'UTC')
        AND created_at < ((v_month_start + interval '1 month') AT TIME ZONE 'UTC');
    v_companies := v_companies || jsonb_build_array(v_row || jsonb_build_object(
      'status',CASE WHEN (v_row->>'suspended')::boolean THEN 'suspendue'
        WHEN v_reason IS NOT NULL THEN 'lecture seule' WHEN v_sub.status='trial' THEN 'essai' ELSE 'active' END,
      'planId',v_sub.plan_id,'planName',v_plan_name,'subscriptionStatus',v_sub.status,
      'subscriptionStartedAt',v_sub.started_at,'subscriptionReason',v_reason,
      'stationCount',v_stations,'employeeCount',v_employees,'washesMonth',v_washes,'monthlyRevenue',v_revenue,
      'limits',jsonb_build_object('stations',v_stations_limit,'employees',v_employees_limit,'washesPerMonth',v_washes_limit),
      'quota',jsonb_build_object('stationsUsed',v_stations,'employeesUsed',v_employees,
        'washesMonthUsed',v_washes,'quotaExceeded',v_exceeded)
    ));
  END LOOP;
  v_board := jsonb_set(v_board,'{companies}',v_companies);
  v_board := jsonb_set(v_board,'{stats,companies}',to_jsonb(jsonb_array_length(v_companies)));
  v_board := jsonb_set(v_board,'{stats,quotasExceeded}',to_jsonb(v_exceeded_count));
  RETURN jsonb_set(v_board,'{rules,quotas}',to_jsonb('Quotas serveur : comptes actifs et reservations non resolues, mois UTC'::text));
END $$;
REVOKE ALL ON FUNCTION public.my_platform_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_platform_board() TO authenticated;
