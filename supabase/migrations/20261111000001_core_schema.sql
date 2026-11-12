-- =============================================================================
-- LAVAUTO / WASHGUARD — Migration 000001: Core Database Schema
-- Multi-Tenant SaaS ERP for Car Wash Stations (Zone UEMOA / FCFA)
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ORGANISATION & ACCÈS MULTI-ENTREPRISES
-- -----------------------------------------------------------------------------

-- Entreprises clientes (Tenants SaaS)
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_id VARCHAR(100), -- Numéro RCCM ou identifiant fiscal
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'Côte d''Ivoire',
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    currency VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    suspended BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Stations de lavage (Multi-stations par entreprise)
CREATE TABLE IF NOT EXISTS stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    logo_url TEXT,
    operating_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
    cash_requires_open BOOLEAN NOT NULL DEFAULT TRUE,
    max_cashier_discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    default_commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    monthly_target NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    activated BOOLEAN NOT NULL DEFAULT FALSE,
    activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Profils utilisateurs (Liés à auth.users de Supabase)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('proprietaire', 'gerant', 'caissier', 'laveur', 'support')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    commission_rate_override NUMERIC(5, 2), -- Taux exceptionnel propre à cet employé
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Affectations des utilisateurs aux stations (Many-to-Many)
CREATE TABLE IF NOT EXISTS user_station_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, station_id)
);

-- Postes de lavage physiques (Bays)
CREATE TABLE IF NOT EXISTS wash_bays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- Ex: 'Poste Extérieur 1', 'Finition'
    bay_type VARCHAR(50) NOT NULL DEFAULT 'standard' CHECK (bay_type IN ('standard', 'exterieur', 'interieur', 'detailing', 'sechage')),
    status VARCHAR(50) NOT NULL DEFAULT 'libre' CHECK (status IN ('libre', 'occupe', 'maintenance')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 2. EXPLOITATION, VÉHICULES ET LAVAGES
-- -----------------------------------------------------------------------------

-- Catégories de véhicules
CREATE TABLE IF NOT EXISTS vehicle_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- Berline, 4x4, Moto...
    display_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Catalogue des prestations de lavage
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_duration_min INT NOT NULL DEFAULT 30,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Grille tarifaire matricielle (Prestation x Catégorie)
CREATE TABLE IF NOT EXISTS service_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(service_id, category_id)
);

-- Fiches clients (CRM)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    is_fleet BOOLEAN NOT NULL DEFAULT FALSE, -- Client entreprise / flotte
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Véhicules enregistrés
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    category_id UUID NOT NULL REFERENCES vehicle_categories(id) ON DELETE RESTRICT,
    plate VARCHAR(50) NOT NULL,
    brand VARCHAR(100),
    model VARCHAR(100),
    color VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(company_id, plate)
);

-- Fiches de lavage opérationnelles
CREATE TABLE IF NOT EXISTS washes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    number VARCHAR(50) NOT NULL, -- Ex: 'L-0042'
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(255),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    vehicle_category_id UUID NOT NULL REFERENCES vehicle_categories(id) ON DELETE RESTRICT,
    vehicle_label VARCHAR(100) NOT NULL,
    plate VARCHAR(50) NOT NULL,
    bay_id UUID REFERENCES wash_bays(id) ON DELETE SET NULL,
    employee_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
    discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
    total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
    paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'en_attente' CHECK (
        status IN ('en_attente', 'assigne', 'en_cours', 'controle_qualite', 'termine', 'livre', 'annule')
    ),
    cancelled_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Lignes de prestations figées sur le lavage
CREATE TABLE IF NOT EXISTS wash_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    service_name VARCHAR(255) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0), -- Figé à l'insertion
    qty INT NOT NULL DEFAULT 1 CHECK (qty > 0)
);

-- Historique des changements de statut du lavage
CREATE TABLE IF NOT EXISTS wash_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    changed_by UUID NOT NULL REFERENCES user_profiles(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Contrôle qualité avant restitution
CREATE TABLE IF NOT EXISTS wash_quality_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    inspector_id UUID NOT NULL REFERENCES user_profiles(id),
    exterior_clean BOOLEAN NOT NULL DEFAULT TRUE,
    interior_clean BOOLEAN NOT NULL DEFAULT TRUE,
    windows_clean BOOLEAN NOT NULL DEFAULT TRUE,
    rims_clean BOOLEAN NOT NULL DEFAULT TRUE,
    mats_clean BOOLEAN NOT NULL DEFAULT TRUE,
    approved BOOLEAN NOT NULL DEFAULT TRUE,
    observations TEXT,
    inspected_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 3. CAISSE, PAIEMENTS & FINANCES
-- -----------------------------------------------------------------------------

-- Sessions de caisse physique (Espèces)
CREATE TABLE IF NOT EXISTS cash_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    opened_by_user_id UUID NOT NULL REFERENCES user_profiles(id),
    opened_by_name VARCHAR(255) NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    opening_float NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (opening_float >= 0),
    closed_at TIMESTAMPTZ,
    closed_by_user_id UUID REFERENCES user_profiles(id),
    closed_by_name VARCHAR(255),
    counted_amount NUMERIC(12, 2) CHECK (counted_amount >= 0),
    theoretical_amount NUMERIC(12, 2),
    difference_amount NUMERIC(12, 2),
    status VARCHAR(50) NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte', 'cloturee')),
    reopened_at TIMESTAMPTZ,
    reopen_reason TEXT
);

