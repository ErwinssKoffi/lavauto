-- 044 — Prompt 09 : correctif additif du snapshot d'usage.
-- La version 040 contenait une référence erronée à p_company au lieu de c.id
-- dans le comptage des employés. Aucune table, aucune donnée, aucun fournisseur.
-- Le correctif remplace uniquement la fonction, sans réappliquer 039–043.
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

REVOKE ALL ON FUNCTION public.refresh_subscription_usage(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_subscription_usage(date) TO authenticated;
