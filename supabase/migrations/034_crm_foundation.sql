-- 034 — Prompt 08 : fondation CRM additive (aucune réécriture 001–033).
-- Aucune donnée de démonstration, aucun fournisseur de notification, aucun envoi.
INSERT INTO public.permissions (key, label_fr, domain)
SELECT v.key, v.label, split_part(v.key, '.', 1) FROM (VALUES
  ('crm.view', 'Consulter le CRM'), ('crm.manage', 'Gérer le CRM'),
  ('loyalty.view', 'Consulter la fidélité'), ('loyalty.manage', 'Gérer la fidélité'),
  ('packages.view', 'Consulter les forfaits'), ('packages.manage', 'Gérer les forfaits'),
  ('promotions.view', 'Consulter les promotions'), ('promotions.manage', 'Gérer les promotions'),
  ('fleets.view', 'Consulter les flottes'), ('fleets.manage', 'Gérer les flottes'),
  ('notifications.view', 'Consulter les notifications en attente'),
  ('notifications.enqueue', 'Mettre une notification en attente')
) AS v(key, label) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.key FROM public.roles r CROSS JOIN public.permissions p
WHERE r.company_id IS NULL AND (
  (r.key IN ('owner','manager') AND p.key IN
    ('crm.view','crm.manage','loyalty.view','loyalty.manage','packages.view','packages.manage',
     'promotions.view','promotions.manage','fleets.view','fleets.manage',
     'notifications.view','notifications.enqueue'))
  OR (r.key = 'cashier' AND p.key IN
    ('crm.view','loyalty.view','packages.view','promotions.view','fleets.view','notifications.view'))
) ON CONFLICT DO NOTHING;

CREATE TABLE public.loyalty_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  points_per_1000_minor integer NOT NULL DEFAULT 1 CHECK (points_per_1000_minor > 0),
  redemption_threshold integer NOT NULL DEFAULT 100 CHECK (redemption_threshold > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_loyalty_programs_station_name ON public.loyalty_programs
  (company_id, station_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.loyalty_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  program_id uuid NOT NULL REFERENCES public.loyalty_programs(id) ON DELETE RESTRICT,
  card_number text NOT NULL CHECK (length(btrim(card_number)) >= 3),
  points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_id, program_id)
);
CREATE UNIQUE INDEX uq_loyalty_cards_company_number ON public.loyalty_cards
  (company_id, upper(card_number));

CREATE TABLE public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  card_id uuid NOT NULL REFERENCES public.loyalty_cards(id) ON DELETE RESTRICT,
  wash_id uuid REFERENCES public.washes(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('earn','redeem','adjustment')),
  points_delta integer NOT NULL CHECK (points_delta <> 0),
  reason text NOT NULL DEFAULT '',
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);
CREATE INDEX ix_loyalty_transactions_card ON public.loyalty_transactions (company_id, card_id, created_at);

CREATE TABLE public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  description text NOT NULL DEFAULT '',
  price_minor bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  wash_count integer NOT NULL CHECK (wash_count > 0),
  validity_days integer NOT NULL CHECK (validity_days > 0),
  starts_at date NOT NULL DEFAULT current_date,
  ends_at date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE UNIQUE INDEX uq_packages_station_name ON public.packages
  (company_id, station_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.customer_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  purchased_at date NOT NULL DEFAULT current_date,
  expires_at date NOT NULL,
  washes_remaining integer NOT NULL CHECK (washes_remaining >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','expired','cancelled')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key),
  CHECK (expires_at >= purchased_at)
);
CREATE INDEX ix_customer_packages_active ON public.customer_packages
  (company_id, customer_id, status, expires_at);

CREATE TABLE public.package_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_package_id uuid NOT NULL REFERENCES public.customer_packages(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, wash_id),
  UNIQUE (company_id, idempotency_key)
);

CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  code text NOT NULL CHECK (length(btrim(code)) >= 2),
  kind text NOT NULL CHECK (kind IN ('percent','amount')),
  value integer NOT NULL CHECK (value > 0),
  min_amount_minor bigint NOT NULL DEFAULT 0 CHECK (min_amount_minor >= 0),
  max_usages integer CHECK (max_usages IS NULL OR max_usages > 0),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  starts_at date NOT NULL DEFAULT current_date,
  ends_at date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_at >= starts_at),
  CHECK (kind <> 'percent' OR value <= 100)
);
CREATE UNIQUE INDEX uq_promotions_station_code ON public.promotions
  (company_id, station_id, upper(code)) WHERE deleted_at IS NULL;

CREATE TABLE public.promotion_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  promotion_id uuid NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  discount_minor bigint NOT NULL CHECK (discount_minor > 0),
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, wash_id),
  UNIQUE (company_id, idempotency_key)
);