-- Moyens de paiement configurables
CREATE TABLE IF NOT EXISTS payment_methods (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_cash BOOLEAN NOT NULL DEFAULT FALSE,
    is_digital BOOLEAN NOT NULL DEFAULT TRUE
);

-- Transactions de paiement
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method VARCHAR(50) NOT NULL REFERENCES payment_methods(code),
    transaction_reference VARCHAR(100), -- Réf Mobile Money ou reçu carte
    collected_by_user_id UUID NOT NULL REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Catégories de dépenses
CREATE TABLE IF NOT EXISTS expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Dépenses d'exploitation (Charges)
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    category VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    supplier VARCHAR(255),
    date DATE NOT NULL,
    method VARCHAR(50) NOT NULL REFERENCES payment_methods(code),
    receipt_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'enregistree' CHECK (status IN ('enregistree', 'annulee')),
    cancel_reason TEXT,
    created_by_user_id UUID NOT NULL REFERENCES user_profiles(id),
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 4. RESSOURCES HUMAINES & COMMISSIONS
-- -----------------------------------------------------------------------------

-- Relevés périodiques des commissions laveurs (figés)
CREATE TABLE IF NOT EXISTS commission_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    period_type VARCHAR(50) NOT NULL CHECK (period_type IN ('semaine', 'quinzaine', 'mois')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_commission NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte', 'validee', 'payee')),
    validated_by UUID REFERENCES user_profiles(id),
    validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Lignes de paiement des commissions par laveur
CREATE TABLE IF NOT EXISTS commission_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID NOT NULL REFERENCES commission_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES user_profiles(id),
    washes_count INT NOT NULL DEFAULT 0,
    revenue_base NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    rate_applied NUMERIC(5, 2) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    is_override BOOLEAN NOT NULL DEFAULT FALSE,
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at TIMESTAMPTZ
);

-- Présences et pointages
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES user_profiles(id),
    work_date DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'retard', 'absent_justifie', 'absent_injustifie')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 5. STOCKS, PRODUITS & APPROVISIONNEMENTS
-- -----------------------------------------------------------------------------

-- Catégories de produits consommables
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL
);

-- Fournisseurs de consommables et pièces
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Catalogue des produits en stock
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    reference VARCHAR(100),
    unit VARCHAR(50) NOT NULL, -- 'ml', 'litre', 'piece', 'kg'
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (unit_cost >= 0),
    current_stock NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    alert_threshold NUMERIC(12, 2) NOT NULL DEFAULT 5.00,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Recettes de consommation théorique par prestation
CREATE TABLE IF NOT EXISTS service_recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    theoretical_quantity NUMERIC(10, 3) NOT NULL CHECK (theoretical_quantity > 0),
    UNIQUE(service_id, category_id, product_id)
);

-- Commandes d'approvisionnement fournisseur
CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    order_number VARCHAR(50) NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'commandee', 'recue_partielle', 'recue_totale', 'annulee')),
    ordered_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Lignes de commandes d'approvisionnement
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity_ordered NUMERIC(10, 2) NOT NULL CHECK (quantity_ordered > 0),
    quantity_received NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (quantity_received >= 0),
    unit_cost NUMERIC(12, 2) NOT NULL CHECK (unit_cost >= 0)
);

-- Mouvements de stock traçables (Entrées / Sorties / Ajustements)
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    movement_type VARCHAR(50) NOT NULL CHECK (
        movement_type IN ('reception_commande', 'consommation_lavage', 'ajustement_inventaire', 'perte_avarie')
    ),
    quantity NUMERIC(10, 3) NOT NULL, -- Positif pour entrée, négatif pour sortie
    wash_id UUID REFERENCES washes(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    notes TEXT,
    created_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 6. SAAS, ABONNEMENTS ET JOURNAL D'AUDIT
-- -----------------------------------------------------------------------------

-- Formules d'abonnement SaaS
CREATE TABLE IF NOT EXISTS plans (
    id VARCHAR(50) PRIMARY KEY, -- 'essai', 'standard', 'premium'
    name VARCHAR(100) NOT NULL,
    price_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    max_stations INT NOT NULL DEFAULT 1,
    max_employees INT NOT NULL DEFAULT 3,
    max_washes_per_month INT NOT NULL DEFAULT 100,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_trial BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Abonnements des entreprises clientes
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'essai' CHECK (status IN ('essai', 'active', 'en_attente', 'suspendue')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    trial_ends_at TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    pending_plan_id VARCHAR(50) REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Journal d'audit immuable des actions sensibles
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    actor_name VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    detail TEXT NOT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- -----------------------------------------------------------------------------
-- 7. INDEX B-TREE OPTIMISÉS
-- -----------------------------------------------------------------------------

-- Clés étrangères & filtrages fréquents
CREATE INDEX IF NOT EXISTS idx_stations_company_id ON stations(company_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_company_id ON user_profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_washes_station_id ON washes(station_id);
CREATE INDEX IF NOT EXISTS idx_washes_created_at ON washes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_washes_status ON washes(status);
CREATE INDEX IF NOT EXISTS idx_washes_plate ON washes(plate);
CREATE INDEX IF NOT EXISTS idx_washes_employee_id ON washes(employee_id);
CREATE INDEX IF NOT EXISTS idx_payments_station_id ON payments(station_id);
CREATE INDEX IF NOT EXISTS idx_payments_wash_id ON payments(wash_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_station_status ON cash_sessions(station_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_station_id ON expenses(station_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_at ON audit_logs(company_id, created_at DESC);
