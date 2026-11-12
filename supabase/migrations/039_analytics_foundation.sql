-- 039 — Prompt 09 : fondation analytics additive (aucune réécriture 001–038).
-- Vues d'agrégation en security_invoker, index de période, permissions et RBAC.
-- Aucune donnée de démonstration, aucun tarif modifié, aucun compte créé.
INSERT INTO public.permissions (key, label_fr, domain)
SELECT v.key, v.label, split_part(v.key, '.', 1) FROM (VALUES
  ('analytics.view', 'Consulter les analytics'),
  ('analytics.compare', 'Comparer les périodes'),
  ('platform.plans.manage', 'Administrer les formules'),
  ('platform.companies.manage', 'Administrer les entreprises et abonnements'),
  ('platform.quotas.manage', 'Administrer les quotas')
) AS v(key, label) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.key FROM public.roles r CROSS JOIN public.permissions p
WHERE r.company_id IS NULL AND (
  (r.key IN ('owner','manager') AND p.key IN ('analytics.view','analytics.compare'))
  OR (r.key = 'cashier' AND p.key = 'analytics.view')
  OR (r.key = 'super_admin' AND p.key IN
    ('analytics.view','analytics.compare','platform.plans.manage',
     'platform.companies.manage','platform.quotas.manage'))
) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_washes_analytics
  ON public.washes (company_id, station_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_payments_analytics
  ON public.payments (company_id, station_id, created_at);
CREATE INDEX IF NOT EXISTS ix_expenses_analytics
  ON public.expenses (company_id, station_id, spent_at) WHERE status = 'recorded';
CREATE INDEX IF NOT EXISTS ix_platform_audit_created
  ON public.platform_audit_logs (created_at DESC);

-- security_invoker = true : la vue hérite des politiques RLS de l'appelant,
-- jamais des privilèges de son propriétaire. Aucun accès anon.
CREATE VIEW public.v_station_daily_activity
WITH (security_invoker = true) AS
SELECT w.company_id, w.station_id, w.created_at::date AS activity_date,
  count(*) FILTER (WHERE w.status <> 'cancelled') AS wash_count,
  COALESCE(SUM(w.total_minor) FILTER (WHERE w.status <> 'cancelled'), 0) AS revenue_minor
FROM public.washes w
WHERE w.deleted_at IS NULL
GROUP BY w.company_id, w.station_id, w.created_at::date;

CREATE VIEW public.v_company_quota_usage
WITH (security_invoker = true) AS
SELECT c.id AS company_id, s.plan_id,
  (SELECT count(*) FROM public.stations st
    WHERE st.company_id = c.id AND st.deleted_at IS NULL) AS stations_used,
  (SELECT count(*) FROM public.user_profiles u
    WHERE u.company_id = c.id AND u.active AND u.deleted_at IS NULL) AS employees_used,
  (SELECT count(*) FROM public.washes w
    WHERE w.company_id = c.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
      AND w.created_at >= date_trunc('month', now())) AS washes_month_used
FROM public.companies c
JOIN public.subscriptions s ON s.company_id = c.id
  AND s.status IN ('trial','active','past_due');

REVOKE ALL ON public.v_station_daily_activity, public.v_company_quota_usage FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.v_station_daily_activity, public.v_company_quota_usage FROM authenticated;
GRANT SELECT ON public.v_station_daily_activity, public.v_company_quota_usage TO authenticated;
