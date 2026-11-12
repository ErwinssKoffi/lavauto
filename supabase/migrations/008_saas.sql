-- 008 — Formules, abonnements, quotas et journal plateforme (Prompt 03)
-- Les 3 formules sont des HYPOTHÈSES COMMERCIALES administrables en back-office,
-- pas des données d'exemple : aucune entreprise, station ni lavage n'est créé ici.
CREATE TABLE public.plans (
  id text PRIMARY KEY CHECK (id ~ '^[a-z_]+$'),
  name text NOT NULL,
  price_monthly_minor bigint NOT NULL DEFAULT 0 CHECK (price_monthly_minor >= 0),
  currency_code char(3) NOT NULL DEFAULT 'XOF' REFERENCES public.currencies(code),
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plan_limits (
  plan_id text NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z_]+$'),
  value_int integer NOT NULL CHECK (value_int >= 0),
  PRIMARY KEY (plan_id, key)
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  plan_id text NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_start date NOT NULL DEFAULT current_date,
  current_period_end date NOT NULL DEFAULT (current_date + interval '1 month')::date,
  pending_plan_id text REFERENCES public.plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_subscription_company ON public.subscriptions (company_id) WHERE status IN ('trial','active','past_due');

CREATE TABLE public.subscription_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  from_plan_id text REFERENCES public.plans(id),
  to_plan_id text NOT NULL REFERENCES public.plans(id),
  requested_by uuid REFERENCES public.user_profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected'))
);

CREATE TABLE public.subscription_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  metric_key text NOT NULL CHECK (metric_key IN ('washes','employees','stations')),
  value_int integer NOT NULL DEFAULT 0 CHECK (value_int >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, station_id, period_start, metric_key)
);

-- Journal plateforme (hors tenant) : append-only, lisible par super admin seul.
CREATE TABLE public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (id, name, price_monthly_minor, trial_days, sort_order, features) VALUES
  ('essai', 'Essai', 0, 14, 1, '["14 jours pour ouvrir votre station","1 station, 3 comptes employés","100 lavages pour démarrer","Tous les modules de gestion"]'::jsonb),
  ('standard', 'Standard', 15000, 0, 2, '["1 station, 10 comptes employés","1 000 lavages par mois","Rapports et exports CSV","Commissions et objectif du mois"]'::jsonb),
  ('premium', 'Premium', 35000, 0, 3, '["Jusqu’à 5 stations","50 comptes employés","Lavages illimités","Journal des opérations sensibles","Support prioritaire"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_limits (plan_id, key, value_int) VALUES
  ('essai','stations',1),('essai','employees',3),('essai','washes_per_month',100),
  ('standard','stations',1),('standard','employees',10),('standard','washes_per_month',1000),
  ('premium','stations',5),('premium','employees',50),('premium','washes_per_month',100000)
ON CONFLICT (plan_id, key) DO NOTHING;
