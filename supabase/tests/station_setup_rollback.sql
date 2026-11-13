-- 056 : recette SQL isolée. Ne jamais viser la production sans autorisation.
BEGIN;
CREATE TEMP TABLE setup_ids(k text PRIMARY KEY,id uuid) ON COMMIT DROP;
CREATE TEMP TABLE setup_results(label text,ok boolean) ON COMMIT DROP;
CREATE TEMP TABLE setup_payloads(k text PRIMARY KEY,payload jsonb) ON COMMIT DROP;
GRANT ALL ON setup_ids, setup_results, setup_payloads TO authenticated, anon;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('88888888-8888-4888-8888-888888888881','setup-a@test.invalid',jsonb_build_object('company_name','Entreprise A','station_name','Station A','owner_name','Owner A','city','Abidjan','phone','+225 0700000000')),
 ('88888888-8888-4888-8888-888888888882','setup-b@test.invalid',jsonb_build_object('company_name','Entreprise B','station_name','Station B','owner_name','Owner B','city','Bouaké','phone','+225 0700000001')),
 ('88888888-8888-4888-8888-888888888883','setup-reader@test.invalid',jsonb_build_object('invitation',true));
INSERT INTO setup_ids VALUES ('ownerA','88888888-8888-4888-8888-888888888881'),
 ('ownerB','88888888-8888-4888-8888-888888888882'),('cashier','88888888-8888-4888-8888-888888888883');
INSERT INTO setup_ids SELECT 'coA',company_id FROM public.user_profiles WHERE id=(SELECT id FROM setup_ids WHERE k='ownerA');
INSERT INTO setup_ids SELECT 'coB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM setup_ids WHERE k='ownerB');
INSERT INTO setup_ids SELECT 'stA',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM setup_ids WHERE k='ownerA');
INSERT INTO setup_ids SELECT 'stB',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM setup_ids WHERE k='ownerB');
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id)
SELECT (SELECT id FROM setup_ids WHERE k='cashier'),(SELECT id FROM setup_ids WHERE k='coA'),'Caissier','setup-reader@test.invalid',id
FROM public.roles WHERE key='cashier' AND company_id IS NULL;
INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
VALUES((SELECT id FROM setup_ids WHERE k='coA'),(SELECT id FROM setup_ids WHERE k='cashier'),(SELECT id FROM setup_ids WHERE k='stA'));
UPDATE public.stations SET settings='{"legacy_setting":"à conserver"}'::jsonb WHERE id=(SELECT id FROM setup_ids WHERE k='stA');
INSERT INTO public.payment_methods(company_id,station_id,key,label,kind,active)
VALUES ((SELECT id FROM setup_ids WHERE k='coA'),(SELECT id FROM setup_ids WHERE k='stA'),'legacy_cheque','Ancien chèque','other',true);
INSERT INTO setup_results VALUES
 ('écritures directes refusées',NOT has_table_privilege('authenticated','public.companies','UPDATE')
    AND NOT has_table_privilege('authenticated','public.stations','UPDATE')
    AND NOT has_table_privilege('authenticated','public.services','INSERT')
    AND NOT has_table_privilege('authenticated','public.payment_methods','UPDATE')
    AND NOT has_table_privilege('authenticated','public.payments','INSERT')),
 ('fonctions non exposées à anon',NOT has_function_privilege('anon','public.my_station_setup(uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.activate_station_setup(uuid)','EXECUTE'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM setup_ids WHERE k='ownerA'),true);
INSERT INTO setup_results VALUES
 ('station initiale lue',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->>'name'='Station A'),
 ('catégories initialement vides',jsonb_array_length(public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'categories')=0);
