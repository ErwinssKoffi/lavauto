-- =============================================================================
-- LAVAUTO / WASHGUARD — SEED DATA (Données Initiales de Référence)
-- Marché Ivoirien & Zone UEMOA (Devise : FCFA / XOF)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FORMULES D'ABONNEMENT SAAS (TABLE PLANS)
-- -----------------------------------------------------------------------------

INSERT INTO plans (id, name, price_monthly, max_stations, max_employees, max_washes_per_month, features, is_trial, active)
VALUES
    ('essai', 'Essai Gratuit', 0, 1, 3, 100, '[
        "14 jours d’essai sans engagement",
        "1 station de lavage",
        "3 comptes employés",
        "100 fiches de lavage par mois",
        "Gestion de caisse & rapports"
    ]'::jsonb, TRUE, TRUE),
    ('standard', 'Standard Pro', 15000, 1, 10, 1000, '[
        "Tout ce que contient l’essai",
        "1 station de lavage",
        "10 comptes employés",
        "1 000 lavages par mois",
        "Gestion des stocks & consommables",
        "Commissions des laveurs & exports CSV"
    ]'::jsonb, FALSE, TRUE),
    ('premium', 'Premium Multi-Stations', 35000, 5, 50, 100000, '[
        "Tout ce que contient Standard",
        "Jusqu’à 5 stations de lavage",
        "50 comptes employés",
        "Lavages et fiches illimités",
        "Suivi des flottes d’entreprises",
        "Journal d’audit des opérations sensibles",
        "Support technique prioritaire"
    ]'::jsonb, FALSE, TRUE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_monthly = EXCLUDED.price_monthly,
    features = EXCLUDED.features;

-- -----------------------------------------------------------------------------
-- 2. MOYENS DE PAIEMENT DU MARCHÉ OUEST-AFRICAIN
-- -----------------------------------------------------------------------------

