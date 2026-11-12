-- 047 — Prompt 10 : idempotence des commandes, board QA et durcissement final.
-- Additif : aucune réécriture 001–046, aucune fixture, aucun secret.

CREATE TABLE public.rpc_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rpc_name text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, rpc_name, idempotency_key)
);

ALTER TABLE public.rpc_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p10_idempotency_select ON public.rpc_idempotency_keys;
CREATE POLICY p10_idempotency_select ON public.rpc_idempotency_keys
FOR SELECT TO authenticated
USING (company_id = public.current_company_id() OR public.is_platform_admin());

-- Aucune ecriture directe : seule la fonction SECURITY DEFINER ecrit.
REVOKE ALL ON TABLE public.rpc_idempotency_keys FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_rpc_idempotency(
  p_rpc text,
  p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_first boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF p_rpc NOT IN (
    'my_washes_page', 'station_asset_path', 'my_qa_board',
    'admin_save_plan', 'admin_set_plan_limit',
    'admin_set_company_subscription', 'admin_set_company_suspended',
    'refresh_subscription_usage'
  ) THEN
    RAISE EXCEPTION 'RPC non autorisee pour l idempotence' USING ERRCODE = '23514';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
    RAISE EXCEPTION 'Cle d idempotence invalide' USING ERRCODE = '23514';
  END IF;
  v_company := coalesce(public.current_company_id(), auth.uid());
  INSERT INTO public.rpc_idempotency_keys (company_id, user_id, rpc_name, idempotency_key)
  VALUES (v_company, auth.uid(), p_rpc, p_key)
  ON CONFLICT (company_id, rpc_name, idempotency_key) DO NOTHING;
  v_first := FOUND;
  RETURN jsonb_build_object('firstCall', v_first, 'rpc', p_rpc);
END $$;

CREATE OR REPLACE FUNCTION public.my_qa_board()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_admin boolean := public.is_platform_admin();
BEGIN
  IF v_user IS NULL OR NOT (public.has_permission('reports.view') OR v_admin) THEN
    RAISE EXCEPTION 'Permission reports.view requise' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'migrations', (SELECT count(*) FROM supabase_migrations.schema_migrations),
    'tables', (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
    'views', (SELECT count(*) FROM pg_views
      WHERE schemaname = 'public'
        AND viewname IN ('v_station_daily_activity', 'v_company_quota_usage')),
    'permissions', (SELECT count(*) FROM public.permissions),
    'rolePermissions', (SELECT count(*) FROM public.role_permissions),
    'indexes', (SELECT count(*) FROM pg_indexes
      WHERE schemaname = 'public' AND indexname LIKE 'ix_p10_%'),
    'storageBucket', EXISTS (
      SELECT 1 FROM storage.buckets
      WHERE id = 'station-assets' AND "public" = false
    ),
    'storagePolicies', (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE 'p10_%'),
    'anonStorageRevoked',
      NOT has_table_privilege('anon', 'storage.objects', 'SELECT')
      AND NOT has_table_privilege('anon', 'storage.buckets', 'SELECT'),
    'authenticatedBucketInsertRevoked',
      NOT has_table_privilege('authenticated', 'storage.buckets', 'INSERT'),
    'idempotencyTable', to_regclass('public.rpc_idempotency_keys') IS NOT NULL,
    'rpcCount', (SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('my_washes_page', 'station_asset_path',
          'claim_rpc_idempotency', 'my_qa_board')
        AND p.prosecdef),
    'quotaTriggers', (SELECT count(*) FROM pg_trigger
      WHERE tgname IN ('trg_quota_stations', 'trg_quota_profiles', 'trg_quota_washes')),
    'rules', jsonb_build_object(
      'network', 'Retry exponentiel, cle d idempotence stable, aucun secret cote navigateur',
      'pagination', 'LIMIT OFFSET cote serveur, 100 lignes maximum par page',
      'storage', 'Bucket prive, chemin construit cote serveur, URL signee',
      'deployment', 'CI GitHub Actions, Vercel et Supabase par variables d environnement'
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.claim_rpc_idempotency(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_rpc_idempotency(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.my_qa_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_qa_board() TO authenticated;
