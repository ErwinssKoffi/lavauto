-- 006 — RH et commissions figées (Prompt 03)
-- Une période validée n'est JAMAIS recalculée.
CREATE TABLE public.employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  hired_at date NOT NULL DEFAULT current_date,
  ended_at date,
  salary_minor bigint NOT NULL DEFAULT 0 CHECK (salary_minor >= 0),
  commission_rate numeric(5,2) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.commission_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','paid')),
  validated_by uuid REFERENCES public.user_profiles(id),
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE public.employee_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL REFERENCES public.commission_periods(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  washes_count integer NOT NULL DEFAULT 0 CHECK (washes_count >= 0),
  base_minor bigint NOT NULL DEFAULT 0 CHECK (base_minor >= 0),
  rate numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  rate_origin text NOT NULL CHECK (rate_origin IN ('station','contract')),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, user_id)
);

CREATE TABLE public.commission_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL REFERENCES public.commission_periods(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  reference text NOT NULL DEFAULT '',
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by uuid REFERENCES public.user_profiles(id),
  UNIQUE (period_id, user_id)
);
