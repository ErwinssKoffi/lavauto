-- 027 — Prompt 06 : correctifs, garde des relevés figés, lecture finance
-- agrégée, rattachement des données historiques aux mouvements de caisse.
-- 024/025/026 sont déjà appliqués ; ce fichier ne les réapplique jamais.

-- Une période BROUILLON peut être recalculée ; validée ou payée, jamais.
CREATE OR REPLACE FUNCTION public.assert_commission_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.commission_periods WHERE id = OLD.period_id;
    IF v_status IN ('validated', 'paid') THEN
      RAISE EXCEPTION 'Periode de commission figee : ligne non supprimable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM public.commission_periods WHERE id = NEW.period_id;
  IF v_status IN ('validated', 'paid') THEN
    RAISE EXCEPTION 'Periode de commission figee : ligne non modifiable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.generate_commission_lines(p_period_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

-- Valider = recalculer UNE dernière fois en brouillon, puis figer.
CREATE OR REPLACE FUNCTION public.validate_commission_period(p_period_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  PERFORM public.generate_commission_lines(p_period_id);
  UPDATE public.commission_periods
    SET status = 'validated', validated_by = auth.uid(), validated_at = now(), updated_at = now()
    WHERE id = p_period_id;
END $$;

-- Rapprochement par canal : difference_minor est une colonne GÉNÉRÉE.
CREATE OR REPLACE FUNCTION public.reconcile_channel(
  p_method_id uuid, p_start date, p_end date, p_counted_minor bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_method record;
  v_expected bigint; v_frozen boolean;
BEGIN
  IF NOT public.has_permission('cash.close') THEN
    RAISE EXCEPTION 'Permission cash.close requise' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start
    OR p_counted_minor IS NULL OR p_counted_minor < 0 THEN
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

CREATE OR REPLACE FUNCTION public.assert_channel_reconciliation_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.frozen THEN
      RAISE EXCEPTION 'Rapprochement fige : non modifiable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.frozen AND (
    NEW.frozen IS NOT TRUE
    OR NEW.expected_minor IS DISTINCT FROM OLD.expected_minor
    OR NEW.counted_minor IS DISTINCT FROM OLD.counted_minor
    OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION 'Rapprochement fige : non modifiable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_channel_reconciliations_frozen ON public.channel_reconciliations;
CREATE TRIGGER trg_channel_reconciliations_frozen
BEFORE UPDATE OR DELETE ON public.channel_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.assert_channel_reconciliation_frozen();

-- Une annulation/remboursement en espèces n'altère jamais une caisse clôturée.
CREATE OR REPLACE FUNCTION public.cancel_expense(p_expense_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_e record; v_status text;
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
  IF COALESCE(v_e.affects_cash, false) AND v_e.cash_session_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.cash_sessions WHERE id = v_e.cash_session_id;
    IF v_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'Caisse cloturee : annulation impossible sans reouverture' USING ERRCODE = '23514';
    END IF;
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

CREATE OR REPLACE FUNCTION public.cancel_payment(p_payment_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_p record; v_session uuid; v_status text;
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
  IF COALESCE(v_p.affects_cash, false) THEN
    SELECT cash_session_id INTO v_session FROM public.cash_movements
      WHERE payment_id = p_payment_id AND kind = 'payment_in' LIMIT 1;
    IF v_session IS NOT NULL THEN
      SELECT status INTO v_status FROM public.cash_sessions WHERE id = v_session;
      IF v_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'Caisse cloturee : annulation impossible sans reouverture' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.payment_cancellations (company_id, station_id, payment_id,
    amount_minor, reason, cancelled_by, created_at)
  VALUES (v_company, v_p.station_id, p_payment_id, v_p.amount_minor,
    btrim(p_reason), auth.uid(), now());
  UPDATE public.washes SET paid_minor = GREATEST(0, paid_minor - v_p.amount_minor),
    updated_at = now() WHERE id = v_p.wash_id AND company_id = v_company;
  IF COALESCE(v_p.affects_cash, false) AND v_session IS NOT NULL THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, payment_id, reference, idempotency_key, created_by)
    VALUES (v_company, v_p.station_id, v_session, 'adjustment', -v_p.amount_minor,
      v_p.method_id, p_payment_id, 'Remboursement / annulation encaissement',
      'cancel-payment:' || p_payment_id, auth.uid());
  END IF;
END $$;

-- Le board lave expose l'annulation d'un paiement (remboursement), sans jamais
-- supprimer la ligne de paiement. Aucun paiement dupliqué.
CREATE OR REPLACE FUNCTION public.my_wash_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_result jsonb;
BEGIN
  IF NOT public.has_permission('washes.view') THEN
    RAISE EXCEPTION 'Permission washes.view requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(q.w ORDER BY q.created_at DESC), '[]'::jsonb) INTO v_result FROM (
    SELECT w.created_at, jsonb_build_object(
      'id', w.id, 'stationId', w.station_id, 'number', w.number,
      'clientId', w.customer_id, 'clientName', w.customer_name,
      'vehicleCategoryId', w.vehicle_category_id, 'vehicleLabel', w.vehicle_label,
      'plate', w.plate,
      'employeeId', COALESCE((SELECT a.user_id::text FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL ORDER BY a.assigned_at LIMIT 1), ''),
      'assignedUserIds', COALESCE((SELECT jsonb_agg(a.user_id::text ORDER BY a.assigned_at)
        FROM public.wash_assignments a WHERE a.wash_id = w.id AND a.unassigned_at IS NULL), '[]'::jsonb),
      'postId', (SELECT a.post_id::text FROM public.wash_assignments a
        WHERE a.wash_id = w.id AND a.unassigned_at IS NULL AND a.post_id IS NOT NULL
        ORDER BY a.assigned_at LIMIT 1),
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'serviceId', i.service_id, 'serviceName', i.service_name,
        'unitPrice', i.unit_price_minor, 'qty', i.qty) ORDER BY i.created_at)
        FROM public.wash_items i WHERE i.wash_id = w.id), '[]'::jsonb),
      'discount', w.discount_minor, 'total', w.total_minor, 'paid', w.paid_minor,
      'status', w.status, 'createdAt', w.created_at, 'finishedAt', w.finished_at,
      'cancelledReason', w.cancelled_reason, 'deliveredAt', w.delivered_at,
      'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pay.id, 'amount', pay.amount_minor,
        'method', public.payment_method_ui_key(pm.key),
        'at', pay.created_at, 'byUserId', pay.created_by,
        'idempotencyKey', pay.idempotency_key,
        'cancelledAt', pc.created_at, 'cancelReason', pc.reason
      ) ORDER BY pay.created_at)
        FROM public.payments pay
        LEFT JOIN public.payment_methods pm ON pm.id = pay.payment_method_id
        LEFT JOIN public.payment_cancellations pc ON pc.payment_id = pay.id
        WHERE pay.wash_id = w.id), '[]'::jsonb),
      'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', h.id, 'fromStatus', h.from_status, 'toStatus', h.to_status,
        'reason', h.reason, 'at', h.created_at, 'actorUserId', h.actor_user_id
      ) ORDER BY h.created_at) FROM public.wash_status_history h WHERE h.wash_id = w.id), '[]'::jsonb),
      'qualityResult', (SELECT q.result FROM public.wash_quality_checks q
        WHERE q.wash_id = w.id ORDER BY q.checked_at DESC LIMIT 1),
      'qualityNotes', (SELECT q.notes FROM public.wash_quality_checks q
        WHERE q.wash_id = w.id ORDER BY q.checked_at DESC LIMIT 1)
    ) AS w
    FROM public.washes w
    WHERE (w.company_id = v_company OR public.is_platform_admin())
      AND public.can_access_station(w.station_id) AND w.deleted_at IS NULL
    ORDER BY w.created_at DESC LIMIT 200
  ) q;
  RETURN v_result;
