-- =============================================================================
-- LAVAUTO / WASHGUARD — Migration 000002: Row Level Security (RLS) Policies
-- Strict Multi-Tenant Isolation & Role-Based Access Control (RBAC)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FONCTIONS DE SÉCURITÉ OPTIMISÉES (SECURITY DEFINER)
-- -----------------------------------------------------------------------------

-- Récupération du company_id de l'utilisateur authentifié sans récursion
CREATE OR REPLACE FUNCTION get_auth_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT company_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Récupération du rôle de l'utilisateur authentifié
CREATE OR REPLACE FUNCTION get_auth_user_role()
RETURNS VARCHAR
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Vérification si l'utilisateur est Super Administrateur support
CREATE OR REPLACE FUNCTION is_support_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'support'
    );
$$;

-- Vérification de l'accès à une station spécifique
CREATE OR REPLACE FUNCTION user_has_station_access(target_station_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM stations s
        JOIN user_profiles u ON u.company_id = s.company_id
        WHERE s.id = target_station_id
          AND u.id = auth.uid()
          AND (
              u.role = 'proprietaire'
              OR EXISTS (
                  SELECT 1 FROM user_station_assignments a
                  WHERE a.user_id = u.id AND a.station_id = target_station_id
              )
          )
    );
$$;

-- -----------------------------------------------------------------------------
-- 2. ACTIVATION DU ROW LEVEL SECURITY SUR TOUTES LES TABLES
-- -----------------------------------------------------------------------------

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_station_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wash_bays ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE washes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wash_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wash_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wash_quality_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. POLITIQUES D'ISOLATION MULTI-ENTREPRISES (COMPANIES & STATIONS)
-- -----------------------------------------------------------------------------

-- Entreprises : consultation et modification de sa propre entreprise
CREATE POLICY "companies_tenant_isolation" ON companies
    FOR ALL
    USING (id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (id = get_auth_company_id() OR is_support_admin());

-- Stations : consultation et gestion des stations de son entreprise
CREATE POLICY "stations_tenant_isolation" ON stations
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

-- Profils utilisateurs : visible pour tous les membres de la même entreprise
CREATE POLICY "user_profiles_tenant_isolation" ON user_profiles
    FOR SELECT
    USING (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "user_profiles_manage" ON user_profiles
    FOR ALL
    USING (
        (company_id = get_auth_company_id() AND get_auth_user_role() = 'proprietaire')
        OR id = auth.uid()
        OR is_support_admin()
    )
    WITH CHECK (
        (company_id = get_auth_company_id() AND get_auth_user_role() = 'proprietaire')
        OR id = auth.uid()
        OR is_support_admin()
    );

-- -----------------------------------------------------------------------------
-- 4. POLITIQUES POUR LES LAVAGES & LE CYCLE DE VIE
-- -----------------------------------------------------------------------------

CREATE POLICY "washes_tenant_isolation" ON washes
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "wash_items_isolation" ON wash_items
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM washes w
            WHERE w.id = wash_items.wash_id
              AND (w.company_id = get_auth_company_id() OR is_support_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM washes w
            WHERE w.id = wash_items.wash_id
              AND (w.company_id = get_auth_company_id() OR is_support_admin())
        )
    );

CREATE POLICY "wash_quality_checks_isolation" ON wash_quality_checks
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM washes w
            WHERE w.id = wash_quality_checks.wash_id
              AND (w.company_id = get_auth_company_id() OR is_support_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM washes w
            WHERE w.id = wash_quality_checks.wash_id
              AND (w.company_id = get_auth_company_id() OR is_support_admin())
        )
    );

-- -----------------------------------------------------------------------------
-- 5. POLITIQUES FINANCIÈRES & CAISSE
-- -----------------------------------------------------------------------------

CREATE POLICY "cash_sessions_isolation" ON cash_sessions
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

CREATE POLICY "payments_isolation" ON payments
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "expenses_isolation" ON expenses
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "commissions_isolation" ON commission_periods
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

CREATE POLICY "commission_payouts_isolation" ON commission_payouts
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM commission_periods cp
            WHERE cp.id = commission_payouts.period_id
              AND (user_has_station_access(cp.station_id) OR is_support_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM commission_periods cp
            WHERE cp.id = commission_payouts.period_id
              AND (user_has_station_access(cp.station_id) OR is_support_admin())
        )
    );

-- -----------------------------------------------------------------------------
-- 6. POLITIQUES CATALOGUE & CLIENTS (CRM)
-- -----------------------------------------------------------------------------

CREATE POLICY "vehicle_categories_isolation" ON vehicle_categories
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

CREATE POLICY "services_isolation" ON services
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

CREATE POLICY "service_prices_isolation" ON service_prices
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM services s
            WHERE s.id = service_prices.service_id
              AND (user_has_station_access(s.station_id) OR is_support_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM services s
            WHERE s.id = service_prices.service_id
              AND (user_has_station_access(s.station_id) OR is_support_admin())
        )
    );

CREATE POLICY "customers_isolation" ON customers
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "vehicles_isolation" ON vehicles
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

-- -----------------------------------------------------------------------------
-- 7. POLITIQUES STOCKS & APPROVISIONNEMENTS
-- -----------------------------------------------------------------------------

CREATE POLICY "products_isolation" ON products
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

CREATE POLICY "stock_movements_isolation" ON stock_movements
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

CREATE POLICY "suppliers_isolation" ON suppliers
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "purchase_orders_isolation" ON purchase_orders
    FOR ALL
    USING (user_has_station_access(station_id) OR is_support_admin())
    WITH CHECK (user_has_station_access(station_id) OR is_support_admin());

-- -----------------------------------------------------------------------------
-- 8. POLITIQUES ABONNEMENTS & AUDIT
-- -----------------------------------------------------------------------------

CREATE POLICY "subscriptions_isolation" ON subscriptions
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "audit_logs_read" ON audit_logs
    FOR SELECT
    USING (company_id = get_auth_company_id() OR is_support_admin());

CREATE POLICY "audit_logs_insert" ON audit_logs
    FOR INSERT
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());
