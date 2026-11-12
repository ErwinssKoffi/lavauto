-- 001 — Fondations multi-entreprises (Prompt 03)
-- Aucune donnée métier de démonstration : seules les devises ISO sont référencées.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.currencies (
  code char(3) PRIMARY KEY,
  label text NOT NULL,
  symbol text NOT NULL,
  minor_units smallint NOT NULL DEFAULT 0 CHECK (minor_units BETWEEN 0 AND 4),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.currencies (code, label, symbol, minor_units) VALUES
  ('XOF', 'Franc CFA BCEAO', 'FCFA', 0),
  ('XAF', 'Franc CFA BEAC', 'FCFA', 0),
  ('GHS', 'Cedi ghanéen', 'GH₵', 2),
  ('NGN', 'Naira nigérian', '₦', 2),
  ('KES', 'Shilling kényan', 'KSh', 2)
ON CONFLICT (code) DO NOTHING;

-- Racine du tenant : pas de company_id, l'isolation porte sur id.
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  city text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  country_code char(2) NOT NULL DEFAULT 'CI',
  currency_code char(3) NOT NULL DEFAULT 'XOF' REFERENCES public.currencies(code),
  locale text NOT NULL DEFAULT 'fr-CI',
  timezone text NOT NULL DEFAULT 'Africa/Abidjan',
  date_format text NOT NULL DEFAULT 'dd/MM/yyyy',
  suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- 1 entreprise → N stations ( Prompt 03 ), 1 station par défaut à l'inscription.
CREATE TABLE public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  logo_url text,
  currency_code char(3) NOT NULL DEFAULT 'XOF' REFERENCES public.currencies(code),
  timezone text NOT NULL DEFAULT 'Africa/Abidjan',
  hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_stations_name ON public.stations (company_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX ix_stations_company ON public.stations (company_id, created_at);
