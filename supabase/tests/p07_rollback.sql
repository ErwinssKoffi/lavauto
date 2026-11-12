-- Test d'intégration Prompt 07 — À EXÉCUTER DANS UNE TRANSACTION AVEC ROLLBACK.
-- Aucune donnée persistée : 2 comptes Auth temporaires, 2 entreprises, 2 stations,
-- 1 fournisseur, 1 produit, 1 commande, 2 réceptions partielles, 1 inventaire,
-- 1 norme de consommation, 1 fiche livrée, 1 dépense d'achat et 1 attestation.
-- Le connecteur Supabase exécute ce script via `execute_query` (BEGIN … ROLLBACK).
BEGIN;
CREATE TEMP TABLE p07_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE p07_result (label text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON p07_ids, p07_result TO authenticated;

-- État de départ : 33 migrations, 0 fixture et aucune écriture directe exposée.
INSERT INTO p07_result VALUES
  ('033 appliquee : 33 migrations, 0 fixture metier',
    (SELECT count(*) FROM supabase_migrations.schema_migrations) = 33 AND
    (SELECT count(*) FROM public.products) = 0 AND
    (SELECT count(*) FROM public.purchase_orders) = 0 AND
    (SELECT count(*) FROM public.stock_movements) = 0 AND
    (SELECT count(*) FROM public.finance_cost_periods) = 0,
    'schema_migrations=33, stocks/achats/mouvements/attestations vides'),
  ('P07 : 4 tables, 11 RPC, board SECURITY DEFINER, aucun grant anon',
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN
      ('product_categories','stock_receipt_events','stock_consumption_runs','finance_cost_periods')) = 4 AND
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('save_product_category','save_supplier','save_product','create_purchase_order',
        'receive_purchase_lines','receive_purchase_order','start_inventory_session',
        'record_inventory_count','close_inventory_session','save_service_consumption',
        'consume_products_for_wash')) = 11 AND
    (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='my_stock_board' LIMIT 1) AND
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('my_stock_board','save_product','create_purchase_order','receive_purchase_lines',
         'certify_profitability_period','my_profitability')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) >= 6,
    '030–033 : catalogues, RPC et grants verifies'),
  ('P07 : INSERT/UPDATE/DELETE refuses au role authenticated',
    NOT has_table_privilege('authenticated','public.stock_movements','INSERT') AND
    NOT has_table_privilege('authenticated','public.stock_levels','UPDATE') AND
    NOT has_table_privilege('authenticated','public.finance_cost_periods','DELETE'),
    'REVOKE sur les tables de stock et de certification');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('44444444-4444-4444-8444-444444444444', 'p07-a@test.invalid',
   jsonb_build_object('company_name','Tenant P07 A','station_name','Station P07 A','owner_name','Owner P07 A')),
  ('55555555-5555-4555-8555-555555555555', 'p07-b@test.invalid',
   jsonb_build_object('company_name','Tenant P07 B','station_name','Station P07 B','owner_name','Owner P07 B'));