DO $$ BEGIN
 BEGIN PERFORM public.activate_station_setup((SELECT id FROM setup_ids WHERE k='stA'));
  INSERT INTO setup_results VALUES('activation incomplète refusée',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('activation incomplète refusée',true); END;
 BEGIN PERFORM public.my_station_setup((SELECT id FROM setup_ids WHERE k='stB'));
  INSERT INTO setup_results VALUES('lecture autre entreprise refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO setup_results VALUES('lecture autre entreprise refusée',true); END;
 BEGIN PERFORM public.save_station_setup((SELECT id FROM setup_ids WHERE k='stB'),'{"address":"Intrusion"}');
  INSERT INTO setup_results VALUES('écriture autre entreprise refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO setup_results VALUES('écriture autre entreprise refusée',true); END;
 BEGIN PERFORM public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"activated":true}');
  INSERT INTO setup_results VALUES('activation directe par patch interdite',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('activation directe par patch interdite',true); END;
 BEGIN PERFORM public.save_company_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"phone":"pas un numéro"}');
  INSERT INTO setup_results VALUES('téléphone invalide refusé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('téléphone invalide refusé',true); END;
 BEGIN PERFORM public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"hours":[{"day":"Lundi"},{"day":"Lundi"},{"day":"Lundi"},{"day":"Lundi"},{"day":"Lundi"},{"day":"Lundi"},{"day":"Lundi"}]}');
  INSERT INTO setup_results VALUES('horaires incomplets ou dupliqués refusés',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('horaires incomplets ou dupliqués refusés',true); END;
 BEGIN PERFORM public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"paymentMethods":["especes","especes"]}');
  INSERT INTO setup_results VALUES('moyens en double refusés',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('moyens en double refusés',true); END;
END $$;
SELECT public.save_company_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"name":"Entreprise A modifiée","city":"Abidjan","phone":"+225 0700000000"}');
SELECT public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"name":"Station A modifiée","address":"Cocody","city":"Abidjan","phone":"+225 0700000000","commissionRate":15,"monthlyTarget":100000,"paymentMethods":["especes","wave"]}');
SELECT public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),jsonb_build_object('hours',(
  SELECT jsonb_agg(jsonb_build_object('day',d,'open','08:00','close','18:00','closed',d='Dimanche') ORDER BY ord)
  FROM unnest(ARRAY['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche']) WITH ORDINALITY AS t(d,ord)
)));
INSERT INTO setup_ids SELECT 'catA',public.save_station_category((SELECT id FROM setup_ids WHERE k='stA'),NULL,'Berline',true,false);
INSERT INTO setup_ids SELECT 'serviceA',public.save_station_service((SELECT id FROM setup_ids WHERE k='stA'),NULL,'Lavage','Description',true,false);
INSERT INTO setup_results VALUES
 ('entreprise relue',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'company'->>'name'='Entreprise A modifiée'),
 ('adresse relue',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->>'address'='Cocody'),
 ('sept horaires relus',jsonb_array_length(public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->'hours')=7),
 ('canaux relus',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->'paymentMethods'='["especes","wave"]'::jsonb),
 ('commission et objectif relus',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->>'commissionRate'='15'
   AND public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->>'monthlyTarget'='100000'),
 ('paramètre historique conservé',(SELECT settings->>'legacy_setting'='à conserver' FROM public.stations WHERE id=(SELECT id FROM setup_ids WHERE k='stA'))),
 ('espèces et wave actifs',(SELECT count(*)=2 FROM public.payment_methods WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND key IN ('cash','wave') AND active)),
 ('canal historique inconnu préservé',(SELECT active FROM public.payment_methods WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND key='legacy_cheque'));