END $$;

-- Lecture finance agrégée : une seule RPC, RLS + périmètre station appliqués.
CREATE OR REPLACE FUNCTION public.my_finance_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_admin boolean := public.is_platform_admin();
BEGIN
  IF NOT (
    public.has_permission('reports.view') OR public.has_permission('cash.open')
    OR public.has_permission('expenses.create') OR public.has_permission('commissions.view')
  ) THEN
    RAISE EXCEPTION 'Permission finance requise' USING ERRCODE = '42501';
  END IF;
  IF v_company IS NULL AND NOT v_admin THEN
    RAISE EXCEPTION 'Aucune entreprise rattachee a ce compte' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'paymentMethods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', pm.id, 'stationId', pm.station_id, 'key', pm.key, 'label', pm.label,
      'uiMethod', public.payment_method_ui_key(pm.key),
      'affectsCash', pm.affects_cash, 'active', pm.active
    ) ORDER BY pm.key) FROM public.payment_methods pm
      WHERE (pm.company_id = v_company OR v_admin) AND public.can_access_station(pm.station_id)), '[]'::jsonb),
    'cashSessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', cs.id, 'stationId', cs.station_id, 'number', cs.number,
      'openedBy', COALESCE(u.full_name, ''), 'openedAt', cs.opened_at,
      'openingFloat', cs.opening_float_minor, 'closedAt', cs.closed_at,
      'countedAmount', cs.counted_minor, 'closedBy', COALESCE(u2.full_name, ''),
      'status', CASE WHEN cs.status = 'open' THEN 'ouverte' ELSE 'cloturee' END,
      'reopenReason', cs.reopen_reason, 'reopenedAt', cs.reopened_at
    ) ORDER BY cs.opened_at DESC) FROM public.cash_sessions cs
      LEFT JOIN public.user_profiles u ON u.id = cs.opened_by
      LEFT JOIN public.user_profiles u2 ON u2.id = cs.closed_by
      WHERE (cs.company_id = v_company OR v_admin) AND public.can_access_station(cs.station_id)), '[]'::jsonb),
    'cashMovements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'stationId', m.station_id, 'cashSessionId', m.cash_session_id,
      'kind', m.kind, 'amount', m.amount_minor,
      'uiMethod', public.payment_method_ui_key(pm.key),
      'paymentId', m.payment_id, 'expenseId', m.expense_id,
      'reference', m.reference, 'idempotencyKey', m.idempotency_key,
      'createdAt', m.created_at
    ) ORDER BY m.created_at) FROM public.cash_movements m
      LEFT JOIN public.payment_methods pm ON pm.id = m.payment_method_id
      WHERE (m.company_id = v_company OR v_admin) AND public.can_access_station(m.station_id)), '[]'::jsonb),
    'cashClosures', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'stationId', c.station_id, 'cashSessionId', c.cash_session_id,
      'counted', c.counted_minor, 'theoretical', c.theoretical_minor,
      'difference', c.difference_minor, 'closedBy', COALESCE(u.full_name, ''),
      'createdAt', c.created_at
    ) ORDER BY c.created_at DESC) FROM public.cash_closures c
      LEFT JOIN public.user_profiles u ON u.id = c.closed_by
      WHERE (c.company_id = v_company OR v_admin) AND public.can_access_station(c.station_id)), '[]'::jsonb),
    'expenses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'stationId', e.station_id, 'amount', e.amount_minor,
      'category', COALESCE(c.name, 'Autre'), 'reason', e.reason,
      'supplier', COALESCE(e.supplier, ''), 'date', e.spent_at,
      'method', public.payment_method_ui_key(pm.key),
      'cashSessionId', e.cash_session_id,
      'status', CASE WHEN e.status = 'cancelled' THEN 'annulee' ELSE 'enregistree' END,
      'cancelReason', e.cancel_reason, 'createdBy', COALESCE(u.full_name, ''),
      'createdAt', e.created_at, 'idempotencyKey', e.idempotency_key
    ) ORDER BY e.created_at DESC) FROM public.expenses e
      LEFT JOIN public.expense_categories c ON c.id = e.category_id
      LEFT JOIN public.payment_methods pm ON pm.id = e.payment_method_id
      LEFT JOIN public.user_profiles u ON u.id = e.created_by
      WHERE (e.company_id = v_company OR v_admin) AND public.can_access_station(e.station_id)), '[]'::jsonb),
    'reconciliations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'stationId', r.station_id, 'methodId', r.payment_method_id,
      'uiMethod', public.payment_method_ui_key(pm.key),
      'start', r.period_start, 'end', r.period_end,
      'expected', r.expected_minor, 'counted', r.counted_minor,
      'difference', r.difference_minor, 'frozen', r.frozen,
      'validatedAt', r.validated_at
    ) ORDER BY r.period_start DESC) FROM public.channel_reconciliations r
      LEFT JOIN public.payment_methods pm ON pm.id = r.payment_method_id
      WHERE (r.company_id = v_company OR v_admin) AND public.can_access_station(r.station_id)), '[]'::jsonb),
    'commissionPeriods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', cp.id, 'stationId', cp.station_id, 'start', cp.period_start,
      'end', cp.period_end, 'status', cp.status, 'validatedAt', cp.validated_at
    ) ORDER BY cp.period_start DESC) FROM public.commission_periods cp
      WHERE (cp.company_id = v_company OR v_admin) AND public.can_access_station(cp.station_id)), '[]'::jsonb),
    'commissionLines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', ec.id, 'periodId', ec.period_id, 'userId', ec.user_id,
      'userName', COALESCE(u.full_name, 'Employe'), 'washes', ec.washes_count,
      'base', ec.base_minor, 'rate', ec.rate, 'rateOrigin', ec.rate_origin,
      'amount', ec.amount_minor, 'createdAt', ec.created_at
    ) ORDER BY ec.created_at) FROM public.employee_commissions ec
      LEFT JOIN public.user_profiles u ON u.id = ec.user_id
      WHERE (ec.company_id = v_company OR v_admin) AND public.can_access_station(ec.station_id)), '[]'::jsonb),
    'commissionPayouts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', po.id, 'periodId', po.period_id, 'userId', po.user_id,
      'amount', po.amount_minor, 'reference', COALESCE(po.reference, ''),
      'paidAt', po.paid_at
    ) ORDER BY po.paid_at) FROM public.commission_payouts po
      WHERE (po.company_id = v_company OR v_admin) AND public.can_access_station(po.station_id)), '[]'::jsonb),
    'paymentCancellations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', pc.id, 'paymentId', pc.payment_id, 'amount', pc.amount_minor,
      'reason', pc.reason, 'at', pc.created_at
    ) ORDER BY pc.created_at) FROM public.payment_cancellations pc
      WHERE (pc.company_id = v_company OR v_admin) AND public.can_access_station(pc.station_id)), '[]'::jsonb)
  );