INSERT INTO payment_methods (code, name, is_cash, is_digital)
VALUES
    ('especes', 'Espèces (Cash)', TRUE, FALSE),
    ('orange_money', 'Orange Money Côte d''Ivoire', FALSE, TRUE),
    ('wave', 'Wave Côte d''Ivoire', FALSE, TRUE),
    ('mtn_momo', 'MTN Mobile Money', FALSE, TRUE),
    ('carte', 'Carte Bancaire (TPE)', FALSE, TRUE),
    ('virement', 'Virement Bancaire', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. EXEMPLE D'ENTREPRISE & STATION DE DÉMONSTRATION
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    demo_company_id UUID := 'a0000000-0000-0000-0000-000000000001'::uuid;
    demo_station_id UUID := 'b0000000-0000-0000-0000-000000000001'::uuid;
    cat_berline UUID := 'c0000000-0000-0000-0000-000000000001'::uuid;
    cat_suv UUID := 'c0000000-0000-0000-0000-000000000002'::uuid;
    cat_moto UUID := 'c0000000-0000-0000-0000-000000000003'::uuid;
    cat_minibus UUID := 'c0000000-0000-0000-0000-000000000004'::uuid;
    svc_ext UUID := 'd0000000-0000-0000-0000-000000000001'::uuid;
    svc_int UUID := 'd0000000-0000-0000-0000-000000000002'::uuid;
    svc_complet UUID := 'd0000000-0000-0000-0000-000000000003'::uuid;
    svc_moteur UUID := 'd0000000-0000-0000-0000-000000000004'::uuid;
    supp_id UUID := 'e0000000-0000-0000-0000-000000000001'::uuid;
BEGIN
    -- Insertion de l'entreprise
    INSERT INTO companies (id, name, legal_id, city, country, phone, email, currency, suspended)
    VALUES (
        demo_company_id,
        'Lavauto Prestige Abidjan',
        'CI-ABJ-2026-B-12845',
        'Abidjan',
        'Côte d''Ivoire',
        '+225 07 00 11 22 33',
        'contact@lavauto-prestige.ci',
        'FCFA',
        FALSE
    ) ON CONFLICT (id) DO NOTHING;

    -- Insertion de la station
    INSERT INTO stations (
        id, company_id, name, address, city, phone, currency,
        cash_requires_open, max_cashier_discount, default_commission_rate,
        monthly_target, activated, activated_at, operating_hours
    )
    VALUES (
        demo_station_id,
        demo_company_id,
        'Station Riviera Palmeraie',
        'Boulevard Mitterrand, carrefour ferronnerie',
        'Abidjan',
        '+225 05 44 55 66 77',
        'FCFA',
        TRUE,
        1000.00,
        15.00,
        2500000.00,
        TRUE,
        timezone('utc'::text, now()),
        '[
            {"day": "Lundi", "open": "07:30", "close": "19:00", "closed": false},
            {"day": "Mardi", "open": "07:30", "close": "19:00", "closed": false},
            {"day": "Mercredi", "open": "07:30", "close": "19:00", "closed": false},
            {"day": "Jeudi", "open": "07:30", "close": "19:00", "closed": false},
            {"day": "Vendredi", "open": "07:30", "close": "20:00", "closed": false},
            {"day": "Samedi", "open": "07:00", "close": "20:30", "closed": false},
            {"day": "Dimanche", "open": "08:00", "close": "18:00", "closed": false}
        ]'::jsonb
    ) ON CONFLICT (id) DO NOTHING;

    -- Postes de lavage physiques
    INSERT INTO wash_bays (station_id, name, bay_type, status)
    VALUES
        (demo_station_id, 'Poste Extérieur 1', 'exterieur', 'libre'),
        (demo_station_id, 'Poste Extérieur 2', 'exterieur', 'libre'),
        (demo_station_id, 'Poste Intérieur & Aspirateur', 'interieur', 'libre'),
        (demo_station_id, 'Box Finition & Detailing', 'detailing', 'libre')
    ON CONFLICT DO NOTHING;

    -- Catégories de véhicules
    INSERT INTO vehicle_categories (id, station_id, name, display_order, active)
    VALUES
        (cat_berline, demo_station_id, 'Berline', 1, TRUE),
        (cat_suv, demo_station_id, '4×4 / SUV / Pick-up', 2, TRUE),
        (cat_moto, demo_station_id, 'Moto / Tricycle', 3, TRUE),
        (cat_minibus, demo_station_id, 'Minibus / Utilitaire', 4, TRUE)
    ON CONFLICT (id) DO NOTHING;

    -- Catalogue de prestations
    INSERT INTO services (id, station_id, name, description, estimated_duration_min, active)
    VALUES
        (svc_ext, demo_station_id, 'Lavage Extérieur', 'Shampooing carrosserie, rinçage haute pression, jantes et séchage microfibre.', 20, TRUE),
        (svc_int, demo_station_id, 'Lavage Intérieur', 'Aspiration intégrale, dépoussiérage tableau de bord, plastiques et vitres intérieures.', 25, TRUE),
        (svc_complet, demo_station_id, 'Lavage Complet VIP', 'Extérieur mousse active + intérieur minutieux + brillance pneus + parfum habitacle.', 45, TRUE),
        (svc_moteur, demo_station_id, 'Nettoyage Moteur', 'Dégraissage compartiment moteur à sec et traitement des durites.', 35, TRUE)
    ON CONFLICT (id) DO NOTHING;

    -- Grille tarifaire (prix en FCFA)
    INSERT INTO service_prices (service_id, category_id, price)
    VALUES
        -- Lavage extérieur
        (svc_ext, cat_berline, 2000),
        (svc_ext, cat_suv, 3000),
        (svc_ext, cat_moto, 1000),
        (svc_ext, cat_minibus, 4000),
        -- Lavage intérieur
        (svc_int, cat_berline, 2000),
        (svc_int, cat_suv, 3000),
        (svc_int, cat_moto, 1000),
        (svc_int, cat_minibus, 4000),
        -- Lavage complet
        (svc_complet, cat_berline, 4000),
        (svc_complet, cat_suv, 6000),
        (svc_complet, cat_moto, 2000),
        (svc_complet, cat_minibus, 7000),
        -- Lavage moteur
        (svc_moteur, cat_berline, 3000),
        (svc_moteur, cat_suv, 4000),
        (svc_moteur, cat_moto, 1500),
        (svc_moteur, cat_minibus, 5000)
    ON CONFLICT (service_id, category_id) DO UPDATE SET price = EXCLUDED.price;

    -- Fournisseur initial
    INSERT INTO suppliers (id, company_id, name, contact_name, phone, email, address)
    VALUES (
        supp_id,
        demo_company_id,
        'Société Ivoirienne de Détergents (SID)',
        'M. Kouassi Jean',
        '+225 27 21 35 44 00',
        'commandes@sid-abidjan.com',
        'Zone Industrielle de Yopougon, Rue des Brasseries'
    ) ON CONFLICT (id) DO NOTHING;

    -- Produits en stock
    INSERT INTO products (station_id, supplier_id, name, reference, unit, unit_cost, current_stock, alert_threshold)
    VALUES
        (demo_station_id, supp_id, 'Shampooing Moussant Carrosserie Pro', 'SHAMP-50L', 'litre', 1200, 45.0, 10.0),
        (demo_station_id, supp_id, 'Dégraissant Moteur Haute Performance', 'DEG-20L', 'litre', 2500, 18.5, 5.0),
        (demo_station_id, supp_id, 'Cire de Finition & Brillance Éclair', 'CIRE-05L', 'litre', 4500, 8.0, 2.0),
        (demo_station_id, supp_id, 'Nettoyant Vitres Dégraissant', 'VITR-10L', 'litre', 900, 22.0, 5.0),
        (demo_station_id, supp_id, 'Microfibres Haute Densité 40x40', 'MCF-PACK10', 'piece', 600, 35.0, 10.0)
    ON CONFLICT DO NOTHING;

    -- Catégories de dépenses
    INSERT INTO expense_categories (company_id, name)
    VALUES
        (demo_company_id, 'Eau (SODECI)'),
        (demo_company_id, 'Électricité (CIE)'),
        (demo_company_id, 'Produits & Consommables de lavage'),
        (demo_company_id, 'Carburant pour groupe électrogène'),
        (demo_company_id, 'Maintenance matériel & Kärcher'),
        (demo_company_id, 'Salaires fixes & Primes'),
        (demo_company_id, 'Loyer du terrain'),
        (demo_company_id, 'Divers & Imprévus')
    ON CONFLICT DO NOTHING;

    -- Abonnement initial
    INSERT INTO subscriptions (company_id, plan_id, status, started_at, trial_ends_at)
    VALUES (
        demo_company_id,
        'standard',
        'active',
        timezone('utc'::text, now()),
        NULL
    ) ON CONFLICT DO NOTHING;

END $$;
