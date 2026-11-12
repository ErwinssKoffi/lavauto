-- 019 — Profil du super admin hors tenant (Prompt 04)
-- `enforce_company_id()` refuse par défaut tout company_id NULL. Le super
-- admin n'appartient à AUCUNE entreprise : son profil est la seule exception,
-- vérifiée côté serveur par platform_admins + auth.uid().

CREATE OR REPLACE FUNCTION public.enforce_company_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid := public.current_company_id();
  v_row jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'user_profiles'
     AND v_row->>'company_id' IS NULL
     AND (v_row->>'id')::uuid = auth.uid()
     AND public.is_platform_admin() THEN
    RETURN NEW; -- super admin SaaS : aucun tenant, mécanisme séparé
  END IF;
  IF v IS NOT NULL THEN
    IF NEW.company_id IS DISTINCT FROM v THEN
      RAISE EXCEPTION 'company_id imposé par le serveur (reçu %, attendu %)', NEW.company_id, v USING ERRCODE = '42501';
    END IF;
    NEW.company_id := v;
  ELSIF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id manquant : aucune session entreprise' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