END $$;

-- ── Rattachement des données historiques ─────────────────────────────────────
-- Paiements sans méthode → espèces par défaut ; clôtures comptées → mouvement
-- « closing » + relevé immuable. Aucun mouvement n'est dupliqué.
ALTER TABLE public.payments DISABLE TRIGGER trg_payments_immutable;
DO $$
DECLARE r record; v_method uuid;
BEGIN
  FOR r IN SELECT id, company_id, station_id FROM public.payments WHERE payment_method_id IS NULL LOOP
    v_method := public.ensure_payment_method(r.company_id, r.station_id, 'cash');
    UPDATE public.payments SET payment_method_id = v_method WHERE id = r.id;
  END LOOP;
END $$;
ALTER TABLE public.payments ENABLE TRIGGER trg_payments_immutable;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_payment_in
  ON public.cash_movements (payment_id) WHERE payment_id IS NOT NULL AND kind = 'payment_in';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_movements_expense_out
  ON public.cash_movements (expense_id) WHERE expense_id IS NOT NULL AND kind = 'expense_out';

INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
  amount_minor, payment_method_id, payment_id, reference, idempotency_key,
  created_by, created_at)
SELECT p.company_id, p.station_id, cs.id, 'payment_in', p.amount_minor,
  p.payment_method_id, p.id, COALESCE(p.reference, ''),
  'legacy-payment:' || p.id::text, p.created_by, p.created_at
