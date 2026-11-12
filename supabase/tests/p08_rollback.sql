-- Test d'intégration Prompt 08 — À EXÉCUTER DANS UNE TRANSACTION AVEC ROLLBACK.
-- Aucune donnée persistée : 2 comptes Auth temporaires, 2 entreprises, 2 stations,
-- 2 clients, 1 véhicule, 4 fiches, 1 programme / carte de fidélité, 3 forfaits,
-- 3 promotions, 1 flotte, 2 contrats, 1 créance et 2 notifications en attente.
-- Aucun fournisseur, aucun envoi simulé, aucun compte/e-mail/secret réel.
BEGIN;
CREATE TEMP TABLE p08_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE p08_result (label text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON p08_ids, p08_result TO authenticated;

INSERT INTO p08_result VALUES
  ('038 appliquee : 38 migrations, 0 fixture metier',
    (SELECT count(*) FROM supabase_migrations.schema_migrations) = 38 AND
    (SELECT count(*) FROM public.customers) = 0 AND
    (SELECT count(*) FROM public.loyalty_cards) = 0 AND
    (SELECT count(*) FROM public.packages) = 0 AND
    (SELECT count(*) FROM public.promotions) = 0 AND
    (SELECT count(*) FROM public.fleets) = 0 AND
    (SELECT count(*) FROM public.notification_outbox) = 0 AND
    (SELECT count(*) FROM public.washes) = 0,
    'schema_migrations=38, tables CRM vides'),
  ('P08 : 13 tables, 18 RPC, board SECURITY DEFINER, aucun grant anon',
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN
      ('loyalty_programs','loyalty_cards','loyalty_transactions','packages','customer_packages',
       'package_usages','promotions','promotion_usages','fleets','fleet_contracts',
       'fleet_vehicles','fleet_receivables','notification_outbox')) = 13 AND
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('save_customer_profile','save_customer_vehicle','create_loyalty_program',
        'enroll_loyalty_customer','record_loyalty_transaction','accrue_loyalty_for_wash',
        'save_package_plan','sell_package_to_customer','consume_package_for_wash',
        'save_promotion','apply_promotion_to_wash','save_fleet','save_fleet_contract',
        'attach_fleet_vehicle','record_fleet_receivable','enqueue_notification',
        'cancel_pending_notification','my_crm_board')) = 18 AND
    (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='my_crm_board') AND
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('my_crm_board','save_customer_profile','apply_promotion_to_wash','enqueue_notification')
        AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 0,
    '034-038 : fondation, commandes, board, notifications, correctif idempotence'),
  ('P08 : 43 permissions, 102 liaisons, ecritures directes revokées',
    (SELECT count(*) FROM public.permissions) = 43 AND
    (SELECT count(*) FROM public.role_permissions) = 102 AND
    NOT has_table_privilege('authenticated','public.customers','INSERT') AND
    NOT has_table_privilege('authenticated','public.notification_outbox','UPDATE') AND
    NOT has_table_privilege('authenticated','public.promotion_usages','DELETE'),
    'REVOKE sur clients, vehicules et tables P08'),
  ('P08 : fiches client, vehicules et lavages enrichis',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='customers'
      AND column_name IN ('customer_type','preferred_channel','loyalty_opt_in','fleet_id')) = 4 AND
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicles'
      AND column_name IN ('fleet_id','is_active')) = 2 AND
    (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='washes'
      AND column_name IN ('promotion_id','promotion_discount_minor','package_id','fleet_contract_id',
        'loyalty_points_earned','loyalty_points_redeemed')) = 6,
    'extension additive de 004 sans reecriture');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('66666666-6666-4666-8666-666666666666', 'p08-a@test.invalid',
   jsonb_build_object('company_name','Tenant P08 A','station_name','Station P08 A','owner_name','Owner P08 A')),
  ('77777777-7777-4777-8777-777777777777', 'p08-b@test.invalid',
   jsonb_build_object('company_name','Tenant P08 B','station_name','Station P08 B','owner_name','Owner P08 B'));

