-- 011 — Bootstrap Auth, invitations et permissions complémentaires (Prompt 04)
-- Aucun mot de passe n'est stocké dans public.* ; Supabase Auth reste la
-- seule autorité. Le tenant est créé à partir des métadonnées d'inscription,
-- jamais à partir d'un company_id fourni par le navigateur.

-- Inscription e-mail : crée UNE SEULE fois entreprise + station + propriétaire
-- + affectation + essai + journal, même sans session active (confirmation
-- d'e-mail requise). Le trigger auth.users porte ces données côté serveur.
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
  INSERT INTO public.stations (company_id, name, city, phone, activated, hours)
    VALUES (v_company, v_station_name, v_city, v_phone, false, '[]'::jsonb) RETURNING id INTO v_station;
  INSERT INTO public.user_profiles (id, company_id, full_name, email, phone, role_id, active)
    VALUES (p_user_id, v_company, v_owner_name, COALESCE(p_email, ''), v_phone, v_role, true);
  INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
    VALUES (v_company, p_user_id, v_station);
  INSERT INTO public.subscriptions (company_id, plan_id, status, trial_ends_at)
    VALUES (v_company, 'essai', 'trial', now() + interval '14 days');
  INSERT INTO public.audit_logs (company_id, station_id, actor_user_id, action, entity_type, entity_id)
    VALUES (v_company, v_station, p_user_id, 'company.created', 'companies', v_company::text);
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.bootstrap_company_from_auth_user(NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data, '{}'::jsonb));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auth_users_bootstrap ON auth.users;
CREATE TRIGGER trg_auth_users_bootstrap
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Invitations : suivi de l'acceptation et révocation, unicité des invitations
-- en attente par entreprise et adresse e-mail.
ALTER TABLE public.user_invitations
  ADD COLUMN IF NOT EXISTS accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending_email
  ON public.user_invitations (company_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Permissions supplémentaires nécessaires aux écrans d'administration.
INSERT INTO public.permissions (key, label_fr, domain) VALUES
  ('employees.invite', 'Inviter un employé', 'employees'),
  ('employees.assign_stations', 'Affecter aux stations', 'employees'),
  ('employees.disable', 'Activer / désactiver un compte', 'employees'),
  ('users.reset_password', 'Demander une réinitialisation de mot de passe', 'users'),
  ('platform.view', 'Consulter le back-office SaaS', 'platform')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.key
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.company_id IS NULL
  AND (
    (r.key IN ('owner', 'manager') AND p.key IN ('employees.invite','employees.assign_stations','employees.disable','users.reset_password'))
    OR (r.key = 'super_admin' AND p.key = 'platform.view')
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Contexte complet d'un utilisateur, calculé côté serveur. Le frontend ne
-- fournit aucun identifiant d'entreprise : current_company_id() lit le JWT.
CREATE OR REPLACE FUNCTION public.my_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_profile public.user_profiles%ROWTYPE;
  v_role_key text;
  v_permissions text[];
  v_company_json jsonb;
  v_stations jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('userId', NULL, 'authenticated', false);
  END IF;
  SELECT * INTO v_profile FROM public.user_profiles WHERE id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', v_user, 'authenticated', true, 'profileReady', false,
      'isPlatformAdmin', v_admin, 'company', NULL, 'stations', '[]'::jsonb, 'permissions', '[]'::jsonb);
  END IF;
  SELECT key INTO v_role_key FROM public.roles WHERE id = v_profile.role_id;
  IF v_admin THEN
    SELECT array_agg(key ORDER BY key) INTO v_permissions FROM public.permissions;
  ELSE
    SELECT COALESCE(array_agg(rp.permission_id ORDER BY rp.permission_id), ARRAY[]::text[])
      INTO v_permissions
      FROM public.role_permissions rp WHERE rp.role_id = v_profile.role_id;
  END IF;
  SELECT to_jsonb(c) - 'updated_at' - 'deleted_at' INTO v_company_json
    FROM public.companies c WHERE c.id = v_company;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'city', s.city, 'activated', s.activated
    ) ORDER BY s.created_at), '[]'::jsonb)
    INTO v_stations
    FROM public.stations s
    WHERE s.company_id = v_company AND s.deleted_at IS NULL
      AND (v_admin OR public.can_access_station(s.id));
  RETURN jsonb_build_object(
    'userId', v_user,
    'authenticated', true,
    'profileReady', true,
    'active', v_profile.active AND COALESCE(v_company_json->>'suspended', 'false') <> 'true',
    'email', COALESCE((SELECT email FROM auth.users WHERE id = v_user), v_profile.email),
    'fullName', v_profile.full_name,
    'roleKey', COALESCE(v_role_key, ''),
    'isPlatformAdmin', v_admin,
    'company', v_company_json,
    'companyId', v_company,
    'stations', v_stations,
    'permissions', to_jsonb(COALESCE(v_permissions, ARRAY[]::text[]))
  );
END $$;

REVOKE ALL ON FUNCTION public.my_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_context() TO authenticated;

-- Acceptation : appelée après SIGNED_IN ; marque les invitations en attente
-- de l'adresse e-mail confirmée, sans jamais accepter celle d'un autre tenant.
CREATE OR REPLACE FUNCTION public.accept_my_invitations() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user uuid := auth.uid(); v_company uuid := public.current_company_id(); v_email text;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN RETURN; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user;
  IF v_email IS NULL THEN RETURN; END IF;
  UPDATE public.user_invitations
    SET accepted_at = now(), accepted_user_id = v_user
    WHERE company_id = v_company AND lower(email) = lower(v_email)
      AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now();
END $$;

REVOKE ALL ON FUNCTION public.accept_my_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_invitations() TO authenticated;
