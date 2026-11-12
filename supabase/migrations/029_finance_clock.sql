-- 029 — Prompt 06 : ordonnance réelle des mouvements de caisse.
-- `now()` est figé au début d'une transaction SQL ; toutes les écritures d'un
-- même test auraient donc le même horodatage et une réouverture ne pourrait pas
-- distinguer les mouvements de la période précédente. Les RPC financières
-- utilisent désormais `clock_timestamp()` pour les mouvements et la réouverture,
-- puis calculent le théorique sur les seuls mouvements de la période courante.
-- Aucune colonne ni aucune table n'est supprimée.

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
    'C-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 8));
  INSERT INTO public.cash_sessions (company_id, station_id, number, opened_by,
    opening_float_minor, status, opened_at)
  VALUES (v_company, p_station_id, v_number, auth.uid(),
    GREATEST(0, COALESCE(p_opening_float_minor, 0)), 'open', clock_timestamp())
  RETURNING id INTO v_session;
  RETURN v_session;
END $$;

CREATE OR REPLACE FUNCTION public.record_payment(
  p_wash_id uuid, p_amount_minor bigint, p_payment_method_id uuid,
  p_reference text DEFAULT '', p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_wash record; v_method record; v_session uuid; v_payment uuid;
BEGIN
  IF NOT public.has_permission('payments.create') THEN
    RAISE EXCEPTION 'Permission payments.create requise' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '23514';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_payment FROM public.payments
      WHERE company_id = v_company AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_payment; END IF;
  END IF;
  SELECT * INTO v_wash FROM public.washes
    WHERE id = p_wash_id AND company_id = v_company AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fiche introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_wash.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_wash.status = 'cancelled' THEN
    RAISE EXCEPTION 'Fiche annulee' USING ERRCODE = '23514';
  END IF;
  IF v_wash.paid_minor + p_amount_minor > v_wash.total_minor THEN
    RAISE EXCEPTION 'Surpaiement' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_method FROM public.payment_methods
    WHERE id = p_payment_method_id AND company_id = v_company
      AND station_id = v_wash.station_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moyen de paiement invalide' USING ERRCODE = '23514'; END IF;
  IF v_method.affects_cash THEN
    SELECT id INTO v_session FROM public.cash_sessions
      WHERE station_id = v_wash.station_id AND company_id = v_company AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Caisse fermee' USING ERRCODE = '23514'; END IF;
  END IF;
  INSERT INTO public.payments (company_id, station_id, wash_id, amount_minor,
    payment_method_id, reference, idempotency_key, created_by)
  VALUES (v_company, v_wash.station_id, p_wash_id, p_amount_minor,
    p_payment_method_id, COALESCE(p_reference, ''), p_idempotency_key, auth.uid())
  RETURNING id INTO v_payment;
  UPDATE public.washes SET paid_minor = paid_minor + p_amount_minor, updated_at = now()
    WHERE id = p_wash_id;
  IF v_method.affects_cash THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, payment_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, v_wash.station_id, v_session, 'payment_in', p_amount_minor,
      p_payment_method_id, v_payment, COALESCE(p_reference, ''),
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'cash:' || p_idempotency_key END,
      auth.uid(), clock_timestamp());
  END IF;
  RETURN v_payment;
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
      amount_minor, payment_method_id, expense_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, p_station_id, v_session, 'expense_out', -p_amount_minor,
      v_method, v_expense, v_cat,
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'expense:' || p_idempotency_key END,
      auth.uid(), clock_timestamp());
  END IF;
  RETURN v_expense;
END $$;

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
      amount_minor, payment_method_id, expense_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, v_e.station_id, v_e.cash_session_id, 'adjustment', v_e.amount_minor,
      v_e.method_id, v_e.id, 'Annulation depense',
      'cancel-expense:' || p_expense_id, auth.uid(), clock_timestamp());
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
      amount_minor, payment_method_id, payment_id, reference, idempotency_key,
      created_by, created_at)
    VALUES (v_company, v_p.station_id, v_session, 'adjustment', -v_p.amount_minor,
      v_p.method_id, p_payment_id, 'Remboursement / annulation encaissement',
      'cancel-payment:' || p_payment_id, auth.uid(), clock_timestamp());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_session_id uuid, p_counted_minor bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_s record;
  v_theoretical bigint; v_diff bigint;
BEGIN
  IF NOT public.has_permission('cash.close') THEN
    RAISE EXCEPTION 'Permission cash.close requise' USING ERRCODE = '42501';
  END IF;
  IF p_counted_minor IS NULL OR p_counted_minor < 0 THEN
    RAISE EXCEPTION 'Comptage invalide' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_s FROM public.cash_sessions
    WHERE id = p_session_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_s.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'open' THEN
    RAISE EXCEPTION 'Caisse deja cloturee' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(v_s.opening_float_minor, 0) + COALESCE(SUM(amount_minor), 0)
  INTO v_theoretical
  FROM public.cash_movements
  WHERE cash_session_id = p_session_id
    AND kind IN ('payment_in', 'expense_out', 'adjustment')
    AND created_at >= COALESCE(v_s.reopened_at, v_s.opened_at);
  v_diff := p_counted_minor - v_theoretical;
  IF v_diff <> 0 THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, reference, created_by, created_at)
    VALUES (v_company, v_s.station_id, p_session_id, 'closing', v_diff,
      'Ecart de cloture', auth.uid(), clock_timestamp());
  END IF;
  INSERT INTO public.cash_closures (company_id, station_id, cash_session_id,
    counted_minor, theoretical_minor, difference_minor, closed_by, created_at)
  VALUES (v_company, v_s.station_id, p_session_id, p_counted_minor,
    v_theoretical, v_diff, auth.uid(), clock_timestamp());
  UPDATE public.cash_sessions
  SET status = 'closed', counted_minor = p_counted_minor, closed_at = clock_timestamp(),
    closed_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;
END $$;

CREATE OR REPLACE FUNCTION public.reopen_cash_session(
  p_session_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.current_company_id(); v_s record;
BEGIN
  IF NOT public.has_permission('cash.reopen') THEN
    RAISE EXCEPTION 'Permission cash.reopen requise' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Motif de reouverture requis' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_s FROM public.cash_sessions
    WHERE id = p_session_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_access_station(v_s.station_id) THEN
    RAISE EXCEPTION 'Station hors perimetre' USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'closed' THEN
    RAISE EXCEPTION 'Caisse deja ouverte' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE station_id = v_s.station_id AND company_id = v_company AND status = 'open') THEN
    RAISE EXCEPTION 'Une caisse est deja ouverte' USING ERRCODE = '23514';
  END IF;
  UPDATE public.cash_sessions
  SET status = 'open', reopened_at = clock_timestamp(), reopen_reason = btrim(p_reason),
    opening_float_minor = COALESCE(counted_minor, opening_float_minor),
    updated_at = now()
  WHERE id = p_session_id;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'open_cash_session', 'record_payment', 'record_expense_by_key',
      'cancel_expense', 'cancel_payment', 'close_cash_session', 'reopen_cash_session'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
