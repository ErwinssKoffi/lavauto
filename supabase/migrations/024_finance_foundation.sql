-- 024 — Prompt 06 : fondations finance, caisse immuable et encaissement serveur
-- Additif après 021/022/023 (déjà appliqués). Aucune donnée de démonstration.
-- Le frontend n'envoie jamais company_id : le tenant vient de auth.uid().

-- 1. Historique des clôtures : le comptage devient une écriture immuable.
CREATE TABLE IF NOT EXISTS public.cash_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  counted_minor bigint NOT NULL CHECK (counted_minor >= 0),
  theoretical_minor bigint NOT NULL,
  difference_minor bigint NOT NULL,
  closed_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cash_closures ON public.cash_closures (company_id, station_id, created_at DESC);
ALTER TABLE public.cash_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_cash_closures_select ON public.cash_closures;
CREATE POLICY p_cash_closures_select ON public.cash_closures FOR SELECT TO authenticated
  USING (((public.current_company_id() IS NOT NULL AND company_id = public.current_company_id())
    OR public.is_platform_admin()) AND public.can_access_station(station_id));
DROP TRIGGER IF EXISTS trg_cash_closures_company ON public.cash_closures;
CREATE TRIGGER trg_cash_closures_company BEFORE INSERT OR UPDATE ON public.cash_closures
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_id();
DROP TRIGGER IF EXISTS trg_cash_closures_immutable ON public.cash_closures;
CREATE TRIGGER trg_cash_closures_immutable BEFORE UPDATE OR DELETE ON public.cash_closures
  FOR EACH ROW EXECUTE FUNCTION public.assert_immutable();

-- 2. Mouvements de caisse rattachés à leur paiement / dépense d'origine.
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id),
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_idempotency
  ON public.expenses (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Moyen de paiement : créé/activé par le serveur, jamais par le navigateur.
CREATE OR REPLACE FUNCTION public.ensure_payment_method(
  p_company uuid, p_station uuid, p_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_label text; v_kind text; v_cash boolean; v_id uuid;
BEGIN
  CASE p_key
    WHEN 'cash' THEN v_label := 'Especes'; v_kind := 'cash'; v_cash := true;
    WHEN 'mobile_money' THEN v_label := 'Mobile Money'; v_kind := 'mobile_money'; v_cash := false;
    WHEN 'card' THEN v_label := 'Carte'; v_kind := 'card'; v_cash := false;
    WHEN 'transfer' THEN v_label := 'Virement'; v_kind := 'transfer'; v_cash := false;
    ELSE RAISE EXCEPTION 'Moyen de paiement invalide' USING ERRCODE = '23514';
  END CASE;
  INSERT INTO public.payment_methods (company_id, station_id, key, label, kind, affects_cash)
  VALUES (p_company, p_station, p_key, v_label, v_kind, v_cash)
  ON CONFLICT (station_id, key) DO UPDATE SET
    active = true, label = EXCLUDED.label, kind = EXCLUDED.kind, affects_cash = EXCLUDED.affects_cash
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 4. Encaissement : remplace 010 avec portée station + mouvement identifiable.
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
  VALUES (v_company, v_wash.station_id, p_wash_id, p_amount_minor, p_payment_method_id,
    COALESCE(p_reference, ''), p_idempotency_key, auth.uid()) RETURNING id INTO v_payment;
  UPDATE public.washes SET paid_minor = paid_minor + p_amount_minor, updated_at = now()
    WHERE id = p_wash_id;
  IF v_method.affects_cash THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, payment_method_id, payment_id, reference, idempotency_key, created_by)
    VALUES (v_company, v_wash.station_id, v_session, 'payment_in', p_amount_minor,
      p_payment_method_id, v_payment, COALESCE(p_reference, ''),
      CASE WHEN p_idempotency_key IS NOT NULL THEN 'cash:' || p_idempotency_key END, auth.uid());
  END IF;
  RETURN v_payment;
END $$;

-- 5. Clôture : comptage conservé dans cash_closures + mouvement d'écart.
CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_session_id uuid, p_counted_minor bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid := public.current_company_id();
  v_s record; v_theoretical bigint; v_diff bigint;
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
  IF v_s.status <> 'open' THEN RAISE EXCEPTION 'Caisse deja cloturee' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(v_s.opening_float_minor, 0) + COALESCE(SUM(amount_minor), 0) INTO v_theoretical
    FROM public.cash_movements
    WHERE cash_session_id = p_session_id
      AND kind IN ('payment_in', 'expense_out', 'adjustment')
      AND created_at >= COALESCE(v_s.reopened_at, v_s.opened_at);
  v_diff := p_counted_minor - v_theoretical;
  IF v_diff <> 0 THEN
    INSERT INTO public.cash_movements (company_id, station_id, cash_session_id, kind,
      amount_minor, reference, created_by)
    VALUES (v_company, v_s.station_id, p_session_id, 'closing', v_diff,
      'Ecart de cloture', auth.uid());
  END IF;
  INSERT INTO public.cash_closures (company_id, station_id, cash_session_id,
    counted_minor, theoretical_minor, difference_minor, closed_by, created_at)
  VALUES (v_company, v_s.station_id, p_session_id, p_counted_minor, v_theoretical,
    v_diff, auth.uid(), now());
  UPDATE public.cash_sessions SET status = 'closed', counted_minor = p_counted_minor,
    closed_at = now(), closed_by = auth.uid(), updated_at = now()
  WHERE id = p_session_id;
END $$;

-- 6. Réouverture motivée : le dernier comptage devient le fond, sans recalcul.
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
  IF v_s.status <> 'closed' THEN RAISE EXCEPTION 'Caisse deja ouverte' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE station_id = v_s.station_id AND company_id = v_company AND status = 'open') THEN
    RAISE EXCEPTION 'Une caisse est deja ouverte' USING ERRCODE = '23514';
  END IF;
  UPDATE public.cash_sessions SET status = 'open', reopened_at = now(),
    reopen_reason = btrim(p_reason),
    opening_float_minor = COALESCE(counted_minor, opening_float_minor),
    updated_at = now()
  WHERE id = p_session_id;