INSERT INTO p08_ids VALUES
  ('userA','66666666-6666-4666-8666-666666666666'),
  ('userB','77777777-7777-4777-8777-777777777777'),
  ('catA','cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('wash1','dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  ('wash2','dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  ('wash3','dddddddd-dddd-4ddd-8ddd-ddddddddddd3'),
  ('wash4','dddddddd-dddd-4ddd-8ddd-ddddddddddd4');
INSERT INTO p08_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = '66666666-6666-4666-8666-666666666666';
INSERT INTO p08_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = '77777777-7777-4777-8777-777777777777';
INSERT INTO p08_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = '66666666-6666-4666-8666-666666666666';
INSERT INTO p08_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = '77777777-7777-4777-8777-777777777777';

UPDATE public.stations SET activated = true,
  settings = jsonb_build_object('commission_rate', 10)
WHERE id IN (SELECT v FROM p08_ids WHERE k IN ('stA','stB'));

INSERT INTO public.vehicle_categories (id, company_id, station_id, name)
VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  (SELECT v FROM p08_ids WHERE k='coA'), (SELECT v FROM p08_ids WHERE k='stA'), 'Berline P08');

SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);

-- Fiche client enrichie, véhicule, puis 4 fiches de lavage du tenant A.
INSERT INTO p08_ids SELECT 'cliA', public.save_customer_profile(
  p_station_id => (SELECT v FROM p08_ids WHERE k='stA'),
  p_name => 'Client P08 A', p_phone => '+2250700000001',
  p_email => 'client-a@test.invalid', p_notes => 'Fiche enrichie P08',
  p_channel => 'email', p_loyalty_opt_in => true);
INSERT INTO p08_ids SELECT 'cliNone', public.save_customer_profile(
  p_station_id => (SELECT v FROM p08_ids WHERE k='stA'),
  p_name => 'Client sans canal', p_phone => '', p_email => '',
  p_notes => '', p_channel => 'none', p_loyalty_opt_in => false);
INSERT INTO p08_ids SELECT 'vehA', public.save_customer_vehicle(
  p_station_id => (SELECT v FROM p08_ids WHERE k='stA'),
  p_customer_id => (SELECT v FROM p08_ids WHERE k='cliA'),
  p_plate => '1234 AB 01', p_brand => 'Toyota', p_model => 'Corolla',
  p_color => 'Blanc', p_category_id => (SELECT v FROM p08_ids WHERE k='catA'));

INSERT INTO public.washes (id, company_id, station_id, number, customer_id,
  customer_name, vehicle_category_id, vehicle_label, plate, discount_minor,
  total_minor, paid_minor, status)
SELECT k.v, (SELECT v FROM p08_ids WHERE k='coA'), (SELECT v FROM p08_ids WHERE k='stA'),
  n.num, (SELECT v FROM p08_ids WHERE k='cliA'), 'Client P08 A',
  (SELECT v FROM p08_ids WHERE k='catA'), 'Berline P08', '1234 AB 01',
  0, 5000, 0, 'pending'
FROM (VALUES ('wash1','P08-001'),('wash2','P08-002'),('wash3','P08-003'),('wash4','P08-004')) AS n(k, num)
JOIN p08_ids k ON k.k = n.k;

INSERT INTO p08_result VALUES
  ('CRM : fiche client enrichie, canal e-mail et vehicule rattache',
    (SELECT preferred_channel FROM public.customers WHERE id=(SELECT v FROM p08_ids WHERE k='cliA')) = 'email' AND
    (SELECT loyalty_opt_in FROM public.customers WHERE id=(SELECT v FROM p08_ids WHERE k='cliA')) AND
    (SELECT communication_preferences->>'channel' FROM public.customers WHERE id=(SELECT v FROM p08_ids WHERE k='cliA')) = 'email' AND
    (SELECT count(*) FROM public.vehicles WHERE customer_id=(SELECT v FROM p08_ids WHERE k='cliA')) = 1,
    'RPC save_customer_profile + save_customer_vehicle');