INSERT INTO p07_ids VALUES
  ('userA','44444444-4444-4444-8444-444444444444'),
  ('userB','55555555-5555-4555-8555-555555555555'),
  ('catA','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  ('srvA','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  ('cliA','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
INSERT INTO p07_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = '44444444-4444-4444-8444-444444444444';
INSERT INTO p07_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = '55555555-5555-4555-8555-555555555555';
INSERT INTO p07_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = '44444444-4444-4444-8444-444444444444';
INSERT INTO p07_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = '55555555-5555-4555-8555-555555555555';

UPDATE public.stations
SET activated = true, settings = jsonb_build_object('commission_rate', 10)
WHERE id IN (SELECT v FROM p07_ids WHERE k IN ('stA','stB'));

INSERT INTO public.vehicle_categories (id, company_id, station_id, name)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',(SELECT v FROM p07_ids WHERE k='coA'),(SELECT v FROM p07_ids WHERE k='stA'),'Berline P07');
INSERT INTO public.services (id, company_id, station_id, name)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',(SELECT v FROM p07_ids WHERE k='coA'),(SELECT v FROM p07_ids WHERE k='stA'),'Lavage P07');
INSERT INTO public.service_prices (company_id, station_id, service_id, vehicle_category_id, price_minor)
VALUES ((SELECT v FROM p07_ids WHERE k='coA'),(SELECT v FROM p07_ids WHERE k='stA'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',3000);
INSERT INTO public.customers (id, company_id, station_id, name)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',(SELECT v FROM p07_ids WHERE k='coA'),(SELECT v FROM p07_ids WHERE k='stA'),'Client P07');

-- Session propriétaire A : toutes les écritures passent par les RPC P07.
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
INSERT INTO p07_ids SELECT 'supA', public.save_supplier(
  (SELECT v FROM p07_ids WHERE k='stA'),'Fournisseur P07','+2250700000000','p07@test.invalid','Abidjan',true,NULL);
INSERT INTO p07_ids SELECT 'prodA', public.save_product(
  (SELECT v FROM p07_ids WHERE k='stA'),'Shampoing P07','P07-SH1','Consommables','L',3,true,NULL);
SELECT set_config('p07.prodA',(SELECT v::text FROM p07_ids WHERE k='prodA'),true);
SELECT set_config('p07.orderA',(SELECT public.create_purchase_order(
  (SELECT v FROM p07_ids WHERE k='stA'),'CMD-P07-1',
  jsonb_build_array(jsonb_build_object(
    'product_id',(SELECT v FROM p07_ids WHERE k='prodA'),
    'qty_ordered',10,'unit_cost_minor',1000)),
  (SELECT v FROM p07_ids WHERE k='supA'),current_date,NULL,'p07-order-1')::text),true);
INSERT INTO p07_ids SELECT 'orderA',current_setting('p07.orderA')::uuid;
INSERT INTO p07_ids SELECT 'orderDup',public.create_purchase_order(
  (SELECT v FROM p07_ids WHERE k='stA'),'CMD-P07-1',
  jsonb_build_array(jsonb_build_object(
    'product_id',(SELECT v FROM p07_ids WHERE k='prodA'),
    'qty_ordered',10,'unit_cost_minor',1000)),
  (SELECT v FROM p07_ids WHERE k='supA'),current_date,NULL,'p07-order-1');

INSERT INTO p07_result VALUES
  ('produit + categorie + fournisseur : RPC, aucun tenant fourni par le client',
    (SELECT count(*)=1 FROM public.products WHERE id=(SELECT v FROM p07_ids WHERE k='prodA')) AND
    (SELECT count(*)=1 FROM public.product_categories WHERE station_id=(SELECT v FROM p07_ids WHERE k='stA')) AND
    (SELECT count(*)=1 FROM public.suppliers WHERE id=(SELECT v FROM p07_ids WHERE k='supA')),
    'save_product cree aussi la categorie'),
  ('commande idempotente : 1 seule commande et 0 mouvement de stock',
    (SELECT v FROM p07_ids WHERE k='orderA')=(SELECT v FROM p07_ids WHERE k='orderDup') AND
    (SELECT count(*)=1 FROM public.purchase_orders WHERE idempotency_key='p07-order-1') AND
    (SELECT count(*)=0 FROM public.stock_movements WHERE reference_id=(SELECT v FROM p07_ids WHERE k='orderA')),
    'la creation n incremente jamais le stock');

-- Réception partielle 5 @ 1000 puis 5 @ 2000 : coût moyen pondéré 1500.
SELECT public.receive_purchase_lines(
  (SELECT v FROM p07_ids WHERE k='orderA'),
  jsonb_build_array(jsonb_build_object('product_id',(SELECT v FROM p07_ids WHERE k='prodA'),'qty',5,'unit_cost_minor',1000)),
  'p07-rec-1');
SELECT public.receive_purchase_lines(
  (SELECT v FROM p07_ids WHERE k='orderA'),
  jsonb_build_array(jsonb_build_object('product_id',(SELECT v FROM p07_ids WHERE k='prodA'),'qty',5,'unit_cost_minor',2000)),
  'p07-rec-2');
SELECT public.receive_purchase_lines(
  (SELECT v FROM p07_ids WHERE k='orderA'),
  jsonb_build_array(jsonb_build_object('product_id',(SELECT v FROM p07_ids WHERE k='prodA'),'qty',5,'unit_cost_minor',1000)),
  'p07-rec-1');
DO $$ BEGIN
  BEGIN
    PERFORM public.receive_purchase_lines(
      current_setting('p07.orderA')::uuid,
      jsonb_build_array(jsonb_build_object('product_id',current_setting('p07.prodA')::uuid,'qty',4,'unit_cost_minor',1000)),
      'p07-rec-1');
    INSERT INTO p07_result VALUES ('cle de reception reuse avec un autre contenu refusee',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p07_result VALUES ('cle de reception reuse avec un autre contenu refusee',true,'23514');
  END;
END $$;
INSERT INTO p07_result VALUES
  ('2 receptions partielles : stock 10, cout moyen 1500, commande recue',
    (SELECT qty_on_hand=10 FROM public.stock_levels WHERE product_id=(SELECT v FROM p07_ids WHERE k='prodA')
      AND station_id=(SELECT v FROM p07_ids WHERE k='stA')) AND
    (SELECT average_cost_minor=1500 FROM public.products WHERE id=(SELECT v FROM p07_ids WHERE k='prodA')) AND
    (SELECT status='received' FROM public.purchase_orders WHERE id=(SELECT v FROM p07_ids WHERE k='orderA')) AND
    (SELECT count(*)=2 FROM public.stock_movements WHERE kind='purchase_receipt'
      AND product_id=(SELECT v FROM p07_ids WHERE k='prodA')) AND
    (SELECT count(*)=2 FROM public.stock_receipt_events WHERE order_id=(SELECT v FROM p07_ids WHERE k='orderA')),
    '(5*1000 + 5*2000)/10 = 1500 ; doublon idempotent ignore'),
  ('mouvement de reception immuable',
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relname='stock_movements' AND t.tgname LIKE '%immutable%') >= 1,
    'trigger immuable 007 + 030');

-- Fiche prête, norme 2 unités / lavage, consommation valorisée une seule fois.
INSERT INTO p07_ids SELECT 'washA',public.create_wash_full(jsonb_build_object(
  'station_id',(SELECT v FROM p07_ids WHERE k='stA'),
  'category_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'plate','P07 AB 01','customer_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
  'customer_name','Client P07','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','qty',1)),
  'employee_ids',jsonb_build_array((SELECT v FROM p07_ids WHERE k='userA')),
  'post_id',NULL,'idempotency_key','p07-wash-a'));
SELECT public.transition_wash_status((SELECT v FROM p07_ids WHERE k='washA'),'in_progress');
SELECT public.transition_wash_status((SELECT v FROM p07_ids WHERE k='washA'),'quality_check');
SELECT public.record_wash_quality_check((SELECT v FROM p07_ids WHERE k='washA'),'approved','RAS');
INSERT INTO p07_ids SELECT 'ruleA',public.save_service_consumption(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',(SELECT v FROM p07_ids WHERE k='prodA'),2,true);
SELECT public.consume_products_for_wash((SELECT v FROM p07_ids WHERE k='washA'));
SELECT public.consume_products_for_wash((SELECT v FROM p07_ids WHERE k='washA'));
INSERT INTO p07_result VALUES
  ('consommation theorique : 1 execution, 1 mouvement valorise, stock 8',
    (SELECT count(*)=1 FROM public.stock_consumption_runs WHERE wash_id=(SELECT v FROM p07_ids WHERE k='washA')) AND
    (SELECT count(*)=1 FROM public.stock_movements WHERE kind='consumption'
      AND product_id=(SELECT v FROM p07_ids WHERE k='prodA')) AND
    (SELECT qty_delta=-2 AND unit_cost_minor=1500 FROM public.stock_movements
      WHERE kind='consumption' AND product_id=(SELECT v FROM p07_ids WHERE k='prodA')) AND
    (SELECT qty_on_hand=8 FROM public.stock_levels WHERE product_id=(SELECT v FROM p07_ids WHERE k='prodA')
      AND station_id=(SELECT v FROM p07_ids WHERE k='stA')),
    '2 unites × 1500 = 3000 FCFA de cout de revient');

-- Inventaire : un seul ouvert, comptage +2, ajustement tracé, session close figée.
INSERT INTO p07_ids SELECT 'invA',public.start_inventory_session((SELECT v FROM p07_ids WHERE k='stA'));
DO $$ BEGIN
  BEGIN
    PERFORM public.start_inventory_session((SELECT v FROM p07_ids WHERE k='stA'));
    INSERT INTO p07_result VALUES ('un seul inventaire ouvert par station',false,'aucune exception');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p07_result VALUES ('un seul inventaire ouvert par station',true,'23505');
  END;
END $$;
SELECT public.record_inventory_count((SELECT v FROM p07_ids WHERE k='invA'),
  (SELECT v FROM p07_ids WHERE k='prodA'),10,'Ecart constate P07');
SELECT public.close_inventory_session((SELECT v FROM p07_ids WHERE k='invA'));
DO $$ BEGIN
  BEGIN
    UPDATE public.inventory_items SET counted_qty=999
    WHERE session_id=(SELECT v FROM p07_ids WHERE k='invA');
    INSERT INTO p07_result VALUES ('inventaire clos immuable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p07_result VALUES ('inventaire clos immuable',true,'55000 trigger');
  END;
END $$;
INSERT INTO p07_result VALUES
  ('inventaire : ecart +2, mouvement valorise, stock final 10',
    (SELECT difference=2 FROM public.inventory_items WHERE session_id=(SELECT v FROM p07_ids WHERE k='invA')) AND
    (SELECT status='closed' FROM public.inventory_sessions WHERE id=(SELECT v FROM p07_ids WHERE k='invA')) AND
    (SELECT count(*)=1 FROM public.stock_movements WHERE kind='inventory_adjustment'
      AND qty_delta=2 AND unit_cost_minor=1500) AND
    (SELECT qty_on_hand=10 FROM public.stock_levels WHERE product_id=(SELECT v FROM p07_ids WHERE k='prodA')
      AND station_id=(SELECT v FROM p07_ids WHERE k='stA')),
    '8 theoriques, 10 comptes, +2 au cout moyen');

-- Dépense d'achat : refus de certification tant qu'elle n'est pas rattachée.
INSERT INTO p07_ids SELECT 'expA',public.record_expense_by_key(
  (SELECT v FROM p07_ids WHERE k='stA'),1000,'Fournitures','Achat shampoing P07',
  'Fournisseur P07',current_date,'mobile_money','p07-exp-1');
INSERT INTO p07_result VALUES
  ('avant attestation : my_profitability reste honnete',
    (SELECT (public.my_profitability(current_date,current_date)->>'costsMissing')::boolean) AND
    (public.my_profitability(current_date,current_date)->>'grossMargin') IS NULL AND
    (public.my_profitability(current_date,current_date)->>'result') IS NULL AND
    (public.my_profitability(current_date,current_date)->>'purchases')::bigint = 15000,
    'NULL, pas de faux benefice net ; achats 15000');
DO $$ BEGIN
  BEGIN
    PERFORM public.certify_profitability_period(current_date,current_date,'Je certifie les couts P07');
    INSERT INTO p07_result VALUES ('certification refusee : achat de stock non rattache',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p07_result VALUES ('certification refusee : achat de stock non rattache',true,'23514');
  END;
END $$;
SELECT public.link_expense_to_purchase_order((SELECT v FROM p07_ids WHERE k='expA'),(SELECT v FROM p07_ids WHERE k='orderA'));
INSERT INTO p07_result VALUES
  ('rattachement achat ↔ commande : aucun double comptage',
    (SELECT purchase_order_id=(SELECT v FROM p07_ids WHERE k='orderA') FROM public.expenses
      WHERE id=(SELECT v FROM p07_ids WHERE k='expA')) AND
    (SELECT is_stock_purchase FROM public.expense_categories c JOIN public.expenses e ON e.category_id=c.id
      WHERE e.id=(SELECT v FROM p07_ids WHERE k='expA')),
    'flag is_stock_purchase + purchase_order_id');
SELECT public.certify_profitability_period(current_date,current_date,'Je certifie les couts P07 complets');
DO $$ BEGIN
  BEGIN
    PERFORM public.certify_profitability_period(current_date,current_date,'Je certifie encore les couts P07');
    INSERT INTO p07_result VALUES ('periode deja certifiee : releve immuable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p07_result VALUES ('periode deja certifiee : releve immuable',true,'55000');
  END;
  BEGIN
    UPDATE public.finance_cost_periods SET attestation='Modification interdite'
    WHERE start_date=current_date AND end_date=current_date;
    INSERT INTO p07_result VALUES ('attestation immuable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p07_result VALUES ('attestation immuable',true,'55000 trigger');
  END;
END $$;
INSERT INTO p07_result VALUES
  ('couts certifies : marge brute et resultat net calculables',
    (SELECT NOT (public.my_profitability(current_date,current_date)->>'costsMissing')::boolean) AND
    (SELECT (public.my_profitability(current_date,current_date)->>'grossMargin')::bigint = 0) AND
    (SELECT (public.my_profitability(current_date,current_date)->>'result')::bigint = 0) AND
    (SELECT (public.my_profitability(current_date,current_date)->>'consumptions')::bigint = 3000) AND
    (SELECT count(*)=1 FROM public.finance_cost_periods WHERE start_date=current_date AND end_date=current_date),
    'CA 3000 − consommations 3000 = marge 0 ; charges hors stock 0 ; resultat 0'),
  ('my_stock_board : camelCase, valorisation 15000, aucun company_id',
    (public.my_stock_board()->'valuation'->>'stockValueMinor')::bigint = 15000 AND
    (public.my_stock_board()->'valuation'->>'consumptionCostMinor')::bigint = 3000 AND
    jsonb_array_length(public.my_stock_board()->'products') = 1 AND
    jsonb_array_length(public.my_stock_board()->'costCertifications') = 1 AND
    NOT (public.my_stock_board()::text LIKE '%company_id%'),
    'board STABLE SECURITY DEFINER, RLS et station');

-- Le navigateur ne peut pas forger un mouvement, même avec une session A.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.stock_movements (company_id, station_id, product_id, kind, qty_delta, unit_cost_minor)
    VALUES ((SELECT v FROM p07_ids WHERE k='coA'),(SELECT v FROM p07_ids WHERE k='stA'),
      (SELECT v FROM p07_ids WHERE k='prodA'),'purchase_receipt',99,1);
    INSERT INTO p07_result VALUES ('ecriture directe de stock refusee',false,'aucune exception');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO p07_result VALUES ('ecriture directe de stock refusee',true,'42501 REVOKE');
  END;
END $$;
RESET ROLE;

-- Session propriétaire B : 0 fuite du stock, du board et de l'attestation de A.
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
INSERT INTO p07_result VALUES
  ('isolation A/B : board stock de B sans produit ni attestation de A',
    NOT (public.my_stock_board()::text LIKE '%' || current_setting('p07.prodA') || '%') AND
    jsonb_array_length(public.my_stock_board()->'costCertifications') = 0 AND
    (public.my_profitability(current_date,current_date)->>'revenue')::bigint = 0 AND
    (public.my_profitability(current_date,current_date)->>'costsMissing')::boolean,
    'B : 0 produit A, 0 certification A, 0 CA A');
DO $$ BEGIN
  BEGIN
    PERFORM public.save_product((SELECT v FROM p07_ids WHERE k='stA'),'Fuite B P07','','','',0,true,NULL);
    INSERT INTO p07_result VALUES ('B ne cree pas de produit sur la station de A',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO p07_result VALUES ('B ne cree pas de produit sur la station de A',true,'42501');
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);

SELECT label, ok, detail FROM p07_result ORDER BY ok, label;
ROLLBACK;
