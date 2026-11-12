-- 050 — Prompt 10 : garde RLS RESTRICTIVE sur Storage.
-- 049 utilisait des policies permissives USING(false). Une policy permissive
-- future ajoutee par Supabase pourrait alors reautoriser une ligne : la garde
-- doit etre restrictive (AND), pas permissive (OR). Les grants historiques de
-- supabase_storage_admin restent non revoquables depuis le role de migration ;
-- la protection des donnees est donc assuree par RLS, verifiee avec un objet
-- reel en BEGIN ... ROLLBACK par supabase/tests/p10_rollback.sql.
-- Additif : aucune reecriture de 001-049, aucun compte, aucun secret.

DROP POLICY IF EXISTS p10_anon_objects_deny ON storage.objects;
CREATE POLICY p10_anon_objects_deny ON storage.objects
AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS p10_anon_buckets_deny ON storage.buckets;
CREATE POLICY p10_anon_buckets_deny ON storage.buckets
AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);

-- Les policies d'ecriture de bucket sont separees pour ne pas bloquer le
-- SELECT du bucket station-assets, toujours necessaire a l'API Storage.
DROP POLICY IF EXISTS p10_bucket_write_deny ON storage.buckets;
DROP POLICY IF EXISTS p10_bucket_insert_deny ON storage.buckets;
DROP POLICY IF EXISTS p10_bucket_update_deny ON storage.buckets;
DROP POLICY IF EXISTS p10_bucket_delete_deny ON storage.buckets;

CREATE POLICY p10_bucket_insert_deny ON storage.buckets
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY p10_bucket_update_deny ON storage.buckets
AS RESTRICTIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (false);

CREATE POLICY p10_bucket_delete_deny ON storage.buckets
AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

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
        AND policyname IN ('p10_anon_objects_deny', 'p10_anon_buckets_deny')
        AND permissive = 'RESTRICTIVE'
        AND qual = 'false' AND with_check = 'false') = 2,
    'anonStorageSelectGrant', has_table_privilege('anon', 'storage.objects', 'SELECT'),
    'authenticatedBucketInsertRevoked', (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'buckets'
        AND policyname = 'p10_bucket_insert_deny'
        AND permissive = 'RESTRICTIVE'
        AND with_check = 'false') = 1,
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
      'storage', 'Bucket prive, RLS restrictive deny-all pour anon, chemin construit cote serveur, URL signee',
      'deployment', 'CI GitHub Actions, Vercel et Supabase par variables d environnement'
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.my_qa_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_qa_board() TO authenticated;
