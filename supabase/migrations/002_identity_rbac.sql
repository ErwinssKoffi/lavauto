-- 002 — Identité, RBAC et helpers de sécurité (Prompt 03)
-- Le company_id est TOUJOURS dérivé de auth.uid(), jamais fourni par le client.
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z_]+$'),
  label_fr text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_roles_system ON public.roles (key) WHERE company_id IS NULL;
CREATE UNIQUE INDEX uq_roles_company ON public.roles (company_id, key) WHERE company_id IS NOT NULL;

CREATE TABLE public.permissions (
  key text PRIMARY KEY,
  label_fr text NOT NULL,
  domain text NOT NULL
);

CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  role_id uuid NOT NULL REFERENCES public.roles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_profiles_email ON public.user_profiles (lower(email));
CREATE INDEX ix_profiles_company ON public.user_profiles (company_id, created_at);

CREATE TABLE public.user_station_assignments (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, station_id)
);
CREATE INDEX ix_assignments_station ON public.user_station_assignments (company_id, station_id);

CREATE TABLE public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES public.roles(id),
  station_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES public.user_profiles(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Le super admin SaaS est HORS company_id : mécanisme séparé, pas un faux tenant.
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid
);

-- Journal append-only (aucun UPDATE/DELETE possible, voir 010).
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  station_id uuid REFERENCES public.stations(id),
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_company ON public.audit_logs (company_id, created_at DESC);

-- Référentiel RBAC (configuration, pas donnée d'exemple).
INSERT INTO public.roles (key, label_fr, is_system)
SELECT v.key, v.label, true FROM (VALUES
  ('owner', 'Propriétaire'), ('manager', 'Gérant'), ('cashier', 'Caissier'),
  ('washer', 'Laveur'), ('super_admin', 'Super admin SaaS')
) AS v(key, label)
WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.company_id IS NULL AND r.key = v.key);

INSERT INTO public.permissions (key, label_fr, domain)
SELECT v.key, v.label, split_part(v.key, '.', 1) FROM (VALUES
  ('washes.view', 'Consulter les lavages'), ('washes.create', 'Créer une fiche'),
  ('washes.update_status', 'Changer le statut'), ('washes.assign', 'Affecter un laveur'),
  ('washes.quality', 'Contrôle qualité'), ('customers.view', 'Consulter les clients'),
  ('customers.manage', 'Gérer les clients'), ('catalog.manage', 'Gérer le catalogue'),
  ('payments.create', 'Encaisser'), ('payments.cancel', 'Annuler un encaissement'),
  ('cash.open', 'Ouvrir la caisse'), ('cash.close', 'Clôturer la caisse'),
  ('cash.reopen', 'Réouvrir la caisse'), ('expenses.create', 'Enregistrer une dépense'),
  ('expenses.cancel', 'Annuler une dépense'), ('reports.view', 'Consulter les rapports'),
  ('commissions.view', 'Consulter les commissions'), ('commissions.validate', 'Valider une période'),
  ('employees.manage', 'Gérer les employés'), ('inventory.view', 'Consulter le stock'),
  ('inventory.receive', 'Réceptionner une commande'), ('inventory.consume', 'Consommer des produits'),
  ('inventory.adjust', 'Ajuster le stock'), ('settings.manage', 'Gérer les paramètres'),
  ('subscription.manage', 'Gérer l’abonnement'), ('audit.view', 'Consulter le journal')
) AS v(key, label) ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.key FROM public.roles r CROSS JOIN public.permissions p
WHERE r.company_id IS NULL AND (
  r.key IN ('owner', 'manager')
  OR (r.key = 'cashier' AND p.key IN ('washes.view','washes.create','washes.update_status','customers.view','customers.manage','payments.create','cash.open','cash.close','expenses.create'))
  OR (r.key = 'washer' AND p.key IN ('washes.view','washes.update_status','washes.quality'))
) ON CONFLICT DO NOTHING;

-- Helpers SECURITY DEFINER : search_path figé, aucune récursion RLS.
CREATE OR REPLACE FUNCTION public.current_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT company_id FROM public.user_profiles WHERE id = auth.uid() AND active = true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_access_station(p_station_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = auth.uid() AND p.active = true AND (
      EXISTS (SELECT 1 FROM public.roles r WHERE r.id = p.role_id AND r.key IN ('owner','manager'))
      OR EXISTS (SELECT 1 FROM public.user_station_assignments a WHERE a.user_id = p.id AND a.station_id = p_station_id)
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.user_profiles p
    JOIN public.role_permissions rp ON rp.role_id = p.role_id
    WHERE p.id = auth.uid() AND p.active = true AND rp.permission_id = p_key
  )
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.enforce_company_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid := public.current_company_id();
BEGIN
  IF v IS NOT NULL THEN
    IF NEW.company_id IS DISTINCT FROM v THEN
      RAISE EXCEPTION 'company_id imposé par le serveur (reçu %, attendu %)', NEW.company_id, v USING ERRCODE = '42501';
    END IF;
    NEW.company_id := v;
  ELSIF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id manquant : aucune session entreprise' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assert_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historique immuable : % interdit sur %', TG_OP, TG_TABLE_NAME USING ERRCODE = '55000';
END $$;
