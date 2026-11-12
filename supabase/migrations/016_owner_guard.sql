-- 016 — Durcissement RBAC : abonnement propriétaire, propriétaire protégé
-- (Prompt 04). Le garde-fou est dans la fonction, pas seulement dans l'UI.

DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id AND r.company_id IS NULL AND r.key = 'manager'
  AND rp.permission_id = 'subscription.manage';

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_role_key text DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_station_ids uuid[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_actor uuid := auth.uid();
  v_profile public.user_profiles%ROWTYPE;
  v_current_role text;
  v_actor_role text;
  v_role uuid;
  v_station uuid;
BEGIN
  IF NOT (public.is_platform_admin() OR public.has_permission('employees.manage')) THEN
    RAISE EXCEPTION 'Permission employees.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise rattachée à la session' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_profile FROM public.user_profiles WHERE id = p_user_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT key INTO v_current_role FROM public.roles WHERE id = v_profile.role_id;
  SELECT r.key INTO v_actor_role
    FROM public.user_profiles p JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = v_actor;

  -- Élévation de privilèges : un gérant ne peut ni rétrograder ni désactiver
  -- le propriétaire, même avec employees.manage.
  IF v_current_role = 'owner' AND COALESCE(v_actor_role, '') <> 'owner'
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Le propriétaire ne peut pas être modifié par un autre rôle' USING ERRCODE = '42501';
  END IF;

  IF p_role_key IS NOT NULL THEN
    IF p_role_key NOT IN ('manager', 'cashier', 'washer') THEN
      RAISE EXCEPTION 'Rôle cible non autorisé' USING ERRCODE = '23514';
    END IF;
    IF v_current_role = 'owner' THEN
      RAISE EXCEPTION 'Le rôle du propriétaire ne peut pas être modifié' USING ERRCODE = '55000';
    END IF;
    SELECT id INTO v_role FROM public.roles WHERE company_id IS NULL AND key = p_role_key;
    IF v_role IS NULL THEN RAISE EXCEPTION 'Rôle inconnu' USING ERRCODE = '23514'; END IF;
  END IF;
  IF p_active = false AND p_user_id = v_actor THEN
    RAISE EXCEPTION 'Un compte ne peut pas se désactiver lui-même' USING ERRCODE = '23514';
  END IF;
  IF p_station_ids IS NOT NULL THEN
    FOREACH v_station IN ARRAY p_station_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.stations s
        WHERE s.id = v_station AND s.company_id = v_company AND s.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Station hors périmètre' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.user_profiles
    SET role_id = COALESCE(v_role, role_id),
        active = COALESCE(p_active, active)
    WHERE id = p_user_id AND company_id = v_company;
  IF p_station_ids IS NOT NULL THEN
    DELETE FROM public.user_station_assignments
      WHERE user_id = p_user_id AND company_id = v_company;
    INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
      SELECT v_company, p_user_id, s FROM unnest(p_station_ids) AS s
      ON CONFLICT (user_id, station_id) DO NOTHING;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_update_user(uuid, text, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, boolean, uuid[]) TO authenticated;
