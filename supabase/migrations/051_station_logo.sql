-- 051 — Logo privé associé durablement à une station.
-- Les anciennes valeurs de logo_url restent intactes pour rollback, mais ne
-- sont jamais interprétées comme des chemins ni affichées par le frontend.
ALTER TABLE public.stations ADD COLUMN IF NOT EXISTS logo_path text;

ALTER TABLE public.stations ADD CONSTRAINT stations_logo_path_private CHECK (
  logo_path IS NULL OR logo_path ~ ('^' || company_id::text || '/[a-z0-9][a-z0-9._-]*$')
);

-- La policy historique sur stations autorise des écritures directes au sein du
-- tenant. Ce garde protège aussi ces écritures, pas seulement la nouvelle RPC.
CREATE OR REPLACE FUNCTION public.guard_station_logo_path()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.logo_path IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.logo_path IS NOT DISTINCT FROM OLD.logo_path THEN RETURN NEW; END IF;

  IF auth.uid() IS NULL THEN
    IF current_setting('role', true) IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
    END IF;
  ELSIF public.current_company_id() IS DISTINCT FROM NEW.company_id
     OR NOT public.has_permission('settings.manage')
     OR NOT public.can_access_station(NEW.id) THEN
    RAISE EXCEPTION 'Permission settings.manage et station autorisee requises' USING ERRCODE = '42501';
  END IF;

  IF NEW.logo_path IS NOT NULL THEN
    IF NEW.logo_path !~ ('^' || NEW.company_id::text || '/[a-z0-9][a-z0-9._-]*$') THEN
      RAISE EXCEPTION 'Chemin de logo invalide' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'station-assets' AND o.name = NEW.logo_path) THEN
      RAISE EXCEPTION 'Objet de logo introuvable dans le stockage prive' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_station_logo_path ON public.stations;
CREATE TRIGGER trg_guard_station_logo_path
  BEFORE INSERT OR UPDATE OF logo_path ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.guard_station_logo_path();
REVOKE ALL ON FUNCTION public.guard_station_logo_path() FROM PUBLIC, anon, authenticated;

-- Les politiques Storage P10 filtrent par tenant, mais pas par permission.
-- Ajouter des gardes restrictifs sans modifier les policies des autres buckets.
CREATE POLICY station_assets_settings_insert ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'station-assets' OR public.has_permission('settings.manage'));
CREATE POLICY station_assets_settings_update ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'station-assets' OR public.has_permission('settings.manage'))
  WITH CHECK (bucket_id <> 'station-assets' OR public.has_permission('settings.manage'));
CREATE POLICY station_assets_settings_delete ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'station-assets' OR public.has_permission('settings.manage'));

-- L'entreprise est toujours déduite de la session ; la station et l'objet
-- doivent lui appartenir. La suppression dissocie le logo sans effacer le
-- fichier Storage potentiellement partagé ou encore référencé ailleurs.
CREATE OR REPLACE FUNCTION public.save_station_logo(p_station_id uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Permission settings.manage requise' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL
      AND public.can_access_station(s.id)) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  IF p_path IS NOT NULL THEN
    IF p_path !~ ('^' || v_company::text || '/[a-z0-9][a-z0-9._-]*$') THEN
      RAISE EXCEPTION 'Chemin de logo invalide' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'station-assets' AND o.name = p_path) THEN
      RAISE EXCEPTION 'Objet de logo introuvable dans le stockage prive' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE public.stations SET logo_path = p_path
    WHERE id = p_station_id AND company_id = v_company AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.save_station_logo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_station_logo(uuid, text) TO authenticated;

-- La projection Auth fournit le chemin pour chaque station accessible au
-- démarrage, sans jamais enregistrer de jeton ou d'URL signée en base.
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
      'id', s.id, 'name', s.name, 'city', s.city, 'activated', s.activated, 'logoPath', s.logo_path
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

