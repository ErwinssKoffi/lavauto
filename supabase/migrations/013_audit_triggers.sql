-- 013 — Journal d'audit des opérations d'identité (Prompt 04)
-- Acteur = auth.uid() quand il existe ; les triggers fonctionnent aussi pour
-- les insertions système (bootstrap Auth, service d'invitation).

CREATE OR REPLACE FUNCTION public.log_user_profile_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_actor uuid := COALESCE(auth.uid(), NEW.id);
  v_action text := CASE WHEN TG_OP = 'INSERT' THEN 'user.created' ELSE 'user.updated' END;
BEGIN
  INSERT INTO public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, detail)
  VALUES (
    v_company, v_actor, v_action, 'user_profiles', NEW.id::text,
    jsonb_build_object(
      'email', NEW.email,
      'active', NEW.active,
      'roleId', NEW.role_id,
      'previousActive', CASE WHEN TG_OP = 'UPDATE' THEN OLD.active ELSE NULL END,
      'previousRoleId', CASE WHEN TG_OP = 'UPDATE' THEN OLD.role_id ELSE NULL END
    )
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_user_profiles_audit ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_audit
  AFTER INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_user_profile_change();

CREATE OR REPLACE FUNCTION public.log_station_assignment_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
  v_station uuid := COALESCE(NEW.station_id, OLD.station_id);
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  INSERT INTO public.audit_logs (company_id, station_id, actor_user_id, action, entity_type, entity_id, detail)
  VALUES (
    v_company, v_station, COALESCE(auth.uid(), v_user),
    CASE WHEN TG_OP = 'INSERT' THEN 'user.station_assigned' ELSE 'user.station_unassigned' END,
    'user_station_assignments', v_user::text,
    jsonb_build_object('stationId', v_station)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_station_assignments_audit ON public.user_station_assignments;
CREATE TRIGGER trg_station_assignments_audit
  AFTER INSERT OR DELETE ON public.user_station_assignments
  FOR EACH ROW EXECUTE FUNCTION public.log_station_assignment_change();

CREATE OR REPLACE FUNCTION public.log_invitation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := COALESCE(NEW.company_id, OLD.company_id);
BEGIN
  INSERT INTO public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, detail)
  VALUES (
    v_company, COALESCE(auth.uid(), NEW.invited_by),
    CASE
      WHEN TG_OP = 'INSERT' THEN 'user.invited'
      WHEN NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN 'user.invitation_revoked'
      WHEN NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN 'user.invitation_accepted'
      ELSE 'user.invitation_updated'
    END,
    'user_invitations', NEW.id::text,
    jsonb_build_object('email', NEW.email, 'expiresAt', NEW.expires_at)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_user_invitations_audit ON public.user_invitations;
CREATE TRIGGER trg_user_invitations_audit
  AFTER INSERT OR UPDATE ON public.user_invitations
  FOR EACH ROW EXECUTE FUNCTION public.log_invitation_change();