-- Fidélité : programme, carte, transaction manuelle idempotente, rachat, solde insuffisant.
INSERT INTO p08_ids SELECT 'progA', public.create_loyalty_program(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Programme P08', 2, 50, true);
INSERT INTO p08_ids SELECT 'cardA', public.enroll_loyalty_customer(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
  (SELECT v FROM p08_ids WHERE k='progA'), 'LC-P08-A');
INSERT INTO p08_ids SELECT 'txA', public.record_loyalty_transaction(
  (SELECT v FROM p08_ids WHERE k='cardA'), 'earn', 10, 'Ajustement initial', NULL, 'loyalty-manual-1');
INSERT INTO p08_ids SELECT 'txDup', public.record_loyalty_transaction(
  (SELECT v FROM p08_ids WHERE k='cardA'), 'earn', 10, 'Ajustement initial', NULL, 'loyalty-manual-1');
SELECT public.record_loyalty_transaction(
  (SELECT v FROM p08_ids WHERE k='cardA'), 'redeem', -3, 'Rachat partiel', NULL, 'loyalty-redeem-1');
DO $$ BEGIN
  BEGIN
    PERFORM public.record_loyalty_transaction(
      (SELECT v FROM p08_ids WHERE k='cardA'), 'redeem', -999, 'Solde insuffisant', NULL, 'loyalty-redeem-too-much');
    INSERT INTO p08_result VALUES ('fidelite : solde insuffisant refuse', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('fidelite : solde insuffisant refuse', true, '23514');
  END;
END $$;
INSERT INTO p08_result VALUES
  ('fidelite : transaction idempotente, solde 7 apres earn 10 / redeem -3',
    (SELECT v FROM p08_ids WHERE k='txA') = (SELECT v FROM p08_ids WHERE k='txDup') AND
    (SELECT points_balance FROM public.loyalty_cards WHERE id=(SELECT v FROM p08_ids WHERE k='cardA')) = 7,
    'cle loyalty-manual-1 rejouee sans double mouvement');

-- Forfaits : conditions de fenêtre, vente idempotente, consommation, expiration.
INSERT INTO p08_ids SELECT 'pkgA', public.save_package_plan(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Forfait P08', 10000, 2, 30,
  current_date - 10, current_date + 10, true);
DO $$ BEGIN
  BEGIN
    PERFORM public.sell_package_to_customer(
      (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
      (SELECT v FROM p08_ids WHERE k='pkgA'), current_date - 20, 'pkg-before');
    INSERT INTO p08_result VALUES ('forfait : achat avant ouverture refuse', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('forfait : achat avant ouverture refuse', true, '23514');
  END;
  BEGIN
    PERFORM public.sell_package_to_customer(
      (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
      (SELECT v FROM p08_ids WHERE k='pkgA'), current_date + 20, 'pkg-after');
    INSERT INTO p08_result VALUES ('forfait : achat apres fermeture refuse', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('forfait : achat apres fermeture refuse', true, '23514');
  END;
  BEGIN
    PERFORM public.save_package_plan(
      (SELECT v FROM p08_ids WHERE k='stA'), 'Forfait invalide', 1000, 0, 30,
      current_date, current_date + 10, true);
    INSERT INTO p08_result VALUES ('forfait : conditions invalides refusees', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('forfait : conditions invalides refusees', true, '23514');
  END;
END $$;
INSERT INTO p08_ids SELECT 'cpA', public.sell_package_to_customer(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
  (SELECT v FROM p08_ids WHERE k='pkgA'), current_date, 'pkg-sale-1');
INSERT INTO p08_ids SELECT 'cpDup', public.sell_package_to_customer(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
  (SELECT v FROM p08_ids WHERE k='pkgA'), current_date, 'pkg-sale-1');
INSERT INTO p08_ids SELECT 'pkgExpiredPlan', public.save_package_plan(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Forfait expire', 5000, 5, 30,
  current_date - 100, current_date - 50, true);
DO $$ BEGIN
  BEGIN
    PERFORM public.sell_package_to_customer(
      (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
      (SELECT v FROM p08_ids WHERE k='pkgExpiredPlan'), current_date, 'pkg-expired-sale');
    INSERT INTO p08_result VALUES ('forfait : plan expire non vendable', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('forfait : plan expire non vendable', true, '23514');
  END;
END $$;
DO $$
DECLARE v1 jsonb; v2 jsonb; v3 jsonb;
BEGIN
  v1 := public.consume_package_for_wash((SELECT v FROM p08_ids WHERE k='wash1'));
  v2 := public.consume_package_for_wash((SELECT v FROM p08_ids WHERE k='wash1'));
  INSERT INTO p08_result VALUES
    ('forfait : consommation une seule fois par fiche',
      (v1->>'consumed')::boolean AND (v1->>'remaining')::integer = 1 AND
      (v2->>'duplicate')::boolean AND
      (SELECT count(*) FROM public.package_usages) = 1,
      'wash1 : 2 -> 1, second appel duplicate=true');
  v3 := public.consume_package_for_wash((SELECT v FROM p08_ids WHERE k='wash2'));
  INSERT INTO p08_result VALUES
    ('forfait : deux lavages consomment le solde puis epuisent le forfait',
      (v3->>'consumed')::boolean AND (v3->>'remaining')::integer = 0 AND
      (SELECT washes_remaining FROM public.customer_packages WHERE id=(SELECT v FROM p08_ids WHERE k='cpA')) = 0 AND
      (SELECT status FROM public.customer_packages WHERE id=(SELECT v FROM p08_ids WHERE k='cpA')) = 'exhausted' AND
      (SELECT count(*) FROM public.package_usages) = 2,
      'wash2 : 1 -> 0, status exhausted');
END $$;
INSERT INTO p08_ids SELECT 'pkgB', public.save_package_plan(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Forfait expire cote client', 5000, 5, 30,
  current_date - 10, current_date + 10, true);
INSERT INTO p08_ids SELECT 'cpExpired', public.sell_package_to_customer(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='cliA'),
  (SELECT v FROM p08_ids WHERE k='pkgB'), current_date, 'pkg-sale-2');
UPDATE public.customer_packages
SET purchased_at = current_date - 2, expires_at = current_date - 1, status = 'expired'
WHERE id = (SELECT v FROM p08_ids WHERE k='cpExpired');
DO $$
DECLARE res jsonb;
BEGIN
  res := public.consume_package_for_wash((SELECT v FROM p08_ids WHERE k='wash3'));
  INSERT INTO p08_result VALUES
    ('forfait : expiration et conditions de validite respectees',
      (SELECT v FROM p08_ids WHERE k='cpA') = (SELECT v FROM p08_ids WHERE k='cpDup') AND
      (SELECT v FROM p08_ids WHERE k='pkgA') IS NOT NULL AND
      NOT (res->>'consumed')::boolean AND (res->>'reason') = 'no_active_package' AND
      (SELECT count(*) FROM public.package_usages) = 2,
      'vente idempotente, plan expire, forfait client expire non consomme');
END $$;

-- Promotions : validité, quota, une seule par fiche, idempotence, après encaissement.
INSERT INTO p08_ids SELECT 'promoA', public.save_promotion(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Promo 10%', 'P08-10', 'percent', 10,
  current_date - 1, current_date + 30, 1, 1000, true);
INSERT INTO p08_ids SELECT 'promoB', public.save_promotion(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Promo 1000', 'P08-20', 'amount', 1000,
  current_date - 1, current_date + 30, NULL, 1000, true);
INSERT INTO p08_ids SELECT 'promoOld', public.save_promotion(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Promo expiree', 'P08-OLD', 'percent', 10,
  current_date - 30, current_date - 1, NULL, 0, true);
DO $$
DECLARE v1 jsonb; v2 jsonb; v3 jsonb;
BEGIN
  v1 := public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash1'), 'P08-10', 'promo-key-1');
  v2 := public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash1'), 'P08-10', 'promo-key-1');
  INSERT INTO p08_result VALUES
    ('promotion : 10% de 5000 = 500, jamais appliquee deux fois',
      (v1->>'applied')::boolean AND (v1->>'discountMinor')::bigint = 500 AND
      (v2->>'duplicate')::boolean AND NOT (v2->>'applied')::boolean AND
      (SELECT discount_minor FROM public.washes WHERE id=(SELECT v FROM p08_ids WHERE k='wash1')) = 500 AND
      (SELECT total_minor FROM public.washes WHERE id=(SELECT v FROM p08_ids WHERE k='wash1')) = 4500 AND
      (SELECT count(*) FROM public.promotion_usages WHERE wash_id=(SELECT v FROM p08_ids WHERE k='wash1')) = 1,
      'cle promo-key-1 rejouee sans double remise');
  BEGIN
    PERFORM public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash1'), 'P08-20', 'promo-key-2');
    INSERT INTO p08_result VALUES ('promotion : second code sur la meme fiche refuse', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('promotion : second code sur la meme fiche refuse', true, '23514');
  END;
  BEGIN
    PERFORM public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash2'), 'P08-OLD', 'promo-old-key');
    INSERT INTO p08_result VALUES ('promotion : date de validite expiree refusee', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('promotion : date de validite expiree refusee', true, '23514');
  END;
  BEGIN
    PERFORM public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash2'), 'P08-10', 'promo-quota');
    INSERT INTO p08_result VALUES ('promotion : quota max_usages=1 respecte', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('promotion : quota max_usages=1 respecte', true, '23514');
  END;
  v3 := public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash2'), 'P08-20', 'promo2-key-1');
  INSERT INTO p08_result VALUES
    ('promotion : seconde fiche, remise 1000 et idempotence',
      (v3->>'applied')::boolean AND (v3->>'discountMinor')::bigint = 1000 AND
      (SELECT count(*) FROM public.promotion_usages) = 2 AND
      (SELECT usage_count FROM public.promotions WHERE id=(SELECT v FROM p08_ids WHERE k='promoA')) = 1 AND
      (SELECT usage_count FROM public.promotions WHERE id=(SELECT v FROM p08_ids WHERE k='promoB')) = 1,
      '2 usages au total, aucun doublon');
END $$;
SELECT public.record_wash_payment_by_key(
  (SELECT v FROM p08_ids WHERE k='wash4'), 1000, 'card', 'P08-CARD', 'payment-p08-4');
DO $$ BEGIN
  BEGIN
    PERFORM public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash4'), 'P08-20', 'promo-after-payment');
    INSERT INTO p08_result VALUES ('promotion : refus apres encaissement', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('promotion : refus apres encaissement', true, '23514');
  END;
END $$;

-- Points calculés sur le montant avant remise : 5000 / 1000 * 2 = 10.
DO $$
DECLARE v1 jsonb; v2 jsonb;
BEGIN
  v1 := public.accrue_loyalty_for_wash((SELECT v FROM p08_ids WHERE k='wash1'), 'loyalty-w1');
  v2 := public.accrue_loyalty_for_wash((SELECT v FROM p08_ids WHERE k='wash1'), 'loyalty-w1');
  INSERT INTO p08_result VALUES
    ('fidelite : points sur lavage idempotents, solde final 17',
      (v1->>'points')::integer = 10 AND NOT (v1->>'duplicate')::boolean AND
      (v2->>'duplicate')::boolean AND (v2->>'points')::integer = 0 AND
      (SELECT points_balance FROM public.loyalty_cards WHERE id=(SELECT v FROM p08_ids WHERE k='cardA')) = 17 AND
      (SELECT loyalty_points_earned FROM public.washes WHERE id=(SELECT v FROM p08_ids WHERE k='wash1')) = 10,
      '7 + 10 = 17, base 5000 avant remise');
END $$;

-- Flottes : contrat, véhicule, créances, limite de crédit et contrat expiré.
INSERT INTO p08_ids SELECT 'fleetA', public.save_fleet(
  (SELECT v FROM p08_ids WHERE k='stA'), 'Flotte P08', 'Contact P08',
  '+2250700000002', 'flotte@test.invalid', 100000, 'sms', true);
INSERT INTO p08_ids SELECT 'contractA', public.save_fleet_contract(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
  'FL-P08-001', current_date - 1, current_date + 365, 10, 20000, 'active');
INSERT INTO p08_ids SELECT 'fleetVehA', public.attach_fleet_vehicle(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
  (SELECT v FROM p08_ids WHERE k='vehA'), (SELECT v FROM p08_ids WHERE k='contractA'));
INSERT INTO p08_ids SELECT 'recvA', public.record_fleet_receivable(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
  (SELECT v FROM p08_ids WHERE k='contractA'), 5000,
  (SELECT v FROM p08_ids WHERE k='wash1'), current_date, 'recv-1');
INSERT INTO p08_ids SELECT 'recvDup', public.record_fleet_receivable(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
  (SELECT v FROM p08_ids WHERE k='contractA'), 5000,
  (SELECT v FROM p08_ids WHERE k='wash1'), current_date, 'recv-1');
INSERT INTO p08_ids SELECT 'contractOld', public.save_fleet_contract(
  (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
  'FL-P08-OLD', current_date - 30, current_date - 1, 0, 20000, 'active');
DO $$ BEGIN
  BEGIN
    PERFORM public.record_fleet_receivable(
      (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
      (SELECT v FROM p08_ids WHERE k='contractA'), 20000, NULL, current_date, 'recv-too-much');
    INSERT INTO p08_result VALUES ('flotte : limite de credit refusee', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('flotte : limite de credit refusee', true, '23514');
  END;
  BEGIN
    PERFORM public.record_fleet_receivable(
      (SELECT v FROM p08_ids WHERE k='stA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
      (SELECT v FROM p08_ids WHERE k='contractOld'), 1000, NULL, current_date, 'recv-expired');
    INSERT INTO p08_result VALUES ('flotte : contrat hors validite refuse', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('flotte : contrat hors validite refuse', true, '23514');
  END;
END $$;
INSERT INTO p08_result VALUES
  ('flotte : contrat, vehicule et creance idempotente',
    (SELECT v FROM p08_ids WHERE k='recvA') = (SELECT v FROM p08_ids WHERE k='recvDup') AND
    (SELECT count(*) FROM public.fleet_receivables) = 1 AND
    (SELECT COALESCE(SUM(amount_minor),0) FROM public.fleet_receivables) = 5000 AND
    (SELECT count(*) FROM public.fleet_vehicles) = 1 AND
    (SELECT credit_limit_minor FROM public.fleet_contracts WHERE id=(SELECT v FROM p08_ids WHERE k='contractA')) = 20000,
    '1 creance ouverte de 5000, aucun double');

-- Notifications : file d'attente uniquement, aucun fournisseur / envoi simulé.
INSERT INTO p08_ids SELECT 'notif1', public.enqueue_notification(
  (SELECT v FROM p08_ids WHERE k='stA'), 'package_expiry',
  (SELECT v FROM p08_ids WHERE k='cliA'), NULL,
  jsonb_build_object('client','Client P08 A'), 'notif-1');
INSERT INTO p08_ids SELECT 'notifDup', public.enqueue_notification(
  (SELECT v FROM p08_ids WHERE k='stA'), 'package_expiry',
  (SELECT v FROM p08_ids WHERE k='cliA'), NULL,
  jsonb_build_object('client','Client P08 A'), 'notif-1');
INSERT INTO p08_ids SELECT 'notifFleet', public.enqueue_notification(
  (SELECT v FROM p08_ids WHERE k='stA'), 'contract_renewal',
  NULL, (SELECT v FROM p08_ids WHERE k='fleetA'),
  jsonb_build_object('fleet','Flotte P08'), 'notif-fleet-1');
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_notification(
      (SELECT v FROM p08_ids WHERE k='stA'), 'no_channel',
      (SELECT v FROM p08_ids WHERE k='cliNone'), NULL, '{}'::jsonb, 'notif-none');
    INSERT INTO p08_result VALUES ('notification : canal none refuse', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('notification : canal none refuse', true, '23514');
  END;
  BEGIN
    PERFORM public.enqueue_notification(
      (SELECT v FROM p08_ids WHERE k='stA'), 'two_targets',
      (SELECT v FROM p08_ids WHERE k='cliA'), (SELECT v FROM p08_ids WHERE k='fleetA'),
      '{}'::jsonb, 'notif-two');
    INSERT INTO p08_result VALUES ('notification : une seule cible autorisee', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p08_result VALUES ('notification : une seule cible autorisee', true, '23514');
  END;
  BEGIN
    UPDATE public.notification_outbox SET payload = jsonb_build_object('fake','send')
    WHERE id = (SELECT v FROM p08_ids WHERE k='notifFleet');
    INSERT INTO p08_result VALUES ('notification : payload immuable', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p08_result VALUES ('notification : payload immuable', true, '55000 trigger');
  END;
  BEGIN
    DELETE FROM public.notification_outbox WHERE id = (SELECT v FROM p08_ids WHERE k='notifFleet');
    INSERT INTO p08_result VALUES ('notification : suppression interdite', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p08_result VALUES ('notification : suppression interdite', true, '55000 trigger');
  END;
END $$;
SELECT public.cancel_pending_notification((SELECT v FROM p08_ids WHERE k='notif1'));
DO $$ BEGIN
  BEGIN
    PERFORM public.cancel_pending_notification((SELECT v FROM p08_ids WHERE k='notif1'));
    INSERT INTO p08_result VALUES ('notification : annulation non rejouable', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    INSERT INTO p08_result VALUES ('notification : annulation non rejouable', true, 'P0002');
  END;
END $$;
INSERT INTO p08_result VALUES
  ('notifications : aucun fournisseur, aucun envoi simule, file en attente',
    (SELECT v FROM p08_ids WHERE k='notif1') = (SELECT v FROM p08_ids WHERE k='notifDup') AND
    (SELECT channel FROM public.notification_outbox WHERE id=(SELECT v FROM p08_ids WHERE k='notif1')) = 'email' AND
    (SELECT channel FROM public.notification_outbox WHERE id=(SELECT v FROM p08_ids WHERE k='notifFleet')) = 'sms' AND
    (SELECT status FROM public.notification_outbox WHERE id=(SELECT v FROM p08_ids WHERE k='notif1')) = 'cancelled' AND
    (SELECT cancelled_at IS NOT NULL FROM public.notification_outbox WHERE id=(SELECT v FROM p08_ids WHERE k='notif1')) AND
    (SELECT status FROM public.notification_outbox WHERE id=(SELECT v FROM p08_ids WHERE k='notifFleet')) = 'pending' AND
    (SELECT count(*) FROM public.notification_outbox) = 2 AND
    NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='notification_outbox' AND column_name IN ('sent_at','provider','sent_by')),
    '1 annulee + 1 en attente, aucune colonne d envoi');
INSERT INTO p08_result VALUES
  ('my_crm_board : camelCase, stats, regles et aucun company_id',
    NOT (public.my_crm_board()::text LIKE '%company_id%') AND
    (public.my_crm_board()->'stats'->>'clients')::integer = 2 AND
    (public.my_crm_board()->'stats'->>'fleets')::integer = 1 AND
    (public.my_crm_board()->'stats'->>'activeCards')::integer = 1 AND
    (public.my_crm_board()->'stats'->>'activePromotions')::integer = 2 AND
    (public.my_crm_board()->'stats'->>'openReceivablesMinor')::bigint = 5000 AND
    (public.my_crm_board()->'stats'->>'pendingNotifications')::integer = 1 AND
    jsonb_array_length(public.my_crm_board()->'notificationOutbox') = 2 AND
    NOT ((public.my_crm_board()->'notificationOutbox')::text LIKE '%sentAt%') AND
    (public.my_crm_board()->'rules'->>'provider') LIKE '%aucun envoi simule%',
    'projection serveur STABLE SECURITY DEFINER, RLS et station');

-- Isolation A/B : B ne voit ni client, ni carte, ni promotion de A.
SELECT set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
INSERT INTO p08_result VALUES
  ('isolation A/B : board CRM de B sans donnee de A',
    NOT (public.my_crm_board()::text LIKE '%' || (SELECT v::text FROM p08_ids WHERE k='cliA') || '%') AND
    NOT (public.my_crm_board()::text LIKE '%LC-P08-A%') AND
    NOT (public.my_crm_board()::text LIKE '%P08-10%') AND
    (public.my_crm_board()->'stats'->>'clients')::integer = 0 AND
    (public.my_crm_board()->'stats'->>'fleets')::integer = 0,
    'B : 0 client A, 0 carte A, 0 promotion A, 0 flotte A');
DO $$ BEGIN
  BEGIN
    PERFORM public.save_customer_profile(
      p_station_id => (SELECT v FROM p08_ids WHERE k='stA'),
      p_name => 'Fuite B P08', p_channel => 'email');
    INSERT INTO p08_result VALUES ('B ne cree pas de client sur la station de A', false, 'aucune exception');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO p08_result VALUES ('B ne cree pas de client sur la station de A', true, '42501');
  END;
  BEGIN
    PERFORM public.apply_promotion_to_wash((SELECT v FROM p08_ids WHERE k='wash1'), 'P08-20');
    INSERT INTO p08_result VALUES ('B n applique pas de promotion sur une fiche de A', false, 'aucune exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO p08_result VALUES ('B n applique pas de promotion sur une fiche de A',
      SQLSTATE IN ('P0002','42501'), 'SQLSTATE=' || SQLSTATE);
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);

-- Le navigateur ne peut pas forger une fiche client, même avec une session A.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.customers (company_id, station_id, name)
    VALUES ((SELECT v FROM p08_ids WHERE k='coA'), (SELECT v FROM p08_ids WHERE k='stA'), 'Fuite directe P08');
    INSERT INTO p08_result VALUES ('ecriture directe CRM refusee', false, 'aucune exception');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO p08_result VALUES ('ecriture directe CRM refusee', true, '42501 REVOKE');
  END;
END $$;
RESET ROLE;

SELECT label, ok, detail FROM p08_result ORDER BY ok, label;
ROLLBACK;