FROM public.payments p
JOIN public.payment_methods pm ON pm.id = p.payment_method_id AND pm.affects_cash
JOIN LATERAL (
  SELECT s.id FROM public.cash_sessions s
  WHERE s.company_id = p.company_id AND s.station_id = p.station_id
    AND s.opened_at <= p.created_at
    AND (s.status = 'open' OR s.closed_at >= p.created_at)
  ORDER BY s.opened_at DESC LIMIT 1
) cs ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.cash_movements m
  WHERE m.payment_id = p.id AND m.kind = 'payment_in'
);

INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
  amount_minor, payment_method_id, expense_id, reference, idempotency_key,
  created_by, created_at)
SELECT e.company_id, e.station_id, cs.id, 'expense_out', -e.amount_minor,
  e.payment_method_id, e.id, COALESCE(c.name, 'Depense'),
  'legacy-expense:' || e.id::text, e.created_by, e.created_at
FROM public.expenses e
JOIN public.payment_methods pm ON pm.id = e.payment_method_id AND pm.affects_cash
LEFT JOIN public.expense_categories c ON c.id = e.category_id
JOIN LATERAL (
  SELECT s.id FROM public.cash_sessions s
  WHERE s.company_id = e.company_id AND s.station_id = e.station_id
    AND s.opened_at <= e.created_at
    AND (s.status = 'open' OR s.closed_at >= e.created_at)
  ORDER BY s.opened_at DESC LIMIT 1
) cs ON true
WHERE e.status = 'recorded' AND NOT EXISTS (
  SELECT 1 FROM public.cash_movements m
  WHERE m.expense_id = e.id AND m.kind = 'expense_out'
);

