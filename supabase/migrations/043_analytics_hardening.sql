-- 043 — Prompt 09 : durcissement des permissions et des écritures directes.
-- 8 RPC utilisateur exposées à authenticated ; 4 helpers internes révoqués.
-- Aucun grant anon, aucune clé service, aucune donnée de démonstration.
REVOKE ALL ON FUNCTION
  public.current_plan_limit(uuid, text),
  public.subscription_usage_snapshot(uuid),
  public.assert_subscription_limit(uuid, text, integer),
  public.enforce_subscription_limit()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.refresh_subscription_usage(date),
  public.my_analytics_board(date, date, date, date),
  public.my_subscription_usage(date),
  public.my_platform_board(),
  public.admin_save_plan(text, text, bigint, integer, boolean, integer, jsonb),
  public.admin_set_plan_limit(text, text, integer),
  public.admin_set_company_subscription(uuid, text, text),
  public.admin_set_company_suspended(uuid, boolean)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.refresh_subscription_usage(date),
  public.my_analytics_board(date, date, date, date),
  public.my_subscription_usage(date),
  public.my_platform_board(),
  public.admin_save_plan(text, text, bigint, integer, boolean, integer, jsonb),
  public.admin_set_plan_limit(text, text, integer),
  public.admin_set_company_subscription(uuid, text, text),
  public.admin_set_company_suspended(uuid, boolean)
TO authenticated;

REVOKE ALL ON public.v_station_daily_activity, public.v_company_quota_usage FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.v_station_daily_activity, public.v_company_quota_usage FROM authenticated;
GRANT SELECT ON public.v_station_daily_activity, public.v_company_quota_usage TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON
  public.plans, public.plan_limits, public.subscriptions,
  public.subscription_usage, public.companies, public.platform_audit_logs
FROM authenticated;
