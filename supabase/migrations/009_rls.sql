-- 009 — RLS sur TOUTES les tables (Prompt 03)
-- Isolation : company_id = dérivé de auth.uid() (jamais fourni par le frontend).
-- Portée station : owner/manager voient toutes les stations de l'entreprise,
-- caissier/laveur uniquement celles auxquelles ils sont affectés.
-- super_admin : mécanisme séparé, pas un faux company_id.
DO $$
DECLARE
  t record;
  v_special text[] := ARRAY['companies','currencies','roles','permissions','role_permissions','plans','plan_limits','platform_admins','platform_audit_logs'];
  v_immutable text[] := ARRAY['audit_logs','service_price_history','wash_items','wash_status_history','cash_movements','payments','payment_cancellations','stock_movements','commission_payouts'];
  v_has_station boolean;
  v_using text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    IF t.tablename = ANY (v_special) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t.tablename AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'Table % sans company_id : politique explicite obligatoire', t.tablename;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t.tablename AND column_name = 'station_id'
    ) INTO v_has_station;
    v_using := '((public.current_company_id() IS NOT NULL AND company_id = public.current_company_id()) OR public.is_platform_admin())';
    IF v_has_station THEN
      v_using := '(' || v_using || ' AND public.can_access_station(station_id))';
    END IF;
    IF t.tablename = ANY (v_immutable) THEN
      EXECUTE format('CREATE POLICY p_%I_select ON public.%I FOR SELECT TO authenticated USING (%s)', t.tablename, t.tablename, v_using);
      EXECUTE format('CREATE POLICY p_%I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t.tablename, t.tablename, v_using);
    ELSE
      EXECUTE format('CREATE POLICY p_%I_all ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', t.tablename, t.tablename, v_using, v_using);
    END IF;
  END LOOP;
END $$;

-- Référentiels publics / configuration (RLS activé + politique explicite).
CREATE POLICY p_currencies_read ON public.currencies FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY p_permissions_read ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY p_role_permissions_read ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY p_roles_read ON public.roles FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = public.current_company_id() OR public.is_platform_admin());
CREATE POLICY p_roles_admin ON public.roles FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY p_plans_read ON public.plans FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY p_plans_admin ON public.plans FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY p_plan_limits_read ON public.plan_limits FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY p_plan_limits_admin ON public.plan_limits FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY p_platform_admins_read ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());
CREATE POLICY p_platform_audit_select ON public.platform_audit_logs FOR SELECT TO authenticated
  USING (public.is_platform_admin());
CREATE POLICY p_platform_audit_insert ON public.platform_audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());
CREATE POLICY p_user_profiles_self ON public.user_profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Racine du tenant. La création d'une entreprise passe OBLIGATOIREMENT par
-- signup_company() (SECURITY DEFINER), jamais par un INSERT client libre.
CREATE POLICY p_companies_tenant ON public.companies FOR ALL TO authenticated
  USING (id = public.current_company_id() OR public.is_platform_admin())
  WITH CHECK (id = public.current_company_id() OR public.is_platform_admin());

-- Écritures sensibles : interdites en direct, uniquement via fonctions
-- SECURITY DEFINER qui vérifient les permissions et l'idempotence (010).
REVOKE INSERT, UPDATE, DELETE ON
  public.audit_logs, public.service_price_history, public.wash_items,
  public.wash_status_history, public.cash_movements, public.payments,
  public.payment_cancellations, public.stock_movements, public.commission_payouts
FROM anon, authenticated;
