-- =============================================================================
-- LAVAUTO / WASHGUARD — Migration 000003: Functions, Triggers & Financial Invariants
-- Business Invariants: Immutability, Automatic Totals & Stock Sync
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DÉCLENCHEUR GÉNÉRAL DE MISE À JOUR AUTOMATIQUE (UPDATED_AT)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_stations_updated_at ON stations;
CREATE TRIGGER trg_stations_updated_at
    BEFORE UPDATE ON stations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_service_prices_updated_at ON service_prices;
CREATE TRIGGER trg_service_prices_updated_at
    BEFORE UPDATE ON service_prices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_washes_updated_at ON washes;
CREATE TRIGGER trg_washes_updated_at
    BEFORE UPDATE ON washes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. RÈGLE MÉTIER 1 : RECALCUL AUTOMATIQUE DES ENCAISSEMENTS SUR LA FICHE
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_wash_payment_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_wash_id UUID;
    total_collected NUMERIC(12, 2);
    wash_total NUMERIC(12, 2);
    current_status VARCHAR(50);
BEGIN
    target_wash_id := COALESCE(NEW.wash_id, OLD.wash_id);

    -- Calcul de la somme réelle des paiements
    SELECT COALESCE(SUM(amount), 0.00) INTO total_collected
    FROM payments
    WHERE wash_id = target_wash_id;

    -- Récupération du total et du statut actuel de la fiche
    SELECT total, status INTO wash_total, current_status
    FROM washes
    WHERE id = target_wash_id;

    -- Mise à jour du montant payé
    UPDATE washes
    SET paid = total_collected,
        -- Si payé intégralement et encore en attente, bascule automatique en cours
        status = CASE
            WHEN total_collected >= wash_total AND current_status = 'en_attente' THEN 'en_cours'
            ELSE status
        END,
        updated_at = timezone('utc'::text, now())
    WHERE id = target_wash_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_sync_wash ON payments;
CREATE TRIGGER trg_payments_sync_wash
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION sync_wash_payment_totals();

-- -----------------------------------------------------------------------------
-- 3. RÈGLE MÉTIER 2 : IMMUTABILITÉ DES PRESTATIONS DES LAVAGES TERMINÉS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_completed_wash_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status VARCHAR(50);
BEGIN
    SELECT status INTO parent_status FROM washes WHERE id = COALESCE(NEW.wash_id, OLD.wash_id);

    IF parent_status IN ('termine', 'livre', 'annule') THEN
        RAISE EXCEPTION 'Impossible de modifier les prestations d’un lavage déjà terminé ou archivé.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wash_items_immutability ON wash_items;
CREATE TRIGGER trg_wash_items_immutability
    BEFORE UPDATE OR DELETE ON wash_items
    FOR EACH ROW EXECUTE FUNCTION prevent_completed_wash_tampering();

-- -----------------------------------------------------------------------------
-- 4. RÈGLE MÉTIER 3 : VÉRIFICATION DE LA CAISSE POUR PAIEMENTS EN ESPÈCES
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_cash_session_rule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    requires_open BOOLEAN;
    has_open_session BOOLEAN;
    open_session_id UUID;
BEGIN
    -- S'applique uniquement aux paiements en espèces
    IF NEW.method = 'especes' THEN
        SELECT cash_requires_open INTO requires_open
        FROM stations WHERE id = NEW.station_id;

        IF requires_open THEN
            SELECT EXISTS (
                SELECT 1 FROM cash_sessions
                WHERE station_id = NEW.station_id AND status = 'ouverte'
            ), id INTO has_open_session, open_session_id
            FROM cash_sessions
            WHERE station_id = NEW.station_id AND status = 'ouverte'
            LIMIT 1;

            IF NOT has_open_session THEN
                RAISE EXCEPTION 'Un encaissement en espèces exige une caisse ouverte pour cette station.'
                    USING ERRCODE = 'check_violation';
            END IF;

            -- Rattachement automatique de la session de caisse si non spécifiée
            IF NEW.cash_session_id IS NULL THEN
                NEW.cash_session_id := open_session_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_cash_rule ON payments;
CREATE TRIGGER trg_payments_cash_rule
    BEFORE INSERT ON payments
    FOR EACH ROW EXECUTE FUNCTION check_cash_session_rule();

-- -----------------------------------------------------------------------------
-- 5. RÈGLE MÉTIER 4 : GESTION AUTOMATIQUE DU STOCK SUR MOUVEMENTS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE products
    SET current_stock = current_stock + NEW.quantity,
        updated_at = timezone('utc'::text, now())
    WHERE id = NEW.product_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_apply ON stock_movements;
CREATE TRIGGER trg_stock_movements_apply
    AFTER INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- -----------------------------------------------------------------------------
-- 6. RÈGLE MÉTIER 5 : INTÉGRITÉ DE CLÔTURE DE CAISSE (CALCUL ÉCART)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION finalize_cash_session_closing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cash_in NUMERIC(12, 2);
    cash_out NUMERIC(12, 2);
BEGIN
    -- Se déclenche uniquement au passage à 'cloturee'
    IF NEW.status = 'cloturee' AND OLD.status = 'ouverte' THEN
        -- Somme des paiements espèces enregistrés pendant la session
        SELECT COALESCE(SUM(amount), 0.00) INTO cash_in
        FROM payments
        WHERE cash_session_id = NEW.id AND method = 'especes';

        -- Somme des dépenses espèces enregistrées pendant la session
        SELECT COALESCE(SUM(amount), 0.00) INTO cash_out
        FROM expenses
        WHERE cash_session_id = NEW.id AND method = 'especes' AND status = 'enregistree';

        -- Solde théorique = Fond initial + Encaissements espèces - Décaissements espèces
        NEW.theoretical_amount := NEW.opening_float + cash_in - cash_out;
        NEW.difference_amount := COALESCE(NEW.counted_amount, 0.00) - NEW.theoretical_amount;
        NEW.closed_at := timezone('utc'::text, now());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_sessions_finalize ON cash_sessions;
CREATE TRIGGER trg_cash_sessions_finalize
    BEFORE UPDATE ON cash_sessions
    FOR EACH ROW EXECUTE FUNCTION finalize_cash_session_closing();
