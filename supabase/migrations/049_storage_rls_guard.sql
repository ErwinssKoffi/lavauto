-- 049 — Prompt 10 : garde RLS explicite sur Storage.
-- Les grants Supabase de storage.* appartiennent a supabase_storage_admin,
-- role reserve que la migration ne peut pas impersoner. La securite est donc
-- garantie par RLS : deny-all pour anon, ecritures bucket interdites aux
-- utilisateurs authentifies, SELECT bucket deja filtre par 046.
-- my_qa_board() est remplacee pour mesurer ces controles reels, pas des grants.

DROP POLICY IF EXISTS p10_anon_objects_deny ON storage.objects;
CREATE POLICY p10_anon_objects_deny ON storage.objects
FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS p10_anon_buckets_deny ON storage.buckets;
CREATE POLICY p10_anon_buckets_deny ON storage.buckets
FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS p10_bucket_write_deny ON storage.buckets;
CREATE POLICY p10_bucket_write_deny ON storage.buckets
FOR ALL TO authenticated USING (false) WITH CHECK (false);

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
    'bucketPolicies', (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'buckets'
        AND policyname LIKE 'p10_%'),
    'anonStorageRevoked', (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage'
        AND policyname IN ('p10_anon_objects_deny', 'p10_anon_buckets_deny')) = 2,
    'authenticatedBucketInsertRevoked', (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'buckets'
        AND policyname = 'p10_bucket_write_deny') = 1,
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
      'storage', 'Bucket prive, RLS deny-all pour anon, chemin construit cote serveur, URL signee',
      'deployment', 'CI GitHub Actions, Vercel et Supabase par variables d environnement'
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.my_qa_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_qa_board() TO authenticated;
