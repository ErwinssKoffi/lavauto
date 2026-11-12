-- 004 — Cycle de lavage : 7 statuts, historique, affectations, qualité (Prompt 03)
-- Un lavage « ready » (terminé) n'est PAS « delivered » (livré).
CREATE SEQUENCE IF NOT EXISTS public.wash_number_seq AS bigint START 1;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  communication_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX ix_customers_station ON public.customers (company_id, station_id, created_at);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_category_id uuid REFERENCES public.vehicle_categories(id),
  plate text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_vehicles_plate ON public.vehicles (company_id, upper(plate)) WHERE deleted_at IS NULL AND plate <> '';

CREATE TABLE public.washes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  number text NOT NULL,
  customer_id uuid REFERENCES public.customers(id),
  customer_name text,
  vehicle_id uuid REFERENCES public.vehicles(id),
  vehicle_category_id uuid NOT NULL REFERENCES public.vehicle_categories(id),
  vehicle_label text NOT NULL DEFAULT '',
  plate text NOT NULL DEFAULT '',
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','quality_check','ready','delivered','cancelled')),
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  deleted_at timestamptz,
  UNIQUE (station_id, number),
  UNIQUE (company_id, idempotency_key),
  CHECK (paid_minor <= total_minor)
);
CREATE INDEX ix_washes_station_date ON public.washes (company_id, station_id, created_at DESC);
CREATE INDEX ix_washes_status ON public.washes (company_id, station_id, status);

-- Prix figé : unit_price_minor est saisi au moment de la fiche, jamais recalculé.
-- Table append-only (trigger 010) : aucune modification de prix après coup.
CREATE TABLE public.wash_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services(id),
  service_name text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wash_items_wash ON public.wash_items (company_id, wash_id);

CREATE TABLE public.wash_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_status_history ON public.wash_status_history (company_id, wash_id, created_at);

CREATE TABLE public.wash_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  post_id uuid REFERENCES public.wash_posts(id),
  assigned_by uuid REFERENCES public.user_profiles(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz
);
CREATE INDEX ix_assignments_wash ON public.wash_assignments (company_id, wash_id);

CREATE TABLE public.wash_quality_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  checked_by uuid REFERENCES public.user_profiles(id),
  result text NOT NULL CHECK (result IN ('approved','rejected')),
  notes text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_quality_wash ON public.wash_quality_checks (wash_id, checked_at);
