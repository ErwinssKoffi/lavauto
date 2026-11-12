-- 040 — Prompt 09 : quotas serveur, snapshot d'usage et garde à l'insertion.
-- Les compteurs sont dérivés des tables réelles ; aucune donnée fabriquée.
-- La limite est lue depuis plan_limits via l'abonnement actif de l'entreprise.
CREATE OR REPLACE FUNCTION public.current_plan_limit(p_company uuid, p_limit_key text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pl.value_int
  FROM public.subscriptions s
  JOIN public.plan_limits pl ON pl.plan_id = s.plan_id AND pl.key = p_limit_key
  WHERE s.company_id = p_company AND s.status IN ('trial','active','past_due')
  ORDER BY s.started_at DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.subscription_usage_snapshot(p_company uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'stations', (SELECT count(*) FROM public.stations st
      WHERE st.company_id = p_company AND st.deleted_at IS NULL),
    'employees', (SELECT count(*) FROM public.user_profiles u
      WHERE u.company_id = p_company AND u.active AND u.deleted_at IS NULL),
    'washes', (SELECT count(*) FROM public.washes w
      WHERE w.company_id = p_company AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at >= date_trunc('month', now()))
  )
$$;

CREATE OR REPLACE FUNCTION public.assert_subscription_limit(
  p_company uuid, p_limit_key text, p_increment integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_limit integer;
  v_used bigint;
BEGIN
  IF p_company IS NULL OR p_increment < 1 THEN
    RAISE EXCEPTION 'Parametres de quota invalides' USING ERRCODE = '23514';
  END IF;
  SELECT public.current_plan_limit(p_company, p_limit_key) INTO v_limit;
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'unlimited', true,
      'limit', NULL, 'used', NULL, 'remaining', NULL);
  END IF;
  IF p_limit_key = 'stations' THEN
    SELECT count(*) INTO v_used FROM public.stations st
    WHERE st.company_id = p_company AND st.deleted_at IS NULL;
  ELSIF p_limit_key = 'employees' THEN
    SELECT count(*) INTO v_used FROM public.user_profiles u
    WHERE u.company_id = p_company AND u.active AND u.deleted_at IS NULL;
  ELSIF p_limit_key = 'washes_per_month' THEN
    SELECT count(*) INTO v_used FROM public.washes w
    WHERE w.company_id = p_company AND w.deleted_at IS NULL AND w.status <> 'cancelled'
      AND w.created_at >= date_trunc('month', now());
  ELSE
    RAISE EXCEPTION 'Cle de quota inconnue : %', p_limit_key USING ERRCODE = '23514';
  END IF;
  IF v_used + p_increment > v_limit THEN
    RAISE EXCEPTION 'Quota % atteint : % deja utilises sur %', p_limit_key, v_used, v_limit
      USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('allowed', true, 'unlimited', false,
    'limit', v_limit, 'used', v_used, 'remaining', v_limit - v_used - p_increment);
END $$;

CREATE OR REPLACE FUNCTION public.enforce_subscription_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_limit_key text;
BEGIN
  IF TG_TABLE_NAME = 'stations' THEN
    v_company := NEW.company_id; v_limit_key := 'stations';
  ELSIF TG_TABLE_NAME = 'user_profiles' THEN
    v_company := NEW.company_id; v_limit_key := 'employees';
  ELSIF TG_TABLE_NAME = 'washes' THEN
    v_company := NEW.company_id; v_limit_key := 'washes_per_month';
  ELSE
    RETURN NEW;
  END IF;
  IF v_company IS NULL THEN RETURN NEW; END IF;
  PERFORM public.assert_subscription_limit(v_company, v_limit_key, 1);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quota_stations ON public.stations;
CREATE TRIGGER trg_quota_stations BEFORE INSERT ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();
DROP TRIGGER IF EXISTS trg_quota_profiles ON public.user_profiles;
CREATE TRIGGER trg_quota_profiles BEFORE INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();
DROP TRIGGER IF EXISTS trg_quota_washes ON public.washes;
CREATE TRIGGER trg_quota_washes BEFORE INSERT ON public.washes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_limit();

CREATE OR REPLACE FUNCTION public.refresh_subscription_usage(
  p_period_start date DEFAULT (date_trunc('month', now()))::date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_rows integer;
BEGIN
  IF NOT (v_admin OR public.has_permission('subscription.manage')
    OR public.has_permission('platform.quotas.manage')) THEN
    RAISE EXCEPTION 'Permission subscription.manage ou platform.quotas.manage requise'
      USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.subscription_usage
    (company_id, station_id, period_start, metric_key, value_int, updated_at)
  SELECT c.id, st.id, p_period_start, m.metric_key, m.value_int::integer, now()
  FROM public.companies c
  JOIN public.stations st ON st.company_id = c.id AND st.deleted_at IS NULL
  CROSS JOIN LATERAL (VALUES
    ('stations'::text, (SELECT count(*) FROM public.stations s2
      WHERE s2.company_id = c.id AND s2.deleted_at IS NULL)),
    ('employees'::text, (SELECT count(*) FROM public.user_profiles u
      WHERE u.company_id = c.id AND u.active AND u.deleted_at IS NULL)),
    ('washes'::text, (SELECT count(*) FROM public.washes w
      WHERE w.company_id = c.id AND w.station_id = st.id AND w.deleted_at IS NULL
        AND w.status <> 'cancelled'
        AND w.created_at::date >= p_period_start
        AND w.created_at::date < (p_period_start + interval '1 month')::date))
  ) AS m(metric_key, value_int)
  WHERE v_admin OR c.id = v_company
  ON CONFLICT (company_id, station_id, period_start, metric_key)
  DO UPDATE SET value_int = EXCLUDED.value_int, updated_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('periodStart', p_period_start::text, 'rows', v_rows,
    'rule', 'Compteurs derives des donnees reelles, aucune donnee fabriquee');
END $$;
