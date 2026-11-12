-- 033 — Prompt 07 : coûts de consommation, attestation de période, TD-13.
-- Le résultat net n'est publié QUE si une attestation immuable certifie :
-- consommations valorisées, aucune dépense d'achat en double, commissions
-- validées. Les achats sont des acquisitions de stock, pas une charge directe.

CREATE OR REPLACE FUNCTION public.link_expense_to_purchase_order(
  p_expense_id uuid, p_order_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_e record; v_o record;
BEGIN
  IF NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Permission settings.manage requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Aucune entreprise rattachee' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_e FROM public.expenses
  WHERE id = p_expense_id AND company_id = v_company AND status = 'recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'Depense introuvable' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_o FROM public.purchase_orders
  WHERE id = p_order_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_e.station_id <> v_o.station_id OR NOT public.can_access_station(v_o.station_id) THEN
    RAISE EXCEPTION 'Rattachement hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_e.purchase_order_id IS NOT NULL AND v_e.purchase_order_id <> p_order_id THEN
    RAISE EXCEPTION 'Depense deja rattachee a une autre commande' USING ERRCODE = '23514';
  END IF;
  UPDATE public.expenses SET purchase_order_id = p_order_id, updated_at = clock_timestamp()
  WHERE id = p_expense_id AND company_id = v_company;
END $$;

CREATE OR REPLACE FUNCTION public.certify_profitability_period(
  p_start date, p_end date, p_attestation text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_attestation text := btrim(COALESCE(p_attestation, ''));
  v_ambiguous integer; v_unvalued integer; v_draft integer;
  v_revenue bigint; v_consumptions bigint; v_operating bigint;
  v_commissions bigint; v_fixed bigint; v_gross bigint; v_result bigint;
  v_movement_count integer; v_valued_consumptions integer;
BEGIN
  IF NOT (public.has_permission('reports.view') AND public.has_permission('settings.manage')) THEN
    RAISE EXCEPTION 'Permissions reports.view + settings.manage requises' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Certification impossible sans entreprise rattachee' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR length(v_attestation) < 15 THEN
    RAISE EXCEPTION 'Periode ou attestation invalide' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_cost_periods
    WHERE company_id = v_company AND start_date = p_start AND end_date = p_end) THEN
    RAISE EXCEPTION 'Periode deja certifiee : relevé immuable' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_ambiguous FROM public.expenses e
  LEFT JOIN public.expense_categories c ON c.id = e.category_id
  WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
    AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
    AND COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NULL;
  SELECT count(*) INTO v_unvalued FROM public.stock_movements m
  WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)
    AND m.created_at::date BETWEEN p_start AND p_end
    AND (
      (m.kind IN ('purchase_receipt', 'consumption') AND m.unit_cost_minor <= 0)
      OR (m.kind = 'inventory_adjustment' AND m.qty_delta > 0 AND m.unit_cost_minor <= 0)
    );
  SELECT count(*) INTO v_draft FROM public.commission_periods cp
  WHERE (cp.company_id = v_company OR v_admin) AND public.can_access_station(cp.station_id)
    AND cp.status = 'draft' AND cp.period_start <= p_end AND cp.period_end >= p_start;
  IF v_ambiguous > 0 OR v_unvalued > 0 OR v_draft > 0 THEN
    RAISE EXCEPTION 'Couts incomplets : achats non rattaches %, mouvements non valorises %, periodes brouillon %',
      v_ambiguous, v_unvalued, v_draft USING ERRCODE = '23514';
  END IF;
  SELECT
    COALESCE((SELECT SUM(w.total_minor) FROM public.washes w
      WHERE (w.company_id = v_company OR v_admin) AND public.can_access_station(w.station_id)
        AND w.deleted_at IS NULL AND w.status <> 'cancelled'
        AND w.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(-m.qty_delta * m.unit_cost_minor) FROM public.stock_movements m
      WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)
        AND m.kind = 'consumption' AND m.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)), 0),
    COALESCE((SELECT SUM(ec.amount_minor) FROM public.employee_commissions ec
      JOIN public.commission_periods cp ON cp.id = ec.period_id
      WHERE (ec.company_id = v_company OR v_admin) AND public.can_access_station(ec.station_id)
        AND cp.status IN ('validated', 'paid')
        AND ec.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)
        AND lower(COALESCE(c.name, '')) IN
          ('loyer', 'salaires', 'eau', 'electricite', 'électricité', 'assurance', 'abonnement')), 0)
  INTO v_revenue, v_consumptions, v_operating, v_commissions, v_fixed;
  SELECT count(*) INTO v_movement_count FROM public.stock_movements m
  WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)
    AND m.created_at::date BETWEEN p_start AND p_end;
  SELECT count(*) INTO v_valued_consumptions FROM public.stock_movements m
  WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)
    AND m.kind = 'consumption' AND m.unit_cost_minor > 0
    AND m.created_at::date BETWEEN p_start AND p_end;
  v_gross := v_revenue - v_consumptions;
  v_result := v_gross - v_operating - v_commissions;
  INSERT INTO public.finance_cost_periods (company_id, start_date, end_date, revenue_minor,
    consumption_cost_minor, operating_expense_minor, commission_cost_minor, fixed_cost_minor,
    gross_margin_minor, result_minor, stock_movement_count, valued_consumptions,
    attestation, certified_by)
  VALUES (v_company, p_start, p_end, v_revenue, v_consumptions, v_operating,
    v_commissions, v_fixed, v_gross, v_result, v_movement_count, v_valued_consumptions,
    v_attestation, auth.uid());
  RETURN jsonb_build_object(
    'certified', true, 'periodStart', p_start::text, 'periodEnd', p_end::text,
    'revenue', v_revenue, 'consumptions', v_consumptions,
    'operatingExpenses', v_operating, 'commissions', v_commissions,
    'grossMargin', v_gross, 'result', v_result, 'costsMissing', false,
    'label', 'Couts certifies : resultat net calculable'
  );