CREATE TABLE public.fleets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  contact_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  credit_limit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  preferred_channel text NOT NULL DEFAULT 'none'
    CHECK (preferred_channel IN ('none','sms','email','whatsapp')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_fleets_station_name ON public.fleets
  (company_id, station_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.fleet_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  fleet_id uuid NOT NULL REFERENCES public.fleets(id) ON DELETE RESTRICT,
  number text NOT NULL CHECK (length(btrim(number)) >= 2),
  start_date date NOT NULL DEFAULT current_date,
  end_date date NOT NULL,
  discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  credit_limit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX uq_fleet_contracts_company_number ON public.fleet_contracts
  (company_id, upper(number));

CREATE TABLE public.fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  fleet_id uuid NOT NULL REFERENCES public.fleets(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES public.fleet_contracts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_fleet_vehicles_active ON public.fleet_vehicles
  (fleet_id, vehicle_id) WHERE active;

CREATE TABLE public.fleet_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  fleet_id uuid NOT NULL REFERENCES public.fleets(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES public.fleet_contracts(id) ON DELETE RESTRICT,
  wash_id uuid REFERENCES public.washes(id) ON DELETE SET NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  due_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (company_id, idempotency_key)
);
CREATE INDEX ix_fleet_receivables_open ON public.fleet_receivables
  (company_id, fleet_id, status, due_date);

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  fleet_id uuid REFERENCES public.fleets(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('none','sms','email','whatsapp')),
  template_key text NOT NULL CHECK (length(btrim(template_key)) >= 2),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled')),
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  UNIQUE (company_id, idempotency_key),
  CHECK (customer_id IS NOT NULL OR fleet_id IS NOT NULL),
  CHECK (channel <> 'none')
);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'individual'
    CHECK (customer_type IN ('individual','fleet')),
  ADD COLUMN IF NOT EXISTS preferred_channel text NOT NULL DEFAULT 'none'
    CHECK (preferred_channel IN ('none','sms','email','whatsapp')),
  ADD COLUMN IF NOT EXISTS loyalty_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fleet_id uuid REFERENCES public.fleets(id) ON DELETE SET NULL;
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS fleet_id uuid REFERENCES public.fleets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.washes
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_discount_minor bigint NOT NULL DEFAULT 0
    CHECK (promotion_discount_minor >= 0),
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.customer_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fleet_contract_id uuid REFERENCES public.fleet_contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS loyalty_points_earned integer NOT NULL DEFAULT 0
    CHECK (loyalty_points_earned >= 0),
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer NOT NULL DEFAULT 0
    CHECK (loyalty_points_redeemed >= 0);

CREATE OR REPLACE FUNCTION public.assert_notification_outbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Notification non supprimable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status NOT IN ('pending','cancelled')
    OR (OLD.status = 'cancelled' AND NEW.status <> 'cancelled')
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.fleet_id IS DISTINCT FROM OLD.fleet_id THEN
    RAISE EXCEPTION 'Notification en attente immuable : aucun envoi simule' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'loyalty_programs','loyalty_cards','loyalty_transactions','packages',
    'customer_packages','package_usages','promotions','promotion_usages',
    'fleets','fleet_contracts','fleet_vehicles','fleet_receivables','notification_outbox'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_company ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_company BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_company_id()', t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_%s_select ON public.%I', t, t);
    EXECUTE format('CREATE POLICY p_%s_select ON public.%I FOR SELECT TO authenticated USING ((company_id = public.current_company_id() OR public.is_platform_admin()) AND public.can_access_station(station_id))', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'loyalty_programs','loyalty_cards','packages','customer_packages','promotions',
    'fleets','fleet_contracts','fleet_vehicles','fleet_receivables'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['loyalty_transactions','package_usages','promotion_usages'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assert_immutable()', t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_notification_outbox_guard ON public.notification_outbox;
CREATE TRIGGER trg_notification_outbox_guard BEFORE UPDATE OR DELETE ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION public.assert_notification_outbox_guard();

REVOKE INSERT, UPDATE, DELETE ON
  public.customers, public.vehicles,
  public.loyalty_programs, public.loyalty_cards, public.loyalty_transactions,
  public.packages, public.customer_packages, public.package_usages,
  public.promotions, public.promotion_usages, public.fleets,
  public.fleet_contracts, public.fleet_vehicles, public.fleet_receivables,
  public.notification_outbox
FROM anon, authenticated;
GRANT SELECT ON
  public.customers, public.vehicles,
  public.loyalty_programs, public.loyalty_cards, public.loyalty_transactions,
  public.packages, public.customer_packages, public.package_usages,
  public.promotions, public.promotion_usages, public.fleets,
  public.fleet_contracts, public.fleet_vehicles, public.fleet_receivables,
  public.notification_outbox
TO authenticated;
