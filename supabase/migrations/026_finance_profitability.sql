-- 026 — Prompt 06 : rapport de rentabilité honnête, sans faux bénéfice net.
-- P07 fournira les consommations/achats valorisés ; ici l'état est explicite.

CREATE OR REPLACE FUNCTION public.payment_method_ui_key(p_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_key
    WHEN 'cash' THEN 'especes'
    WHEN 'mobile_money' THEN 'mobile_money'
    WHEN 'card' THEN 'carte'
    WHEN 'transfer' THEN 'virement'
    ELSE 'mobile_money'
  END
$$;

CREATE OR REPLACE FUNCTION public.my_profitability(
  p_start date DEFAULT (date_trunc('month', now()))::date,
  p_end date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_revenue bigint; v_collected bigint; v_receivables bigint; v_expenses bigint;
  v_purchases bigint; v_consumptions bigint; v_commissions bigint; v_fixed bigint;
  v_result jsonb;
BEGIN
  IF NOT public.has_permission('reports.view') THEN
    RAISE EXCEPTION 'Permission reports.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'Periode invalide' USING ERRCODE = '23514';
  END IF;

  SELECT
    COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE (w.company_id = v_company OR v_admin) AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(p.amount_minor) FROM public.payments p
      WHERE (p.company_id = v_company OR v_admin) AND public.can_access_station(p.station_id)
        AND p.created_at::date BETWEEN p_start AND p_end), 0)
      - COALESCE((SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
        WHERE (pc.company_id = v_company OR v_admin) AND public.can_access_station(pc.station_id)
          AND pc.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(GREATEST(w.total_minor - w.paid_minor, 0)) FROM public.washes w
      WHERE (w.company_id = v_company OR v_admin) AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
      WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)
        AND m.kind = 'purchase_receipt' AND m.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
      WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)
        AND m.kind = 'consumption' AND m.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(ec.amount_minor) FROM public.employee_commissions ec
      JOIN public.commission_periods cp ON cp.id = ec.period_id
      WHERE (ec.company_id = v_company OR v_admin) AND public.can_access_station(ec.station_id)
        AND cp.status IN ('validated', 'paid')
        AND ec.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND lower(COALESCE(c.name, '')) IN
          ('loyer', 'salaires', 'eau', 'electricite', 'électricité', 'assurance', 'abonnement')), 0)
  INTO v_revenue, v_collected, v_receivables, v_expenses,
       v_purchases, v_consumptions, v_commissions, v_fixed;

  v_result := jsonb_build_object(
    'periodStart', p_start::text,
    'periodEnd', p_end::text,
    'revenue', v_revenue,
    'collected', v_collected,
    'receivables', v_receivables,
    'expenses', v_expenses,
    'purchases', v_purchases,
    'consumptions', v_consumptions,
    'commissions', v_commissions,
    'fixedCosts', v_fixed,
    'partialBalance', v_collected - v_expenses,
    'grossMargin', NULL,
    'result', NULL,
    'costsMissing', true,
    'label', 'Couts manquants : resultat net non calculable avant P07',
    'missing', jsonb_build_array(
      'Consommations de produits (P07)',
      'Achats valorises (P07)',
      'Charges fixes completes',
      'Commissions de periode non validee'
    ),
    'definitions', jsonb_build_object(
      'revenue', 'Chiffre d affaires : total des fiches non annulees de la periode',
      'collected', 'Encaissements nets : paiements moins annulations',
      'receivables', 'Creances : total moins encaisse des fiches non annulees',
      'partialBalance', 'Solde partiel : encaisse moins depenses constatees ; PAS un benefice net'
    )
  );
  RETURN v_result;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('my_profitability')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
