-- 005 — Caisse, paiements, dépenses, créances, rapprochement (Prompt 03)
-- Solde théorique = fond initial + encaissements espèces − décaissements espèces.
-- Les mouvements sont immuables ; une annulation est un mouvement inverse.
CREATE TABLE public.cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  number text NOT NULL,
  opened_by uuid REFERENCES public.user_profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float_minor bigint NOT NULL DEFAULT 0 CHECK (opening_float_minor >= 0),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.user_profiles(id),
  counted_minor bigint,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, number)
);
CREATE INDEX ix_cash_sessions ON public.cash_sessions (company_id, station_id, opened_at DESC);

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('opening','payment_in','expense_out','closing','reopen','adjustment')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  payment_method_id uuid REFERENCES public.payment_methods(id),
  reference text NOT NULL DEFAULT '',
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);
CREATE INDEX ix_cash_movements ON public.cash_movements (company_id, station_id, cash_session_id, created_at);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  wash_id uuid NOT NULL REFERENCES public.washes(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods(id),
  reference text NOT NULL DEFAULT '',
  idempotency_key text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);
CREATE INDEX ix_payments_wash ON public.payments (company_id, wash_id);
CREATE INDEX ix_payments_date ON public.payments (company_id, station_id, created_at DESC);

-- Annulation d'un encaissement : tracée, pas effacée.
CREATE TABLE public.payment_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  cancelled_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id)
);

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  category_id uuid REFERENCES public.expense_categories(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  supplier text NOT NULL DEFAULT '',
  spent_at date NOT NULL DEFAULT current_date,
  payment_method_id uuid REFERENCES public.payment_methods(id),
  cash_session_id uuid REFERENCES public.cash_sessions(id),
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','cancelled')),
  cancel_reason text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_expenses_date ON public.expenses (company_id, station_id, spent_at DESC);

CREATE TABLE public.receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id),
  wash_id uuid REFERENCES public.washes(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  settled_minor bigint NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_settled','settled','written_off')),
  due_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (settled_minor <= amount_minor)
);
CREATE INDEX ix_receivables ON public.receivables (company_id, station_id, status);

-- Rapprochement PAR CANAL : espèces, Orange Money, MTN MoMo, Wave, carte…
CREATE TABLE public.channel_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  expected_minor bigint NOT NULL DEFAULT 0,
  counted_minor bigint NOT NULL DEFAULT 0,
  difference_minor bigint GENERATED ALWAYS AS (counted_minor - expected_minor) STORED,
  frozen boolean NOT NULL DEFAULT false,
  validated_by uuid REFERENCES public.user_profiles(id),
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, payment_method_id, period_start, period_end),
  CHECK (period_end >= period_start)
);