-- Mouvement de clôture = comptage − théorique, jamais une simple colonne
-- réécrite sur la session. La contrainte amount_minor <> 0 impose le filtre.
INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
  amount_minor, reference, idempotency_key, created_by, created_at)
SELECT c.company_id, c.station_id, c.id, 'closing',
  c.counted_minor - (
    COALESCE(c.opening_float_minor, 0) + COALESCE((
      SELECT SUM(m.amount_minor) FROM public.cash_movements m
      WHERE m.cash_session_id = c.id
        AND m.kind IN ('payment_in', 'expense_out', 'adjustment')
        AND m.created_at >= COALESCE(c.reopened_at, c.opened_at)
        AND m.created_at <= COALESCE(c.closed_at, now())
    ), 0)
  ),
  'Ecart de cloture (reprise P06)', 'legacy-closing:' || c.id::text,
  c.closed_by, COALESCE(c.closed_at, now())
FROM public.cash_sessions c
WHERE c.status = 'closed' AND c.counted_minor IS NOT NULL
  AND c.counted_minor <> (
    COALESCE(c.opening_float_minor, 0) + COALESCE((
      SELECT SUM(m.amount_minor) FROM public.cash_movements m
      WHERE m.cash_session_id = c.id
        AND m.kind IN ('payment_in', 'expense_out', 'adjustment')
        AND m.created_at >= COALESCE(c.reopened_at, c.opened_at)
        AND m.created_at <= COALESCE(c.closed_at, now())
    ), 0)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.cash_movements m
    WHERE m.cash_session_id = c.id AND m.kind = 'closing'
      AND m.idempotency_key = 'legacy-closing:' || c.id::text
  );

INSERT INTO public.cash_closures (company_id, station_id, cash_session_id,
  counted_minor, theoretical_minor, difference_minor, closed_by, created_at)
SELECT c.company_id, c.station_id, c.id, c.counted_minor,
  COALESCE(c.opening_float_minor, 0) + COALESCE((
    SELECT SUM(m.amount_minor) FROM public.cash_movements m
    WHERE m.cash_session_id = c.id
      AND m.kind IN ('payment_in', 'expense_out', 'adjustment')
      AND m.created_at >= COALESCE(c.reopened_at, c.opened_at)
      AND m.created_at <= COALESCE(c.closed_at, now())
  ), 0),
  c.counted_minor - (
    COALESCE(c.opening_float_minor, 0) + COALESCE((
      SELECT SUM(m.amount_minor) FROM public.cash_movements m
      WHERE m.cash_session_id = c.id
        AND m.kind IN ('payment_in', 'expense_out', 'adjustment')
        AND m.created_at >= COALESCE(c.reopened_at, c.opened_at)
        AND m.created_at <= COALESCE(c.closed_at, now())
    ), 0)
  ),
  c.closed_by, COALESCE(c.closed_at, now())
FROM public.cash_sessions c
WHERE c.status = 'closed' AND c.counted_minor IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.cash_closures cc
    WHERE cc.cash_session_id = c.id
      AND cc.counted_minor = c.counted_minor
      AND cc.created_at = c.closed_at
  );

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'assert_commission_immutable', 'assert_channel_reconciliation_frozen',
      'my_wash_board', 'my_finance_board', 'reconcile_channel',
      'validate_commission_period', 'generate_commission_lines',
      'cancel_expense', 'cancel_payment'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
