-- 012 — Politiques RBAC explicites sur l'identité (Prompt 04)
-- Les politiques génériques de 009 laissaient tout utilisateur du tenant
-- modifier les profils et affectations. Elles sont remplacées par des
-- politiques qui vérifient has_permission() côté serveur.

DROP POLICY IF EXISTS p_user_profiles_all ON public.user_profiles;
DROP POLICY IF EXISTS p_user_station_assignments_all ON public.user_station_assignments;
DROP POLICY IF EXISTS p_user_invitations_all ON public.user_invitations;

-- Lecture : son propre profil, ou tous les profils de l'entreprise si le
-- serveur accorde employees.manage. Le super admin SaaS lit tous les tenants.
CREATE POLICY p_user_profiles_select ON public.user_profiles FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND (id = auth.uid() OR public.has_permission('employees.manage'))
    )
  );

-- Écriture : réservée à employees.manage (ou au service plateforme). Les
-- triggers/fonctions SECURITY DEFINER et service_role contournent la RLS.
CREATE POLICY p_user_profiles_insert ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.manage')
    )
  );
CREATE POLICY p_user_profiles_update ON public.user_profiles FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.manage')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.manage')
    )
  );

-- Affectations : chacun voit les siennes ; la gestion exige la permission
-- employée, jamais un simple masquage de bouton dans le frontend.
CREATE POLICY p_user_station_assignments_select ON public.user_station_assignments FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND (user_id = auth.uid() OR public.has_permission('employees.manage'))
    )
  );
CREATE POLICY p_user_station_assignments_manage ON public.user_station_assignments
  FOR ALL TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.assign_stations')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.assign_stations')
    )
  );

-- Invitations : visibles par les gestionnaires, créées/révoquées uniquement
-- avec employees.invite. Une invitation ne peut jamais cibler un autre tenant.
CREATE POLICY p_user_invitations_select ON public.user_invitations FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.manage')
    )
  );
CREATE POLICY p_user_invitations_insert ON public.user_invitations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.invite')
    )
  );
CREATE POLICY p_user_invitations_update ON public.user_invitations FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.invite')
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      company_id = public.current_company_id()
      AND public.has_permission('employees.invite')
    )
  );

-- Le profil reste lisible par son propriétaire même sans permission de gestion.
-- p_user_profiles_self (009) est conservée : les politiques SELECT s'additionnent.
