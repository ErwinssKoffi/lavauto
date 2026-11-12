-- 020 — Journal d'audit du super admin hors tenant (Prompt 04)
-- L'insertion du profil super_admin (company_id NULL) déclenche un audit_log
-- lui aussi hors tenant. Cette exception est contrôlée par plateforme + acteur.

CREATE OR REPLACE FUNCTION public.enforce_company_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid := public.current_company_id();
  v_row jsonb := to_jsonb(NEW);
  v_actor text := v_row->>'actor_user_id';
BEGIN
  IF public.is_platform_admin() AND v_row->>'company_id' IS NULL AND (
    (TG_TABLE_NAME = 'user_profiles' AND (v_row->>'id')::uuid = auth.uid())
    OR (TG_TABLE_NAME = 'audit_logs' AND v_actor IS NOT NULL AND v_actor::uuid = auth.uid())
  ) THEN
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
