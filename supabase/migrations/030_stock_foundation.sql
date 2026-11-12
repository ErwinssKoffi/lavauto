-- 030 — Prompt 07 : fondation additive du stock, sans réappliquer 021–029.
-- RÈGLE : le stock n'augmente qu'à la réception ; tout mouvement reste immuable.
-- Les écritures directes sont retirées : seules les RPC SECURITY DEFINER écrivent.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_station_name
  ON public.product_categories (station_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.stock_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  receipt_key text NOT NULL CHECK (length(btrim(receipt_key)) BETWEEN 3 AND 120),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, receipt_key)
);

CREATE TABLE IF NOT EXISTS public.stock_consumption_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL UNIQUE REFERENCES public.washes(id) ON DELETE RESTRICT,
  movement_count integer NOT NULL DEFAULT 0 CHECK (movement_count >= 0),
  valued_minor bigint NOT NULL DEFAULT 0 CHECK (valued_minor >= 0),
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.finance_cost_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date NOT NULL,
  revenue_minor bigint NOT NULL,
  consumption_cost_minor bigint NOT NULL,
  operating_expense_minor bigint NOT NULL,
  commission_cost_minor bigint NOT NULL,
  fixed_cost_minor bigint NOT NULL,
  gross_margin_minor bigint NOT NULL,
  result_minor bigint NOT NULL,
  stock_movement_count integer NOT NULL,
  valued_consumptions integer NOT NULL,
  attestation text NOT NULL CHECK (length(btrim(attestation)) >= 15),
  certified_by uuid REFERENCES public.user_profiles(id),
  certified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, start_date, end_date),
  CHECK (end_date >= start_date)
);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id),
  ADD COLUMN IF NOT EXISTS average_cost_minor bigint NOT NULL DEFAULT 0 CHECK (average_cost_minor >= 0);
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT '';
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id);
ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS is_stock_purchase boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_idempotency
  ON public.purchase_orders (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_open_session
  ON public.inventory_sessions (station_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_stock_movements_kind_date
  ON public.stock_movements (company_id, station_id, kind, created_at);
CREATE INDEX IF NOT EXISTS ix_finance_cost_periods_company_dates
  ON public.finance_cost_periods (company_id, start_date, end_date);

-- Catégories de dépense qui représentent un achat de stock : une dépense de
-- cette famille doit être rattachée à une commande pour éviter le double coût
-- (achat en stock + consommation). Aucun envoi, aucun fournisseur externe.
CREATE OR REPLACE FUNCTION public.tag_stock_expense_category() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.is_stock_purchase := lower(btrim(NEW.name)) IN
    ('achats', 'achat', 'stock', 'fournitures', 'produits', 'consommables', 'shampoing');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_expense_categories_stock_flag ON public.expense_categories;
CREATE TRIGGER trg_expense_categories_stock_flag
BEFORE INSERT OR UPDATE ON public.expense_categories
FOR EACH ROW EXECUTE FUNCTION public.tag_stock_expense_category();

UPDATE public.expense_categories
SET is_stock_purchase = lower(btrim(name)) IN
  ('achats', 'achat', 'stock', 'fournitures', 'produits', 'consommables', 'shampoing')
WHERE is_stock_purchase IS DISTINCT FROM lower(btrim(name)) IN
  ('achats', 'achat', 'stock', 'fournitures', 'produits', 'consommables', 'shampoing');

-- Coût moyen pondéré initial, dérivé des seules réceptions déjà tracées.
UPDATE public.products p
SET average_cost_minor = COALESCE((
  SELECT ROUND(SUM(m.qty_delta * m.unit_cost_minor)::numeric / NULLIF(SUM(m.qty_delta), 0))::bigint
  FROM public.stock_movements m
  WHERE m.product_id = p.id AND m.kind = 'purchase_receipt' AND m.qty_delta > 0
), 0)
WHERE average_cost_minor = 0
  AND EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.product_id = p.id AND m.kind = 'purchase_receipt');

-- Un inventaire clos est figé : aucun comptage, aucune session, aucun relevé
-- ne peut être réécrit. La clôture open → closed reste autorisée une fois.
CREATE OR REPLACE FUNCTION public.assert_inventory_session_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.status = 'closed') THEN
    RAISE EXCEPTION 'Inventaire clos immuable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'closed' AND OLD.status = 'open' THEN
    NEW.closed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.assert_inventory_item_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_session uuid; v_status text;
BEGIN
  v_session := CASE WHEN TG_OP = 'INSERT' THEN NEW.session_id ELSE OLD.session_id END;
  SELECT status INTO v_status FROM public.inventory_sessions WHERE id = v_session;
  IF v_status = 'closed' OR (TG_OP = 'DELETE' AND v_status IS NOT NULL) THEN
    RAISE EXCEPTION 'Comptage d inventaire clos immuable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_sessions_guard ON public.inventory_sessions;
CREATE TRIGGER trg_inventory_sessions_guard
BEFORE UPDATE OR DELETE ON public.inventory_sessions
FOR EACH ROW EXECUTE FUNCTION public.assert_inventory_session_guard();
DROP TRIGGER IF EXISTS trg_inventory_items_guard ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.assert_inventory_item_guard();

-- Journaux P07 immuables : une régularisation est un NOUVEAU mouvement.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_receipt_events','stock_consumption_runs','finance_cost_periods'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assert_immutable()', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_company BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_company_id()', t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

CREATE POLICY p_product_categories_select ON public.product_categories FOR SELECT TO authenticated
USING ((company_id = public.current_company_id() OR public.is_platform_admin())
  AND public.can_access_station(station_id));
CREATE POLICY p_stock_receipt_events_select ON public.stock_receipt_events FOR SELECT TO authenticated
USING ((company_id = public.current_company_id() OR public.is_platform_admin())
  AND public.can_access_station(station_id));
CREATE POLICY p_stock_consumption_runs_select ON public.stock_consumption_runs FOR SELECT TO authenticated
USING ((company_id = public.current_company_id() OR public.is_platform_admin())
  AND public.can_access_station(station_id));
CREATE POLICY p_finance_cost_periods_select ON public.finance_cost_periods FOR SELECT TO authenticated
USING (company_id = public.current_company_id() OR public.is_platform_admin());

-- Toutes les tables de stock passent par RPC : le navigateur ne peut ni
-- incrémenter un niveau, ni éditer un mouvement, ni forger une réception.
REVOKE INSERT, UPDATE, DELETE ON
  public.suppliers, public.products, public.product_categories,
  public.purchase_orders, public.purchase_order_items,
  public.stock_movements, public.stock_levels,
  public.inventory_sessions, public.inventory_items,
  public.service_product_consumptions,
  public.stock_receipt_events, public.stock_consumption_runs,
  public.finance_cost_periods
FROM anon, authenticated;
GRANT SELECT ON
  public.suppliers, public.products, public.product_categories,
  public.purchase_orders, public.purchase_order_items,
  public.stock_movements, public.stock_levels,
  public.inventory_sessions, public.inventory_items,
  public.service_product_consumptions,
  public.stock_receipt_events, public.stock_consumption_runs,
  public.finance_cost_periods
TO authenticated;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('tag_stock_expense_category','assert_inventory_session_guard','assert_inventory_item_guard')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