END $$;

-- 7. Une période validée peut être marquée payée, jamais recalculée.
CREATE OR REPLACE FUNCTION public.assert_commission_period() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'validated') THEN
    RAISE EXCEPTION 'Periode de commission : transition invalide' USING ERRCODE = '55000';
  ELSIF OLD.status = 'validated' AND NEW.status NOT IN ('validated', 'paid') THEN
    RAISE EXCEPTION 'Periode validee : figee' USING ERRCODE = '55000';
  ELSIF OLD.status = 'paid' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Periode payee : figee' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

-- 8. Backfill des clôtures existantes (aucune fixture distante attendue).
INSERT INTO public.cash_closures (company_id, station_id, cash_session_id,
  counted_minor, theoretical_minor, difference_minor, closed_by, created_at)
SELECT c.company_id, c.station_id, c.id, c.counted_minor,
  COALESCE(c.opening_float_minor, 0) + COALESCE((
    SELECT SUM(m.amount_minor) FROM public.cash_movements m
    WHERE m.cash_session_id = c.id AND m.kind IN ('payment_in','expense_out','adjustment')
      AND m.created_at >= COALESCE(c.reopened_at, c.opened_at)
  ), 0),
  c.counted_minor - (COALESCE(c.opening_float_minor, 0) + COALESCE((
    SELECT SUM(m.amount_minor) FROM public.cash_movements m
    WHERE m.cash_session_id = c.id AND m.kind IN ('payment_in','expense_out','adjustment')
      AND m.created_at >= COALESCE(c.reopened_at, c.opened_at)
  ), 0)),
  c.closed_by, COALESCE(c.closed_at, now())
FROM public.cash_sessions c
WHERE c.status = 'closed' AND c.counted_minor IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.cash_closures cc
    WHERE cc.cash_session_id = c.id AND cc.created_at = c.closed_at);

-- 9. Écritures directes interdites : seules les RPC SECURITY DEFINER écrivent.
REVOKE INSERT, UPDATE, DELETE ON
  public.cash_sessions, public.cash_movements, public.cash_closures, public.payments,
  public.payment_cancellations, public.expenses, public.expense_categories,
  public.payment_methods, public.receivables, public.channel_reconciliations,
  public.commission_periods, public.employee_commissions, public.commission_payouts
FROM anon, authenticated;
GRANT SELECT ON
  public.cash_sessions, public.cash_movements, public.cash_closures, public.payments,
  public.payment_cancellations, public.expenses, public.expense_categories,
  public.payment_methods, public.receivables, public.channel_reconciliations,
  public.commission_periods, public.employee_commissions, public.commission_payouts
TO authenticated;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'record_payment', 'close_cash_session', 'reopen_cash_session'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
