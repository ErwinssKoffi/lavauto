-- 003 — Catalogue, tarifs et moyens de paiement (Prompt 03)
-- Le tarif est stocké dans service_prices et FIGÉ dans wash_items à la création.
CREATE TABLE public.vehicle_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_categories_name ON public.vehicle_categories (station_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_services_name ON public.services (station_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE public.service_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  vehicle_category_id uuid NOT NULL REFERENCES public.vehicle_categories(id) ON DELETE CASCADE,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency_code char(3) NOT NULL DEFAULT 'XOF' REFERENCES public.currencies(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, vehicle_category_id)
);
CREATE INDEX ix_prices_station ON public.service_prices (company_id, station_id);

-- Historique des tarifs : append-only, jamais mis à jour ni supprimé.
CREATE TABLE public.service_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL,
  vehicle_category_id uuid NOT NULL,
  old_price_minor bigint,
  new_price_minor bigint NOT NULL,
  changed_by uuid REFERENCES public.user_profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.wash_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Orange Money / MTN MoMo / Wave / carte / virement : configurable par station.
-- affects_cash distingue l'espèce physique du Mobile Money pour la caisse.
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  key text NOT NULL CHECK (key ~ '^[a-z_]+$'),
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash','mobile_money','card','transfer','other')),
  affects_cash boolean NOT NULL DEFAULT false,
  provider_key text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, key)
);

CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_expense_categories_name ON public.expense_categories (station_id, lower(name));