END $$;

CREATE OR REPLACE FUNCTION public.my_profitability(
  p_start date DEFAULT (date_trunc('month', now()))::date,
  p_end date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
  v_revenue bigint; v_collected bigint; v_receivables bigint; v_expenses bigint;
  v_purchases bigint; v_consumptions bigint; v_operating bigint;
  v_commissions bigint; v_fixed bigint; v_partial bigint;
  v_cert record; v_certified boolean := false;
  v_cert_revenue bigint; v_cert_consumptions bigint; v_cert_operating bigint;
  v_cert_commissions bigint; v_cert_fixed bigint;
  v_cert_gross bigint; v_cert_result bigint;
  v_cert_at text; v_attestation text := '';
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
  SELECT * INTO v_cert FROM public.finance_cost_periods
  WHERE company_id = v_company AND start_date = p_start AND end_date = p_end;
  IF FOUND THEN
    v_certified := true;
    v_cert_revenue := v_cert.revenue_minor;
    v_cert_consumptions := v_cert.consumption_cost_minor;
    v_cert_operating := v_cert.operating_expense_minor;
    v_cert_commissions := v_cert.commission_cost_minor;
    v_cert_fixed := v_cert.fixed_cost_minor;
    v_cert_gross := v_cert.gross_margin_minor;
    v_cert_result := v_cert.result_minor;
    v_cert_at := v_cert.certified_at::text;
    v_attestation := v_cert.attestation;
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
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)), 0),
    COALESCE((SELECT SUM(ec.amount_minor) FROM public.employee_commissions ec
      JOIN public.commission_periods cp ON cp.id = ec.period_id
      WHERE (ec.company_id = v_company OR v_admin) AND public.can_access_station(ec.station_id)
        AND cp.status IN ('validated', 'paid')
        AND ec.created_at::date BETWEEN p_start AND p_end), 0),
    COALESCE((SELECT SUM(e.amount_minor) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)
        AND e.status = 'recorded' AND e.spent_at BETWEEN p_start AND p_end
        AND NOT (COALESCE(c.is_stock_purchase, false) AND e.purchase_order_id IS NOT NULL)
        AND lower(COALESCE(c.name, '')) IN
          ('loyer', 'salaires', 'eau', 'electricite', 'électricité', 'assurance', 'abonnement')), 0)
  INTO v_revenue, v_collected, v_receivables, v_expenses, v_purchases,
       v_consumptions, v_operating, v_commissions, v_fixed;
  v_partial := v_collected - v_expenses;
  IF v_certified THEN
    RETURN jsonb_build_object(
      'periodStart', p_start::text, 'periodEnd', p_end::text,
      'revenue', v_cert_revenue, 'collected', v_collected, 'receivables', v_receivables,
      'expenses', v_expenses, 'purchases', v_purchases,
      'consumptions', v_cert_consumptions, 'operatingExpenses', v_cert_operating,
      'commissions', v_cert_commissions, 'fixedCosts', v_cert_fixed,
      'partialBalance', v_partial,
      'grossMargin', v_cert_gross, 'result', v_cert_result,
      'costsMissing', false, 'certified', true,
      'label', 'Couts certifies : resultat net calculable',
      'missing', '[]'::jsonb, 'certifiedAt', v_cert_at, 'attestation', v_attestation,
      'definitions', jsonb_build_object(
        'revenue', 'Chiffre d affaires certifie : total des fiches non annulees de la periode',
        'collected', 'Encaissements nets : paiements moins annulations',
        'receivables', 'Creances : total moins encaisse des fiches non annulees',
        'purchases', 'Acquisitions de stock : jamais une charge de periode',
        'consumptions', 'Cout des produits consommes, valorise au cout moyen de reception',
        'operatingExpenses', 'Charges d exploitation hors achats de stock deja rattaches',
        'partialBalance', 'Solde partiel : encaisse moins depenses constatees ; PAS un benefice net',
        'grossMargin', 'Marge brute certifiee : CA moins consommations valorisees',
        'result', 'Resultat net certifie : marge brute moins charges d exploitation et commissions'
      )
    );
  END IF;
  RETURN jsonb_build_object(
    'periodStart', p_start::text, 'periodEnd', p_end::text,
    'revenue', v_revenue, 'collected', v_collected, 'receivables', v_receivables,
    'expenses', v_expenses, 'purchases', v_purchases, 'consumptions', v_consumptions,
    'operatingExpenses', v_operating, 'commissions', v_commissions, 'fixedCosts', v_fixed,
    'partialBalance', v_partial,
    'grossMargin', NULL, 'result', NULL,
    'costsMissing', true, 'certified', false,
    'label', 'Couts manquants : resultat net non calculable avant P07',
    'missing', jsonb_build_array(
      'Consommations valorisees par lavage (P07)',
      'Attestation des couts de la periode',
      'Achats de stock non doublement comptes',
      'Commissions de periode non validee'
    ), 'certifiedAt', NULL, 'attestation', NULL,
    'definitions', jsonb_build_object(
      'revenue', 'Chiffre d affaires : total des fiches non annulees de la periode',
      'collected', 'Encaissements nets : paiements moins annulations',
      'receivables', 'Creances : total moins encaisse des fiches non annulees',
      'purchases', 'Acquisitions de stock : jamais une charge de periode',
      'consumptions', 'Cout des produits consommes, valorise au cout moyen de reception',
      'operatingExpenses', 'Charges d exploitation hors achats de stock deja rattaches',
      'partialBalance', 'Solde partiel : encaisse moins depenses constatees ; PAS un benefice net'
    )
  );
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('link_expense_to_purchase_order','certify_profitability_period','my_profitability')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
