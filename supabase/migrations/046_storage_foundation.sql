-- 046 — Prompt 10 : bucket prive station-assets et RLS par dossier tenant.
-- Le chemin est construit cote serveur ; le frontend ne fournit jamais
-- l'identifiant d'entreprise. Aucun fichier, compte ou secret n'est cree.

INSERT INTO storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
VALUES (
  'station-assets',
  'station-assets',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  "public" = EXCLUDED."public",
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Supabase accorde par defaut trop de privileges a anon sur storage.*.
-- Le bucket reste lisible par authenticated uniquement via les policies.
REVOKE ALL ON storage.objects FROM anon;
REVOKE ALL ON storage.buckets FROM anon;
REVOKE INSERT, UPDATE, DELETE ON storage.buckets FROM authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

DROP POLICY IF EXISTS p10_station_assets_bucket_select ON storage.buckets;
CREATE POLICY p10_station_assets_bucket_select ON storage.buckets
FOR SELECT TO authenticated
USING (id = 'station-assets' OR public.is_platform_admin());

DROP POLICY IF EXISTS p10_station_assets_select ON storage.objects;
CREATE POLICY p10_station_assets_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'station-assets'
  AND (
    public.is_platform_admin()
    OR (
      coalesce(array_length(storage.foldername(name), 1), 0) >= 1
      AND (storage.foldername(name))[1] = public.current_company_id()::text
    )
  )
);

DROP POLICY IF EXISTS p10_station_assets_insert ON storage.objects;
CREATE POLICY p10_station_assets_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'station-assets'
  AND (
    public.is_platform_admin()
    OR (
      coalesce(array_length(storage.foldername(name), 1), 0) >= 1
      AND (storage.foldername(name))[1] = public.current_company_id()::text
    )
  )
);

DROP POLICY IF EXISTS p10_station_assets_update ON storage.objects;
CREATE POLICY p10_station_assets_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'station-assets'
  AND (
    public.is_platform_admin()
    OR (
      coalesce(array_length(storage.foldername(name), 1), 0) >= 1
      AND (storage.foldername(name))[1] = public.current_company_id()::text
    )
  )
)
WITH CHECK (
  bucket_id = 'station-assets'
  AND (
    public.is_platform_admin()
    OR (
      coalesce(array_length(storage.foldername(name), 1), 0) >= 1
      AND (storage.foldername(name))[1] = public.current_company_id()::text
    )
  )
);

DROP POLICY IF EXISTS p10_station_assets_delete ON storage.objects;
CREATE POLICY p10_station_assets_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'station-assets'
  AND (
    public.is_platform_admin()
    OR (
      coalesce(array_length(storage.foldername(name), 1), 0) >= 1
      AND (storage.foldername(name))[1] = public.current_company_id()::text
    )
  )
);

-- Chemin serveur : premier dossier = entreprise de l'appelant. Le nom de
-- fichier est normalise ; l'upsert cote client rend l'operation idempotente.
CREATE OR REPLACE FUNCTION public.station_asset_path(p_filename text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_safe text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Permission settings.manage requise' USING ERRCODE = '42501';
  END IF;
  v_company := public.current_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  v_safe := regexp_replace(
    lower(coalesce(nullif(p_filename, ''), 'logo')),
    '[^a-z0-9._-]+', '-', 'g'
  );
  RETURN v_company::text || '/' || v_safe;
END $$;

REVOKE ALL ON FUNCTION public.station_asset_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.station_asset_path(text) TO authenticated;
