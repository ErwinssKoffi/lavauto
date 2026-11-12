-- 041 — Prompt 09 : board analytics STABLE SECURITY DEFINER.
-- Les définitions de `my_profitability()` restent la source unique : aucun
-- résultat net distribué par station, aucune donnée ou tendance fabriquée.
CREATE OR REPLACE FUNCTION public.my_analytics_board(
  p_start date DEFAULT (date_trunc('month', now()))::date,
  p_end date DEFAULT current_date,
  p_compare_start date DEFAULT NULL,
  p_compare_end date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_period jsonb;
  v_compare jsonb := NULL;
  v_defs jsonb;
  v_stations jsonb := '[]'::jsonb;
  v_rankings jsonb := '[]'::jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_stats jsonb;
  v_delta bigint;
BEGIN
  IF v_user IS NULL OR NOT (public.has_permission('analytics.view')
    AND public.has_permission('reports.view')) THEN
    RAISE EXCEPTION 'Permissions analytics.view et reports.view requises' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_end - p_start > 92 THEN
    RAISE EXCEPTION 'Periode invalide : 92 jours maximum' USING ERRCODE = '23514';
  END IF;
  IF (p_compare_start IS NULL AND p_compare_end IS NOT NULL)
    OR (p_compare_start IS NOT NULL AND p_compare_end IS NULL) THEN
    RAISE EXCEPTION 'Periode de comparaison incomplete' USING ERRCODE = '23514';
  END IF;
  IF p_compare_start IS NOT NULL AND p_compare_end < p_compare_start THEN
    RAISE EXCEPTION 'Periode de comparaison inversee' USING ERRCODE = '23514';
  END IF;

  v_period := public.my_profitability(p_start, p_end);
  v_defs := COALESCE(v_period->'definitions', '{}'::jsonb);
  IF p_compare_start IS NOT NULL THEN
    v_compare := public.my_profitability(p_compare_start, p_compare_end);
    v_delta := COALESCE((v_period->>'revenue')::bigint, 0)
      - COALESCE((v_compare->>'revenue')::bigint, 0);
  END IF;

  WITH station_metrics AS (
    SELECT s.id, s.name, s.city,
      COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
        WHERE w.station_id = s.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at::date BETWEEN p_start AND p_end), 0) AS revenue,
      COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
        WHERE p.station_id = s.id AND p.created_at::date BETWEEN p_start AND p_end), 0)
      - COALESCE((SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
        WHERE pc.station_id = s.id AND pc.created_at::date BETWEEN p_start AND p_end), 0) AS collected,
      COALESCE((SELECT SUM(GREATEST(w.total_minor - w.paid_minor, 0)) FROM public.washes w
        WHERE w.station_id = s.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at::date BETWEEN p_start AND p_end), 0) AS receivables,
      COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
        WHERE e.station_id = s.id AND e.status = 'recorded'
          AND e.spent_at BETWEEN p_start AND p_end), 0) AS expenses,
      COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
        WHERE m.station_id = s.id AND m.kind = 'consumption'
          AND m.created_at::date BETWEEN p_start AND p_end), 0) AS consumptions,
      COALESCE((SELECT count(*) FROM public.washes w
        WHERE w.station_id = s.id AND w.deleted_at IS NULL AND w.status <> 'cancelled'
          AND w.created_at::date BETWEEN p_start AND p_end), 0) AS wash_count
    FROM public.stations s
    WHERE (v_admin OR s.company_id = v_company)
      AND s.deleted_at IS NULL
      AND (v_admin OR public.can_access_station(s.id))
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY revenue DESC, name) AS rank FROM station_metrics
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'stationId', r.id, 'name', r.name, 'city', r.city,
      'revenue', r.revenue, 'collected', r.collected, 'receivables', r.receivables,
      'expenses', r.expenses, 'consumptions', r.consumptions,
      'partialBalance', r.collected - r.expenses, 'washCount', r.wash_count,
      'grossMargin', NULL, 'result', NULL, 'certified', false
    ) ORDER BY r.rank), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'rank', r.rank, 'stationId', r.id, 'name', r.name,
      'revenue', r.revenue, 'washCount', r.wash_count, 'collected', r.collected
    ) ORDER BY r.rank), '[]'::jsonb)
  INTO v_stations, v_rankings
  FROM ranked r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', d.day::date::text,
    'revenue', COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE (v_admin OR w.company_id = v_company) AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date = d.day::date), 0),
    'collected', COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
      WHERE (v_admin OR p.company_id = v_company) AND public.can_access_station(p.station_id)
        AND p.created_at::date = d.day::date), 0)
      - COALESCE((SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
      WHERE (v_admin OR pc.company_id = v_company) AND public.can_access_station(pc.station_id)
        AND pc.created_at::date = d.day::date), 0),
    'expenses', COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      WHERE (v_admin OR e.company_id = v_company) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at = d.day::date), 0),
    'washCount', COALESCE((SELECT count(*) FROM public.washes w
      WHERE (v_admin OR w.company_id = v_company) AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date = d.day::date), 0)
  ) ORDER BY d.day), '[]'::jsonb)
  INTO v_trend
  FROM generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') AS d(day);

  v_stats := jsonb_build_object(
    'stations', jsonb_array_length(v_stations),
    'revenue', COALESCE((v_period->>'revenue')::bigint, 0),
    'collected', COALESCE((v_period->>'collected')::bigint, 0),
    'receivables', COALESCE((v_period->>'receivables')::bigint, 0),
    'partialBalance', COALESCE((v_period->>'partialBalance')::bigint, 0),
    'washCount', COALESCE((SELECT SUM((x->>'washCount')::integer)
      FROM jsonb_array_elements(v_trend) AS x), 0),
    'certified', COALESCE((v_period->>'certified')::boolean, false),
    'compareDelta', v_delta
  );

  RETURN jsonb_build_object(
    'periodStart', p_start::text, 'periodEnd', p_end::text,
    'compareStart', p_compare_start::text, 'compareEnd', p_compare_end::text,
    'period', v_period, 'compare', v_compare, 'compareDelta', v_delta,
    'stations', v_stations, 'rankings', v_rankings, 'trend', v_trend,
    'definitions', v_defs, 'stats', v_stats,
    'rules', jsonb_build_object(
      'netResult', 'Aucun resultat net sans attestation de periode certifiee',
      'comparison', 'Comparaison avec les memes definitions metier',
      'stations', 'Classement par chiffre d affaires, jamais par benefice net',
      'pricing', 'Tarifs 0 / 15000 / 35000 FCFA : hypotheses commerciales administrables'
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.my_subscription_usage(
  p_period_start date DEFAULT (date_trunc('month', now()))::date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_usage jsonb := '{}'::jsonb;
  v_limits jsonb := '{}'::jsonb;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (v_admin OR public.has_permission('analytics.view')
    OR public.has_permission('subscription.manage')) THEN
    RAISE EXCEPTION 'Permission analytics.view ou subscription.manage requise'
      USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF NOT v_admin THEN
    v_usage := public.subscription_usage_snapshot(v_company);
    v_limits := jsonb_build_object(
      'stations', public.current_plan_limit(v_company, 'stations'),
      'employees', public.current_plan_limit(v_company, 'employees'),
      'washesPerMonth', public.current_plan_limit(v_company, 'washes_per_month')
    );
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'companyId', u.company_id, 'stationId', u.station_id,
    'periodStart', u.period_start::text, 'metricKey', u.metric_key,
    'valueInt', u.value_int, 'updatedAt', u.updated_at::text
  ) ORDER BY u.period_start DESC, u.metric_key), '[]'::jsonb)
  INTO v_rows
  FROM public.subscription_usage u
  WHERE u.period_start = p_period_start
    AND (v_admin OR u.company_id = v_company)
    AND (v_admin OR public.can_access_station(u.station_id));
  RETURN jsonb_build_object(
    'periodStart', p_period_start::text, 'usage', v_usage, 'limits', v_limits,
    'rows', v_rows,
    'rules', jsonb_build_object('quota', 'Limite lue cote serveur, jamais envoyee par le navigateur')
  );
END $$;
