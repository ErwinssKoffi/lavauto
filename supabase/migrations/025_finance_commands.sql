-- 025 — Prompt 06 : commandes finance (caisse, dépenses, annulations,
-- commissions figées, rapprochement par canal). Aucune écriture directe.

CREATE OR REPLACE FUNCTION public.open_cash_session(
  p_station_id uuid, p_opening_float_minor bigint DEFAULT 0, p_number text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_number text; v_session uuid;
BEGIN
  IF NOT public.has_permission('cash.open') THEN
    RAISE EXCEPTION 'Permission cash.open requise' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Station introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE station_id = p_station_id AND company_id = v_company AND status = 'open') THEN
    RAISE EXCEPTION 'Une caisse est deja ouverte' USING ERRCODE = '23514';
  END IF;
  v_number := COALESCE(NULLIF(btrim(COALESCE(p_number, '')), ''),
    'C-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 8));
  INSERT INTO public.cash_sessions (company_id, station_id, number, opened_by,
    opening_float_minor, status)
  VALUES (v_company, p_station_id, v_number, auth.uid(),
    GREATEST(0, COALESCE(p_opening_float_minor, 0)), 'open')
  RETURNING id INTO v_session;
  RETURN v_session;
END $$;

CREATE OR REPLACE FUNCTION public.record_expense_by_key(
  p_station_id uuid, p_amount_minor bigint, p_category_name text, p_reason text,
  p_supplier text DEFAULT '', p_spent_at date DEFAULT current_date,
  p_method_key text DEFAULT 'cash', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_cat text := btrim(COALESCE(p_category_name, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_category uuid; v_method uuid; v_method_row record; v_session uuid; v_expense uuid;
BEGIN
  IF NOT public.has_permission('expenses.create') THEN
    RAISE EXCEPTION 'Permission expenses.create requise' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR length(v_cat) < 2 OR length(v_reason) < 2 THEN
    RAISE EXCEPTION 'Depense invalide' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL)
    OR NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_expense FROM public.expenses
      WHERE company_id = v_company AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_expense; END IF;
  END IF;
  INSERT INTO public.expense_categories (company_id, station_id, name, active)
  VALUES (v_company, p_station_id, v_cat, true)
  ON CONFLICT (station_id, lower(name)) DO UPDATE SET active = true
  RETURNING id INTO v_category;
  v_method := public.ensure_payment_method(v_company, p_station_id, p_method_key);
  SELECT * INTO v_method_row FROM public.payment_methods WHERE id = v_method;
  IF v_method_row.affects_cash THEN
    SELECT id INTO v_session FROM public.cash_sessions
      WHERE station_id = p_station_id AND company_id = v_company AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Caisse fermee' USING ERRCODE = '23514'; END IF;
  END IF;
  INSERT INTO public.expenses (company_id, station_id, amount_minor, category_id,
    reason, supplier, spent_at, payment_method_id, cash_session_id, status,
    idempotency_key, created_by)
  VALUES (v_company, p_station_id, p_amount_minor, v_category, v_reason,
    btrim(COALESCE(p_supplier, '')), COALESCE(p_spent_at, current_date), v_method,
    v_session, 'recorded', p_idempotency_key, auth.uid())
  RETURNING id INTO v_expense;
  IF v_method_row.affects_cash THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, expense_id, reference, idempotency_key, created_by)
    VALUES (v_company, p_station_id, v_session, 'expense_out', -p_amount_minor,
      v_method, v_expense, v_cat,
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'expense:' || p_idempotency_key END,
      auth.uid());
  END IF;
  RETURN v_expense;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_expense(
  p_expense_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_e record;
BEGIN
  IF NOT public.has_permission('expenses.cancel') THEN
    RAISE EXCEPTION 'Permission expenses.cancel requise' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motif d annulation requis' USING ERRCODE = '23514';
  END IF;
  SELECT e.*, pm.affects_cash, pm.id AS method_id INTO v_e
  FROM public.expenses e
  LEFT JOIN public.payment_methods pm ON pm.id = e.payment_method_id
  WHERE e.id = p_expense_id AND e.company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Depense introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_e.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_e.status = 'cancelled' THEN
    RAISE EXCEPTION 'Depense deja annulee' USING ERRCODE = '23514';
  END IF;
  UPDATE public.expenses SET status = 'cancelled', cancel_reason = btrim(p_reason),
    updated_at = now() WHERE id = p_expense_id;
  IF COALESCE(v_e.affects_cash, false) AND v_e.cash_session_id IS NOT NULL THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, expense_id, reference, idempotency_key, created_by)
    VALUES (v_company, v_e.station_id, v_e.cash_session_id, 'adjustment', v_e.amount_minor,
      v_e.method_id, v_e.id, 'Annulation depense',
      'cancel-expense:' || p_expense_id, auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_payment(
  p_payment_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_p record; v_session uuid;
BEGIN
  IF NOT public.has_permission('payments.cancel') THEN
    RAISE EXCEPTION 'Permission payments.cancel requise' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motif d annulation requis' USING ERRCODE = '23514';
  END IF;
  SELECT p.*, pm.affects_cash, pm.id AS method_id INTO v_p
  FROM public.payments p
  LEFT JOIN public.payment_methods pm ON pm.id = p.payment_method_id
  WHERE p.id = p_payment_id AND p.company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_p.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_cancellations
    WHERE payment_id = p_payment_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Paiement deja annule' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.payment_cancellations (company_id, station_id, payment_id,
    amount_minor, reason, cancelled_by, created_at)
  VALUES (v_company, v_p.station_id, p_payment_id, v_p.amount_minor,
    btrim(p_reason), auth.uid(), now());
  UPDATE public.washes SET paid_minor = GREATEST(0, paid_minor - v_p.amount_minor),
    updated_at = now() WHERE id = v_p.wash_id AND company_id = v_company;
  IF COALESCE(v_p.affects_cash, false) THEN
    SELECT cash_session_id INTO v_session FROM public.cash_movements
      WHERE payment_id = p_payment_id AND kind = 'payment_in' LIMIT 1;
    IF v_session IS NOT NULL THEN
      INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
        amount_minor, payment_method_id, payment_id, reference, idempotency_key, created_by)
      VALUES (v_company, v_p.station_id, v_session, 'adjustment', -v_p.amount_minor,
        v_p.method_id, p_payment_id, 'Annulation encaissement',
        'cancel-payment:' || p_payment_id, auth.uid());
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_commission_period(
  p_station_id uuid, p_start date, p_end date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_period uuid; v_status text;
BEGIN
  IF NOT public.has_permission('commissions.validate') THEN
    RAISE EXCEPTION 'Permission commissions.validate requise' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'Periode invalide' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stations s
    WHERE s.id = p_station_id AND s.company_id = v_company AND s.deleted_at IS NULL)
    OR NOT public.can_access_station(p_station_id) THEN
    RAISE EXCEPTION 'Station inaccessible' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.commission_periods (company_id, station_id, period_start, period_end, status)
  VALUES (v_company, p_station_id, p_start, p_end, 'draft')
  ON CONFLICT (station_id, period_start, period_end) DO NOTHING
  RETURNING id INTO v_period;
  IF v_period IS NULL THEN
    SELECT id, status INTO v_period, v_status FROM public.commission_periods
      WHERE station_id = p_station_id AND company_id = v_company
        AND period_start = p_start AND period_end = p_end;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'Periode figee : non recalculable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN v_period;
END $$;

CREATE OR REPLACE FUNCTION public.generate_commission_lines(
  p_period_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_period record;
BEGIN
  IF NOT public.has_permission('commissions.validate') THEN
    RAISE EXCEPTION 'Permission commissions.validate requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_period FROM public.commission_periods
    WHERE id = p_period_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periode introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_period.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_period.status <> 'draft' THEN
    RAISE EXCEPTION 'Periode figee : non recalculable' USING ERRCODE = '55000';
  END IF;
  DELETE FROM public.employee_commissions WHERE period_id = p_period_id;
  WITH assigned AS (
    SELECT w.id, w.total_minor::numeric AS total, a.user_id,
      count(*) OVER (PARTITION BY w.id)::numeric AS assignees
    FROM public.washes w
    JOIN public.wash_assignments a ON a.wash_id = w.id AND a.unassigned_at IS NULL
    WHERE w.company_id = v_company AND w.station_id = v_period.station_id
      AND w.status IN ('ready', 'delivered') AND w.deleted_at IS NULL
      AND w.finished_at IS NOT NULL
      AND w.finished_at::date BETWEEN v_period.period_start AND v_period.period_end
  ), per_user AS (
    SELECT user_id, count(DISTINCT id)::integer AS washes_count,
      round(SUM(total / NULLIF(assignees, 0)))::bigint AS base_minor
    FROM assigned GROUP BY user_id
  ), rates AS (
    SELECT pu.*,
      LEAST(GREATEST(COALESCE(ec.commission_rate,
        COALESCE(NULLIF(s.settings ->> 'commission_rate', '')::numeric, 0)), 0), 100)::numeric(5,2) AS rate,
      CASE WHEN ec.commission_rate IS NOT NULL THEN 'contract' ELSE 'station' END AS origin
    FROM per_user pu
    CROSS JOIN public.stations s
    LEFT JOIN LATERAL (
      SELECT c.commission_rate FROM public.employee_contracts c
      WHERE c.user_id = pu.user_id AND c.company_id = v_company
        AND c.station_id = v_period.station_id AND c.active
      ORDER BY c.hired_at DESC LIMIT 1
    ) ec ON true
    WHERE s.id = v_period.station_id
  )
  INSERT INTO public.employee_commissions (company_id, station_id, period_id,
    user_id, washes_count, base_minor, rate, rate_origin, amount_minor, created_at)
  SELECT v_company, v_period.station_id, p_period_id, user_id, washes_count,
    base_minor, rate, origin,
    round(base_minor::numeric * rate / 100)::bigint, now()
  FROM rates;
END $$;

CREATE OR REPLACE FUNCTION public.record_commission_payout(
  p_period_id uuid, p_user_id uuid, p_amount_minor bigint, p_reference text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_status text;
BEGIN
  IF NOT public.has_permission('commissions.validate') THEN
    RAISE EXCEPTION 'Permission commissions.validate requise' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor < 0 THEN
    RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO v_status FROM public.commission_periods
    WHERE id = p_period_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Periode introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_status NOT IN ('validated', 'paid') THEN
    RAISE EXCEPTION 'Periode non validee' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_payouts
    WHERE period_id = p_period_id AND user_id = p_user_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'Paiement deja enregistre' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.commission_payouts (company_id, station_id, period_id,
    user_id, amount_minor, reference, paid_by)
  SELECT v_company, cp.station_id, p_period_id, p_user_id, p_amount_minor,
    COALESCE(p_reference, ''), auth.uid()
  FROM public.commission_periods cp WHERE cp.id = p_period_id;
  UPDATE public.commission_periods SET status = 'paid', updated_at = now()
  WHERE id = p_period_id AND status = 'validated'
    AND NOT EXISTS (
      SELECT 1 FROM public.employee_commissions ec
      LEFT JOIN public.commission_payouts po
        ON po.period_id = ec.period_id AND po.user_id = ec.user_id
      WHERE ec.period_id = p_period_id AND po.id IS NULL
    );
END $$;

CREATE OR REPLACE FUNCTION public.reconcile_channel(
  p_method_id uuid, p_start date, p_end date, p_counted_minor bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_method record; v_expected bigint; v_frozen boolean;
BEGIN
  IF NOT public.has_permission('cash.close') THEN
    RAISE EXCEPTION 'Permission cash.close requise' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start OR p_counted_minor IS NULL OR p_counted_minor < 0 THEN
    RAISE EXCEPTION 'Rapprochement invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_method FROM public.payment_methods
    WHERE id = p_method_id AND company_id = v_company AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moyen de paiement introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_method.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  SELECT frozen INTO v_frozen FROM public.channel_reconciliations
    WHERE station_id = v_method.station_id AND payment_method_id = p_method_id
      AND period_start = p_start AND period_end = p_end;
  IF COALESCE(v_frozen, false) THEN
    RAISE EXCEPTION 'Rapprochement deja fige' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(SUM(p.amount_minor), 0) - COALESCE((
    SELECT SUM(pc.amount_minor) FROM public.payment_cancellations pc
    JOIN public.payments p2 ON p2.id = pc.payment_id
    WHERE p2.payment_method_id = p_method_id AND p2.company_id = v_company
      AND pc.created_at::date BETWEEN p_start AND p_end
  ), 0) INTO v_expected
  FROM public.payments p
  WHERE p.payment_method_id = p_method_id AND p.company_id = v_company
    AND p.created_at::date BETWEEN p_start AND p_end;
  -- difference_minor est une colonne GÉNÉRÉE : ne jamais l'insérer.
  INSERT INTO public.channel_reconciliations (company_id, station_id,
    payment_method_id, period_start, period_end, expected_minor, counted_minor,
    frozen, validated_by, validated_at)
  VALUES (v_company, v_method.station_id, p_method_id, p_start, p_end,
    v_expected, p_counted_minor, true, auth.uid(), now())
  ON CONFLICT (station_id, payment_method_id, period_start, period_end) DO UPDATE SET
    expected_minor = EXCLUDED.expected_minor,
    counted_minor = EXCLUDED.counted_minor,
    frozen = true,
    validated_by = EXCLUDED.validated_by,
    validated_at = EXCLUDED.validated_at,
    updated_at = now()
  WHERE public.channel_reconciliations.frozen = false;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'open_cash_session','record_expense_by_key','cancel_expense','cancel_payment',
      'create_commission_period','generate_commission_lines','validate_commission_period',
      'record_commission_payout','reconcile_channel'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