DO $$ BEGIN
 BEGIN PERFORM public.activate_station_setup((SELECT id FROM setup_ids WHERE k='stA'));
  INSERT INTO setup_results VALUES('activation sans prix refusée',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('activation sans prix refusée',true); END;
 BEGIN PERFORM public.save_station_price((SELECT id FROM setup_ids WHERE k='stA'),(SELECT id FROM setup_ids WHERE k='serviceA'),(SELECT id FROM setup_ids WHERE k='catA'),-1);
  INSERT INTO setup_results VALUES('prix négatif refusé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('prix négatif refusé',true); END;
 BEGIN PERFORM public.save_station_price((SELECT id FROM setup_ids WHERE k='stB'),(SELECT id FROM setup_ids WHERE k='serviceA'),(SELECT id FROM setup_ids WHERE k='catA'),1000);
  INSERT INTO setup_results VALUES('prix inter-station refusé',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO setup_results VALUES('prix inter-station refusé',true); END;
END $$;
SELECT public.save_station_price((SELECT id FROM setup_ids WHERE k='stA'),(SELECT id FROM setup_ids WHERE k='serviceA'),(SELECT id FROM setup_ids WHERE k='catA'),3000);
SELECT public.save_station_price((SELECT id FROM setup_ids WHERE k='stA'),(SELECT id FROM setup_ids WHERE k='serviceA'),(SELECT id FROM setup_ids WHERE k='catA'),4000);
SELECT public.save_station_price((SELECT id FROM setup_ids WHERE k='stA'),(SELECT id FROM setup_ids WHERE k='serviceA'),(SELECT id FROM setup_ids WHERE k='catA'),4000);
SELECT public.activate_station_setup((SELECT id FROM setup_ids WHERE k='stA'));
SELECT public.activate_station_setup((SELECT id FROM setup_ids WHERE k='stA'));
INSERT INTO setup_results VALUES
 ('prix relu',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'prices'->0->>'price_minor'='4000'),
 ('historique des prix append-only et sans doublon',(SELECT count(*)=2 FROM public.service_price_history WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA'))),
 ('activation persistée',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->>'activated'='true'),
 ('activation idempotente',(SELECT count(*)=1 FROM public.audit_logs WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND action='setup.station_activated'));
-- Un encaissement accepté reste vérifiable après retrait du canal ; une
-- nouvelle opération sur ce même canal est refusée et l'historique préservé.
INSERT INTO setup_ids SELECT 'wash',public.create_wash_atomic(jsonb_build_object(
  'station_id',(SELECT id FROM setup_ids WHERE k='stA'), 'category_id',(SELECT id FROM setup_ids WHERE k='catA'),
  'plate','1111 AA 01','customer_id',NULL,'customer_name','Client test','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId',(SELECT id FROM setup_ids WHERE k='serviceA'),'qty',1)),
  'employee_ids',jsonb_build_array((SELECT id FROM setup_ids WHERE k='ownerA')), 'post_id',NULL,
  'idempotency_key','setup-wash-0001','initial_payment',NULL));
INSERT INTO setup_ids SELECT 'payment',public.record_wash_payment_by_key((SELECT id FROM setup_ids WHERE k='wash'),1000,'wave','','setup-payment-0001');
INSERT INTO setup_ids SELECT 'waveMethod',id FROM public.payment_methods WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND key='wave';
INSERT INTO setup_ids SELECT 'expense',public.record_expense_by_key((SELECT id FROM setup_ids WHERE k='stA'),500,'Produits','Achat de savon','',current_date,'wave','setup-expense-0001');
INSERT INTO setup_payloads SELECT 'initial',jsonb_build_object(
  'station_id',(SELECT id FROM setup_ids WHERE k='stA'), 'category_id',(SELECT id FROM setup_ids WHERE k='catA'),
  'plate','2222 BB 01','customer_id',NULL,'customer_name','Client test','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId',(SELECT id FROM setup_ids WHERE k='serviceA'),'qty',1)),
  'employee_ids',jsonb_build_array((SELECT id FROM setup_ids WHERE k='ownerA')), 'post_id',NULL,
  'idempotency_key','setup-initial-0001','initial_payment',jsonb_build_object('amount_minor',1000,'method_key','wave'));
INSERT INTO setup_ids SELECT 'initialWash',public.create_wash_atomic(payload) FROM setup_payloads WHERE k='initial';
SELECT public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"paymentMethods":["especes"]}');
INSERT INTO setup_results VALUES
 ('rejeu paiement après désélection',public.record_wash_payment_by_key(
  (SELECT id FROM setup_ids WHERE k='wash'),1000,'wave','','setup-payment-0001')=(SELECT id FROM setup_ids WHERE k='payment')),
 ('rejeu direct de paiement après désélection',public.record_payment(
  (SELECT id FROM setup_ids WHERE k='wash'),1000,(SELECT id FROM setup_ids WHERE k='waveMethod'),'','setup-payment-0001')=(SELECT id FROM setup_ids WHERE k='payment')),
 ('rejeu dépense après désélection',public.record_expense_by_key(
  (SELECT id FROM setup_ids WHERE k='stA'),500,'Produits','Achat de savon','',current_date,'wave','setup-expense-0001')=(SELECT id FROM setup_ids WHERE k='expense')),
 ('rejeu création avec paiement initial après désélection',public.create_wash_atomic(
  (SELECT payload FROM setup_payloads WHERE k='initial'))=(SELECT id FROM setup_ids WHERE k='initialWash'));
