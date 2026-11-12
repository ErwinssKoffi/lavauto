-- 042 — Prompt 09 : back-office SaaS, formules, quotas, suspension, journaux.
-- Toutes les écritures passent par ces RPC ; l'entreprise cible est un UUID
-- explicite fourni par le super admin, jamais un tenant déduit du navigateur.
CREATE OR REPLACE FUNCTION public.my_platform_board() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_companies jsonb := '[]'::jsonb;
  v_plans jsonb := '[]'::jsonb;
  v_limits jsonb := '[]'::jsonb;
  v_usage jsonb := '[]'::jsonb;
  v_audit jsonb := '[]'::jsonb;
  v_stats jsonb;
  v_exceeded integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acces reserve au super admin WashGuard' USING ERRCODE = '42501';
  END IF;

  WITH company_rows AS (
    SELECT c.id, c.name, c.city, c.phone, c.suspended, c.created_at,
      s.plan_id, s.status AS subscription_status, s.started_at,
      p.name AS plan_name,
      (SELECT count(*) FROM public.stations st
        WHERE st.company_id = c.id AND st.deleted_at IS NULL) AS stations_used,
      (SELECT count(*) FROM public.user_profiles u
        WHERE u.company_id = c.id AND u.active AND u.deleted_at IS NULL) AS employees_used,
      (SELECT count(*) FROM public.washes w
        WHERE w.company_id = c.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at >= date_trunc('month', now())) AS washes_month_used,
      (SELECT COALESCE(SUM(w.total_minor), 0) FROM public.washes w
        WHERE w.company_id = c.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at >= date_trunc('month', now())) AS monthly_revenue,
      (SELECT pl.value_int FROM public.plan_limits pl
        WHERE pl.plan_id = s.plan_id AND pl.key = 'stations') AS stations_limit,
      (SELECT pl.value_int FROM public.plan_limits pl
        WHERE pl.plan_id = s.plan_id AND pl.key = 'employees') AS employees_limit,
      (SELECT pl.value_int FROM public.plan_limits pl
        WHERE pl.plan_id = s.plan_id AND pl.key = 'washes_per_month') AS washes_limit
    FROM public.companies c
    LEFT JOIN public.subscriptions s ON s.company_id = c.id
      AND s.status IN ('trial','active','past_due','suspended')
    LEFT JOIN public.plans p ON p.id = s.plan_id
    WHERE c.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'companyId', r.id, 'name', r.name, 'city', r.city, 'phone', r.phone,
    'suspended', r.suspended,
    'status', CASE WHEN r.suspended THEN 'suspendue'
      WHEN r.subscription_status = 'trial' THEN 'essai' ELSE 'active' END,
    'planId', r.plan_id, 'planName', r.plan_name,
    'subscriptionStatus', r.subscription_status,
    'subscriptionStartedAt', r.started_at::text,
    'stationCount', r.stations_used, 'employeeCount', r.employees_used,
    'washesMonth', r.washes_month_used, 'monthlyRevenue', r.monthly_revenue,
    'companyCreatedAt', r.created_at::text,
    'limits', jsonb_build_object('stations', r.stations_limit,
      'employees', r.employees_limit, 'washesPerMonth', r.washes_limit),
    'quota', jsonb_build_object('stationsUsed', r.stations_used,
      'employeesUsed', r.employees_used, 'washesMonthUsed', r.washes_month_used,
      'quotaExceeded', (r.stations_limit IS NOT NULL AND r.stations_used > r.stations_limit)
        OR (r.employees_limit IS NOT NULL AND r.employees_used > r.employees_limit)
        OR (r.washes_limit IS NOT NULL AND r.washes_month_used > r.washes_limit))
  ) ORDER BY r.created_at), '[]'::jsonb),
  COALESCE(SUM(CASE WHEN (r.stations_limit IS NOT NULL AND r.stations_used > r.stations_limit)
    OR (r.employees_limit IS NOT NULL AND r.employees_used > r.employees_limit)
    OR (r.washes_limit IS NOT NULL AND r.washes_month_used > r.washes_limit)
    THEN 1 ELSE 0 END), 0)
  INTO v_companies, v_exceeded
  FROM company_rows r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'priceMonthlyMinor', p.price_monthly_minor,
    'trialDays', p.trial_days, 'active', p.active, 'sortOrder', p.sort_order,
    'features', p.features
  ) ORDER BY p.sort_order, p.id), '[]'::jsonb)
  INTO v_plans FROM public.plans p;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'planId', pl.plan_id, 'key', pl.key, 'valueInt', pl.value_int
  ) ORDER BY pl.plan_id, pl.key), '[]'::jsonb)
  INTO v_limits FROM public.plan_limits pl;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'companyId', u.company_id, 'stationId', u.station_id,
    'periodStart', u.period_start::text, 'metricKey', u.metric_key,
    'valueInt', u.value_int, 'updatedAt', u.updated_at::text
  ) ORDER BY u.updated_at DESC), '[]'::jsonb)
  INTO v_usage FROM (
    SELECT * FROM public.subscription_usage ORDER BY updated_at DESC LIMIT 500
  ) u;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id, 'actorUserId', a.actor_user_id, 'action', a.action,
    'entityType', a.entity_type, 'entityId', a.entity_id,
    'detail', a.detail, 'createdAt', a.created_at::text
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_audit FROM (
    SELECT * FROM public.platform_audit_logs ORDER BY created_at DESC LIMIT 100
  ) a;

  v_stats := jsonb_build_object(
    'companies', jsonb_array_length(v_companies),
    'suspendedCompanies', (SELECT count(*) FROM jsonb_array_elements(v_companies) x
      WHERE (x->>'suspended')::boolean),
    'plans', jsonb_array_length(v_plans),
    'planLimits', jsonb_array_length(v_limits),
    'usageRows', jsonb_array_length(v_usage),
    'auditLogs', jsonb_array_length(v_audit),
    'quotasExceeded', v_exceeded
  );

  RETURN jsonb_build_object(
    'companies', v_companies, 'plans', v_plans, 'planLimits', v_limits,
    'subscriptionUsage', v_usage, 'auditLogs', v_audit, 'stats', v_stats,
    'rules', jsonb_build_object(
      'pricing', 'Les tarifs 0 / 15000 / 35000 FCFA sont des hypotheses commerciales',
      'suspension', 'La suspension coupe l acces sans supprimer les donnees',
      'quotas', 'Les limites sont verifiees cote serveur avant insertion',
      'audit', 'Toute operation du back-office est journalisee hors tenant'
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_save_plan(
  p_plan text, p_name text, p_price_minor bigint, p_trial_days integer,
  p_active boolean, p_sort_order integer, p_features jsonb DEFAULT '[]'::jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() OR NOT public.has_permission('platform.plans.manage') THEN
    RAISE EXCEPTION 'Permission platform.plans.manage requise' USING ERRCODE = '42501';
  END IF;
  IF p_plan IS NULL OR p_plan !~ '^[a-z_]+$' OR length(btrim(COALESCE(p_name, ''))) < 2
    OR p_price_minor IS NULL OR p_price_minor < 0
    OR p_trial_days IS NULL OR p_trial_days < 0 THEN
    RAISE EXCEPTION 'Formule invalide' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.plans (id, name, price_monthly_minor, trial_days, active, sort_order, features)
  VALUES (p_plan, btrim(p_name), p_price_minor, p_trial_days,
    COALESCE(p_active, true), COALESCE(p_sort_order, 0), COALESCE(p_features, '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, price_monthly_minor = EXCLUDED.price_monthly_minor,
    trial_days = EXCLUDED.trial_days, active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order, features = EXCLUDED.features,
    updated_at = now();
  INSERT INTO public.platform_audit_logs (actor_user_id, action, entity_type, entity_id, detail)
  VALUES (auth.uid(), 'plan.saved', 'plans', p_plan,
    jsonb_build_object('name', btrim(p_name), 'priceMinor', p_price_minor,
      'trialDays', p_trial_days, 'active', COALESCE(p_active, true)));
  RETURN p_plan;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_plan_limit(
  p_plan text, p_key text, p_value_int integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() OR NOT public.has_permission('platform.quotas.manage') THEN
    RAISE EXCEPTION 'Permission platform.quotas.manage requise' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key NOT IN ('stations','employees','washes_per_month')
    OR p_value_int IS NULL OR p_value_int < 0
    OR NOT EXISTS (SELECT 1 FROM public.plans WHERE id = p_plan) THEN
    RAISE EXCEPTION 'Limite de formule invalide' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.plan_limits (plan_id, key, value_int)
  VALUES (p_plan, p_key, p_value_int)
  ON CONFLICT (plan_id, key) DO UPDATE SET value_int = EXCLUDED.value_int;
  INSERT INTO public.platform_audit_logs (actor_user_id, action, entity_type, entity_id, detail)
  VALUES (auth.uid(), 'plan.limit', 'plan_limits', p_plan,
    jsonb_build_object('key', p_key, 'valueInt', p_value_int));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_company_subscription(
  p_company uuid, p_plan text, p_status text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text := COALESCE(p_status, 'active');
BEGIN
  IF NOT public.is_platform_admin() OR NOT public.has_permission('platform.companies.manage') THEN
    RAISE EXCEPTION 'Permission platform.companies.manage requise' USING ERRCODE = '42501';
  END IF;
  IF p_company IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company)
    OR NOT EXISTS (SELECT 1 FROM public.plans WHERE id = p_plan)
    OR v_status NOT IN ('trial','active','past_due','suspended','cancelled') THEN
    RAISE EXCEPTION 'Abonnement entreprise invalide' USING ERRCODE = '23514';
  END IF;
  UPDATE public.subscriptions SET plan_id = p_plan, status = v_status, updated_at = now()
  WHERE company_id = p_company;
  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (company_id, plan_id, status)
    VALUES (p_company, p_plan, v_status);
  END IF;
  INSERT INTO public.platform_audit_logs (actor_user_id, action, entity_type, entity_id, detail)
  VALUES (auth.uid(), 'company.subscription', 'companies', p_company::text,
    jsonb_build_object('planId', p_plan, 'status', v_status));
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_company_suspended(
  p_company uuid, p_suspended boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() OR NOT public.has_permission('platform.companies.manage') THEN
    RAISE EXCEPTION 'Permission platform.companies.manage requise' USING ERRCODE = '42501';
  END IF;
  IF p_company IS NULL OR p_suspended IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company) THEN
    RAISE EXCEPTION 'Entreprise ou etat de suspension invalide' USING ERRCODE = '23514';
  END IF;
  UPDATE public.companies SET suspended = p_suspended, updated_at = now()
  WHERE id = p_company;
  INSERT INTO public.platform_audit_logs (actor_user_id, action, entity_type, entity_id, detail)
  VALUES (auth.uid(), 'company.suspension', 'companies', p_company::text,
    jsonb_build_object('suspended', p_suspended));
END $$;
