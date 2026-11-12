-- 015 — Lectures RBAC pour les écrans Employés / Invitations (Prompt 04)
-- Le frontend n'envoie ni company_id ni station_id : tout est dérivé du JWT.

CREATE OR REPLACE FUNCTION public.my_company_users() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_can_manage boolean := public.is_platform_admin() OR public.has_permission('employees.manage');
  v_rows jsonb;
BEGIN
  IF v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT v_can_manage THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'fullName', p.full_name, 'email', p.email, 'phone', p.phone,
      'roleKey', r.key, 'active', p.active, 'createdAt', p.created_at,
      'stationIds', COALESCE((
        SELECT jsonb_agg(a.station_id) FROM public.user_station_assignments a WHERE a.user_id = p.id
      ), '[]'::jsonb)
    )), '[]'::jsonb)
    INTO v_rows
    FROM public.user_profiles p LEFT JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = v_user;
    RETURN v_rows;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'fullName', p.full_name, 'email', p.email, 'phone', p.phone,
    'roleKey', r.key, 'active', p.active, 'createdAt', p.created_at,
    'stationIds', COALESCE((
      SELECT jsonb_agg(a.station_id ORDER BY a.station_id)
      FROM public.user_station_assignments a WHERE a.user_id = p.id
    ), '[]'::jsonb)
  ) ORDER BY p.created_at), '[]'::jsonb)
  INTO v_rows
  FROM public.user_profiles p LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.company_id = v_company AND p.deleted_at IS NULL;
  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION public.my_company_invitations() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT (public.is_platform_admin() OR public.has_permission('employees.manage')) THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'email', i.email, 'roleKey', r.key,
    'stationIds', i.station_ids, 'expiresAt', i.expires_at,
    'acceptedAt', i.accepted_at, 'revokedAt', i.revoked_at,
    'createdAt', i.created_at
  ) ORDER BY i.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.user_invitations i LEFT JOIN public.roles r ON r.id = i.role_id
  WHERE i.company_id = v_company;
  RETURN v_rows;
END $$;

REVOKE ALL ON FUNCTION public.my_company_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_users() TO authenticated;
REVOKE ALL ON FUNCTION public.my_company_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_invitations() TO authenticated;