DO $$ BEGIN
 BEGIN PERFORM public.record_wash_payment_by_key((SELECT id FROM setup_ids WHERE k='wash'),1000,'wave','','setup-payment-0002');
  INSERT INTO setup_results VALUES('nouveau paiement sur canal retiré refusé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('nouveau paiement sur canal retiré refusé',true); END;
 BEGIN PERFORM public.record_wash_payment_by_key((SELECT id FROM setup_ids WHERE k='wash'),2000,'wave','','setup-payment-0001');
  INSERT INTO setup_results VALUES('rejeu à montant modifié refusé',false);
 EXCEPTION WHEN unique_violation THEN INSERT INTO setup_results VALUES('rejeu à montant modifié refusé',true); END;
 BEGIN PERFORM public.record_payment((SELECT id FROM setup_ids WHERE k='wash'),500,(SELECT id FROM setup_ids WHERE k='waveMethod'),'','setup-direct-new');
  INSERT INTO setup_results VALUES('RPC paiement directe sur canal retiré refusée',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('RPC paiement directe sur canal retiré refusée',true); END;
 BEGIN PERFORM public.record_expense_by_key((SELECT id FROM setup_ids WHERE k='stA'),500,'Autre catégorie','Achat de savon','',current_date,'wave','setup-expense-new');
  INSERT INTO setup_results VALUES('nouvelle dépense sur canal retiré refusée',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('nouvelle dépense sur canal retiré refusée',true); END;
 BEGIN PERFORM public.record_expense_by_key((SELECT id FROM setup_ids WHERE k='stA'),600,'Produits','Achat de savon','',current_date,'wave','setup-expense-0001');
  INSERT INTO setup_results VALUES('rejeu dépense modifiée refusé',false);
 EXCEPTION WHEN unique_violation THEN INSERT INTO setup_results VALUES('rejeu dépense modifiée refusé',true); END;
 BEGIN PERFORM public.create_wash_atomic((SELECT payload FROM setup_payloads WHERE k='initial') || '{"idempotency_key":"setup-initial-new"}'::jsonb);
  INSERT INTO setup_results VALUES('nouveau paiement initial sur canal retiré refusé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('nouveau paiement initial sur canal retiré refusé',true); END;
 BEGIN PERFORM public.create_wash_atomic((SELECT payload FROM setup_payloads WHERE k='initial') || '{"plate":"3333 CC 01"}'::jsonb);
  INSERT INTO setup_results VALUES('rejeu création modifiée refusé',false);
 EXCEPTION WHEN unique_violation THEN INSERT INTO setup_results VALUES('rejeu création modifiée refusé',true); END;
END $$;
INSERT INTO setup_results VALUES
 ('paiement historique préservé',(SELECT count(*)=1 AND sum(amount_minor)=1000 FROM public.payments WHERE wash_id=(SELECT id FROM setup_ids WHERE k='wash'))),
 ('dépense historique unique',(SELECT count(*)=1 FROM public.expenses WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA'))),
 ('échec dépense sans catégorie orpheline',NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND name='Autre catégorie')),
 ('paiement initial historique unique',(SELECT count(*)=1 FROM public.payments WHERE wash_id=(SELECT id FROM setup_ids WHERE k='initialWash')));
-- Le taux configuré doit alimenter les calculs réels, pas seulement la relecture.
SELECT public.transition_wash_status((SELECT id FROM setup_ids WHERE k='wash'),'in_progress','');
SELECT public.transition_wash_status((SELECT id FROM setup_ids WHERE k='wash'),'quality_check','');
SELECT public.record_wash_quality_check((SELECT id FROM setup_ids WHERE k='wash'),'approved','RAS');
INSERT INTO setup_ids SELECT 'commissionPeriod',public.create_commission_period((SELECT id FROM setup_ids WHERE k='stA'),current_date,current_date);
SELECT public.generate_commission_lines((SELECT id FROM setup_ids WHERE k='commissionPeriod'));
INSERT INTO setup_results VALUES ('commission serveur à 15 % du lavage terminé',(
  SELECT count(*)=1 AND min(base_minor)=4000 AND min(rate)=15 AND min(amount_minor)=600
  FROM public.employee_commissions WHERE period_id=(SELECT id FROM setup_ids WHERE k='commissionPeriod')));
SELECT public.save_station_category((SELECT id FROM setup_ids WHERE k='stA'),(SELECT id FROM setup_ids WHERE k='catA'),'Berline',false,false);
INSERT INTO setup_results VALUES ('catégorie désactivée toujours relue',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'categories'->0->>'active'='false');
SELECT public.save_station_category((SELECT id FROM setup_ids WHERE k='stA'),(SELECT id FROM setup_ids WHERE k='catA'),'Berline',true,false);
SELECT public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"paymentMethods":["wave"]}');
INSERT INTO setup_results VALUES ('espèces désactivées sans suppression',(SELECT NOT active FROM public.payment_methods WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND key='cash'));
DO $$ BEGIN
 BEGIN PERFORM public.record_wash_payment_by_key('00000000-0000-4000-8000-000000000001',1000,'cash');
  INSERT INTO setup_results VALUES('fiche inconnue refusée',false);
 EXCEPTION WHEN no_data_found THEN INSERT INTO setup_results VALUES('fiche inconnue refusée',true); END;
END $$;
-- Contrôle des tables internes et du helper sous le rôle propriétaire de la base après RESET.
RESET ROLE;
INSERT INTO setup_results VALUES ('échec création atomique sans réservation supplémentaire',
  NOT EXISTS (SELECT 1 FROM public.wash_creation_requests WHERE idempotency_key='setup-initial-new')
  AND (SELECT count(*)=2 FROM public.washes WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA')));
DO $$ BEGIN
 BEGIN PERFORM public.ensure_payment_method((SELECT id FROM setup_ids WHERE k='coA'),(SELECT id FROM setup_ids WHERE k='stA'),'cash');
  INSERT INTO setup_results VALUES('canal désélectionné non réactivé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('canal désélectionné non réactivé',true); END;
 BEGIN INSERT INTO public.payments(company_id,station_id,wash_id,amount_minor,payment_method_id,created_by)
  SELECT (SELECT id FROM setup_ids WHERE k='coA'),(SELECT id FROM setup_ids WHERE k='stA'),
    (SELECT id FROM setup_ids WHERE k='wash'),100,id,(SELECT id FROM setup_ids WHERE k='ownerA')
  FROM public.payment_methods WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND key='cash';
  INSERT INTO setup_results VALUES('trigger bloque insertion sur canal retiré',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('trigger bloque insertion sur canal retiré',true); END;
 BEGIN INSERT INTO public.payments(company_id,station_id,wash_id,amount_minor,payment_method_id,created_by)
  SELECT (SELECT id FROM setup_ids WHERE k='coA'),(SELECT id FROM setup_ids WHERE k='stA'),
    (SELECT id FROM setup_ids WHERE k='wash'),100,id,(SELECT id FROM setup_ids WHERE k='ownerA')
  FROM public.payment_methods WHERE station_id=(SELECT id FROM setup_ids WHERE k='stA') AND key='legacy_cheque';
  INSERT INTO setup_results VALUES('canal historique inconnu interdit pour nouvelle insertion',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO setup_results VALUES('canal historique inconnu interdit pour nouvelle insertion',true); END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM setup_ids WHERE k='cashier'),true);
INSERT INTO setup_results VALUES ('caissier lit sa station',public.my_station_setup((SELECT id FROM setup_ids WHERE k='stA'))->'station'->>'name'='Station A modifiée');
DO $$ BEGIN
 BEGIN PERFORM public.save_station_category((SELECT id FROM setup_ids WHERE k='stA'),NULL,'Intrusion',true,false);
  INSERT INTO setup_results VALUES('caissier ne modifie pas le catalogue',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO setup_results VALUES('caissier ne modifie pas le catalogue',true); END;
 BEGIN PERFORM public.save_station_setup((SELECT id FROM setup_ids WHERE k='stA'),'{"address":"Intrusion"}');
  INSERT INTO setup_results VALUES('caissier ne modifie pas les paramètres',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO setup_results VALUES('caissier ne modifie pas les paramètres',true); END;
 BEGIN UPDATE public.stations SET activated=true WHERE id=(SELECT id FROM setup_ids WHERE k='stA');
  INSERT INTO setup_results VALUES('écriture SQL directe refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO setup_results VALUES('écriture SQL directe refusée',true); END;
END $$;
RESET ROLE;
SELECT label,ok FROM setup_results ORDER BY label;
ROLLBACK;
