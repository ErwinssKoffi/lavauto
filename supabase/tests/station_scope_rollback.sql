-- 054/055 : tests de station, permissions, agrégats et validation. Base isolée uniquement.
BEGIN;
CREATE TEMP TABLE ss_ids(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE ss_results(label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON ss_ids, ss_results TO authenticated, anon;
INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES
  ('77777777-7777-4777-8777-777777777771','station-a@test.invalid',jsonb_build_object('company_name','Entreprise A','station_name','Station A','owner_name','Owner A')),
  ('77777777-7777-4777-8777-777777777772','station-b@test.invalid',jsonb_build_object('company_name','Entreprise B','station_name','Station B','owner_name','Owner B')),
  ('77777777-7777-4777-8777-777777777773','station-reader@test.invalid',jsonb_build_object('invitation',true)),
  ('77777777-7777-4777-8777-777777777774','station-analyst@test.invalid',jsonb_build_object('invitation',true));
INSERT INTO ss_ids VALUES
  ('ownerA','77777777-7777-4777-8777-777777777771'), ('ownerB','77777777-7777-4777-8777-777777777772'),
  ('reader','77777777-7777-4777-8777-777777777773'), ('analyst','77777777-7777-4777-8777-777777777774'),
  ('stA2','cccccccc-cccc-4ccc-8ccc-ccccccccccc3'), ('catA','cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('srvA','cccccccc-cccc-4ccc-8ccc-ccccccccccc2'), ('catA2','cccccccc-cccc-4ccc-8ccc-ccccccccccc4'),
  ('catB','dddddddd-dddd-4ddd-8ddd-ddddddddddd1'), ('productA','cccccccc-cccc-4ccc-8ccc-ccccccccccc5'),
  ('payment','cccccccc-cccc-4ccc-8ccc-ccccccccccc6');
INSERT INTO ss_ids SELECT 'coA',company_id FROM public.user_profiles WHERE id=(SELECT id FROM ss_ids WHERE k='ownerA');
INSERT INTO ss_ids SELECT 'coB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM ss_ids WHERE k='ownerB');
INSERT INTO ss_ids SELECT 'stA',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ss_ids WHERE k='ownerA');
INSERT INTO ss_ids SELECT 'stB',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ss_ids WHERE k='ownerB');
UPDATE public.subscriptions SET plan_id='premium' WHERE company_id IN (SELECT id FROM ss_ids WHERE k IN ('coA','coB'));
UPDATE public.stations SET activated=true WHERE id IN (SELECT id FROM ss_ids WHERE k IN ('stA','stB'));
INSERT INTO public.stations(id,company_id,name,city,activated) VALUES
  ((SELECT id FROM ss_ids WHERE k='stA2'),(SELECT id FROM ss_ids WHERE k='coA'),'Station A2','Bouaké',true);
INSERT INTO public.roles(company_id,key,label_fr) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),'scope_reader','Lecture limitée'),
  ((SELECT id FROM ss_ids WHERE k='coA'),'scope_analyst','Analyste station');
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT id,p FROM public.roles CROSS JOIN (VALUES ('washes.view'),('washes.assign')) AS v(p)
WHERE company_id=(SELECT id FROM ss_ids WHERE k='coA') AND key IN ('scope_reader','scope_analyst');
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT id,p FROM public.roles CROSS JOIN (VALUES ('reports.view'),('analytics.view'),('settings.manage')) AS v(p)
WHERE company_id=(SELECT id FROM ss_ids WHERE k='coA') AND key='scope_analyst';
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id) VALUES
  ((SELECT id FROM ss_ids WHERE k='reader'),(SELECT id FROM ss_ids WHERE k='coA'),'Lecteur A','station-reader@test.invalid',(SELECT id FROM public.roles WHERE key='scope_reader')),
  ((SELECT id FROM ss_ids WHERE k='analyst'),(SELECT id FROM ss_ids WHERE k='coA'),'Analyste A','station-analyst@test.invalid',(SELECT id FROM public.roles WHERE key='scope_analyst'));
INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
SELECT (SELECT id FROM ss_ids WHERE k='coA'), id, (SELECT id FROM ss_ids WHERE k='stA') FROM ss_ids WHERE k IN ('reader','analyst');
INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
VALUES ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='ownerA'),(SELECT id FROM ss_ids WHERE k='stA2'));
INSERT INTO public.vehicle_categories(id,company_id,station_id,name) VALUES
  ((SELECT id FROM ss_ids WHERE k='catA'),(SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),'Berline A'),
  ((SELECT id FROM ss_ids WHERE k='catA2'),(SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA2'),'Berline A2'),
  ((SELECT id FROM ss_ids WHERE k='catB'),(SELECT id FROM ss_ids WHERE k='coB'),(SELECT id FROM ss_ids WHERE k='stB'),'Berline B');
INSERT INTO public.services(id,company_id,station_id,name) VALUES
  ((SELECT id FROM ss_ids WHERE k='srvA'),(SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),'Lavage A');
INSERT INTO public.service_prices(company_id,station_id,service_id,vehicle_category_id,price_minor) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),(SELECT id FROM ss_ids WHERE k='srvA'),(SELECT id FROM ss_ids WHERE k='catA'),1000);
INSERT INTO public.products(id,company_id,station_id,name,unit,reorder_level) VALUES
  ((SELECT id FROM ss_ids WHERE k='productA'),(SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),'Shampooing','unité',1);
INSERT INTO public.customers(company_id,station_id,name,phone,email) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),'Client A','+225 01 02 03 04 05','a@example.invalid'),
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA2'),'Client A2','',''),
  ((SELECT id FROM ss_ids WHERE k='coB'),(SELECT id FROM ss_ids WHERE k='stB'),'Client B','','');
-- Délibérément plus de 200 fiches : la file est paginée, les agrégats ne le sont pas.
INSERT INTO public.washes(company_id,station_id,number,vehicle_category_id,total_minor,created_at)
SELECT (SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),
  'A-' || n,(SELECT id FROM ss_ids WHERE k='catA'),1000,'2026-01-01 12:00:00+00'::timestamptz + n * interval '1 second'
FROM generate_series(1,205) n;
INSERT INTO public.washes(company_id,station_id,number,vehicle_category_id,total_minor,created_at) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA2'),'A2-1',(SELECT id FROM ss_ids WHERE k='catA2'),2000,'2026-01-01 12:00+00'),
  ((SELECT id FROM ss_ids WHERE k='coB'),(SELECT id FROM ss_ids WHERE k='stB'),'B-1',(SELECT id FROM ss_ids WHERE k='catB'),9000,'2026-01-01 12:00+00');
INSERT INTO ss_ids SELECT 'washA',id FROM public.washes WHERE number='A-1';
INSERT INTO public.wash_items(company_id,wash_id,service_id,service_name,unit_price_minor,qty,line_total_minor)
SELECT (SELECT id FROM ss_ids WHERE k='coA'),w.id,(SELECT id FROM ss_ids WHERE k='srvA'),'Lavage A',1000,1,1000
FROM public.washes w WHERE w.station_id=(SELECT id FROM ss_ids WHERE k='stA');
INSERT INTO public.payment_methods(company_id,station_id,key,label,kind,affects_cash) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),'wave','Wave','mobile_money',false);
INSERT INTO public.payments(id,company_id,station_id,wash_id,amount_minor,payment_method_id,created_at)
VALUES ((SELECT id FROM ss_ids WHERE k='payment'),(SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),
  (SELECT id FROM ss_ids WHERE k='washA'),700,(SELECT id FROM public.payment_methods WHERE station_id=(SELECT id FROM ss_ids WHERE k='stA') AND key='wave'),'2026-01-02 12:00+00');
INSERT INTO public.payment_cancellations(company_id,station_id,payment_id,amount_minor,reason,created_at) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),(SELECT id FROM ss_ids WHERE k='payment'),700,'Remboursement','2026-01-03 12:00+00');
INSERT INTO public.expenses(company_id,station_id,amount_minor,reason,spent_at) VALUES
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA'),100,'Eau','2026-01-02'),
  ((SELECT id FROM ss_ids WHERE k='coA'),(SELECT id FROM ss_ids WHERE k='stA2'),200,'Autre','2026-01-02');
-- Une attestation historique ne prouve pas son périmètre de stations.
INSERT INTO public.finance_cost_periods(company_id,start_date,end_date,revenue_minor,consumption_cost_minor,operating_expense_minor,
  commission_cost_minor,fixed_cost_minor,gross_margin_minor,result_minor,stock_movement_count,valued_consumptions,attestation)
VALUES ((SELECT id FROM ss_ids WHERE k='coA'),'2026-01-01','2026-01-03',207000,0,300,0,0,207000,206700,0,0,'Attestation historique entreprise');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ss_ids WHERE k='ownerA'),true);
INSERT INTO ss_results VALUES
  ('contexte propriétaire : deux stations',jsonb_array_length(public.my_context()->'stations')=2),
  ('file A limitée à 200',jsonb_array_length(public.my_station_wash_board((SELECT id FROM ss_ids WHERE k='stA')))=200),
  ('file A2 isolée',jsonb_array_length(public.my_station_wash_board((SELECT id FROM ss_ids WHERE k='stA2')))=1),
  ('clients séparés',jsonb_array_length(public.my_station_clients((SELECT id FROM ss_ids WHERE k='stA')))=1
    AND jsonb_array_length(public.my_station_clients((SELECT id FROM ss_ids WHERE k='stA2')))=1),
  ('métriques exhaustives au-delà de 200', (public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'trend'->0->>'washCount')::int=205
    AND (public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'topServices'->0->>'count')::int=205),
  ('paiement et annulation à leurs dates', (public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'trend'->1->>'collected')::int=700
    AND (public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'trend'->2->>'collected')::int=-700),
  ('ventilation par canal et jour', (public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'byDayMethod'->0->>'amount')::int=700
    AND (public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'byDayMethod'->1->>'amount')::int=-700),
  ('rapport station non certifié malgré ancienne attestation', public.my_station_profitability((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->>'result' IS NULL
    AND (public.my_station_profitability((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->>'certified')::boolean=false),
  ('consolidation deux stations sans entreprise B', (public.my_accessible_analytics_board('2026-01-01','2026-01-03')->'period'->>'revenue')::int=207000
    AND jsonb_array_length(public.my_accessible_analytics_board('2026-01-01','2026-01-03')->'stations')=2),
  ('finance séparée par station', jsonb_array_length(public.my_station_finance_board((SELECT id FROM ss_ids WHERE k='stA'))->'expenses')=1
    AND jsonb_array_length(public.my_station_finance_board((SELECT id FROM ss_ids WHERE k='stA2'))->'expenses')=1),
  ('stock séparé par station', jsonb_array_length(public.my_station_stock_board((SELECT id FROM ss_ids WHERE k='stA'))->'products')=1
    AND jsonb_array_length(public.my_station_stock_board((SELECT id FROM ss_ids WHERE k='stA2'))->'products')=0),
  ('CRM séparé par station', jsonb_array_length(public.my_station_crm_board((SELECT id FROM ss_ids WHERE k='stA'))->'clients')=1
    AND jsonb_array_length(public.my_station_crm_board((SELECT id FROM ss_ids WHERE k='stA2'))->'clients')=1),
  ('affectables sans coordonnées', jsonb_array_length(public.my_station_assignable_users((SELECT id FROM ss_ids WHERE k='stA')))=3
    AND NOT (public.my_station_assignable_users((SELECT id FROM ss_ids WHERE k='stA'))->0 ? 'email'));
DO $$ BEGIN
  BEGIN PERFORM public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stB'),'2026-01-01','2026-01-03');
    INSERT INTO ss_results VALUES ('autre entreprise refusée',false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ss_results VALUES ('autre entreprise refusée',true); END;
  BEGIN PERFORM public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-04-01','2026-01-01');
    INSERT INTO ss_results VALUES ('période inversée refusée',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('période inversée refusée',true); END;
  BEGIN PERFORM public.create_wash_with_items((SELECT id FROM ss_ids WHERE k='stA'),(SELECT id FROM ss_ids WHERE k='catA'),'','',NULL,'',0,
    jsonb_build_array(jsonb_build_object('service_id',(SELECT id FROM ss_ids WHERE k='srvA'),'qty',0)),'bad-qty');
    INSERT INTO ss_results VALUES ('quantité zéro refusée avant création',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('quantité zéro refusée avant création',true); END;
  BEGIN PERFORM public.create_wash_with_items((SELECT id FROM ss_ids WHERE k='stA'),(SELECT id FROM ss_ids WHERE k='catA'),'','',NULL,'',1001,
    jsonb_build_array(jsonb_build_object('service_id',(SELECT id FROM ss_ids WHERE k='srvA'),'qty',1)),'bad-discount');
    INSERT INTO ss_results VALUES ('remise excessive refusée',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('remise excessive refusée',true); END;
  BEGIN PERFORM public.save_customer_profile((SELECT id FROM ss_ids WHERE k='stA'),'Contact invalide','123','');
    INSERT INTO ss_results VALUES ('téléphone invalide refusé',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('téléphone invalide refusé',true); END;
  BEGIN PERFORM public.save_customer_profile((SELECT id FROM ss_ids WHERE k='stA'),'Contact invalide','','pas-un-email');
    INSERT INTO ss_results VALUES ('courriel invalide refusé',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('courriel invalide refusé',true); END;
  BEGIN PERFORM public.save_service_consumption((SELECT id FROM ss_ids WHERE k='srvA'),(SELECT id FROM ss_ids WHERE k='productA'),0.0001,true);
    INSERT INTO ss_results VALUES ('consommation fractionnaire excessive refusée',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('consommation fractionnaire excessive refusée',true); END;
  BEGIN PERFORM public.open_cash_session((SELECT id FROM ss_ids WHERE k='stA'),-1,'C-NEG');
    INSERT INTO ss_results VALUES ('fond négatif refusé sans normalisation',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('fond négatif refusé sans normalisation',true); END;
END $$;

-- Nouvelle certification : le périmètre de deux stations est figé et ne
-- doit jamais être distribué à une station ou à un utilisateur moins autorisé.
SELECT public.certify_profitability_period('2026-01-01','2026-01-02','Je certifie les coûts des deux stations.');
INSERT INTO ss_results VALUES
  ('certification consolidée sur périmètre exact',
    (public.my_accessible_profitability('2026-01-01','2026-01-02')->>'certified')::boolean
    AND (public.my_accessible_profitability('2026-01-01','2026-01-02')->>'result')::int=206700),
  ('certification entreprise non distribuée par station',
    NOT (public.my_station_profitability((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-02')->>'certified')::boolean
    AND public.my_station_profitability((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-02')->>'result' IS NULL),
  ('ancienne RPC respecte le périmètre connu',
    (public.my_profitability('2026-01-01','2026-01-02')->>'result')::int=206700);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ss_ids WHERE k='ownerB'),true);
SELECT public.certify_profitability_period('2026-01-01','2026-01-02','Je certifie les coûts de cette station.');
INSERT INTO ss_results VALUES ('certification de l’unique station',
  (public.my_station_profitability((SELECT id FROM ss_ids WHERE k='stB'),'2026-01-01','2026-01-02')->>'certified')::boolean
  AND (public.my_station_profitability((SELECT id FROM ss_ids WHERE k='stB'),'2026-01-01','2026-01-02')->>'result')::int=9000);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ss_ids WHERE k='ownerA'),true);

-- Caisse, paiement et dépense : écritures réelles en rollback sur la station A.
INSERT INTO ss_ids SELECT 'session',public.open_cash_session((SELECT id FROM ss_ids WHERE k='stA'),10000,'C-SS-1');
INSERT INTO ss_ids SELECT 'washFinance',id FROM public.washes WHERE number='A-2';
INSERT INTO ss_ids SELECT 'paymentFinance',public.record_wash_payment_by_key((SELECT id FROM ss_ids WHERE k='washFinance'),600,'cash','','finance-pay-key');
INSERT INTO ss_results VALUES
  ('paiement rejoué à contenu identique',public.record_wash_payment_by_key((SELECT id FROM ss_ids WHERE k='washFinance'),600,'cash','','finance-pay-key')=(SELECT id FROM ss_ids WHERE k='paymentFinance')),
  ('paiement et mouvement uniques',(SELECT count(*) FROM public.payments WHERE idempotency_key='finance-pay-key')=1
    AND (SELECT count(*) FROM public.cash_movements WHERE payment_id=(SELECT id FROM ss_ids WHERE k='paymentFinance'))=1
    AND (SELECT paid_minor FROM public.washes WHERE id=(SELECT id FROM ss_ids WHERE k='washFinance'))=600);
DO $$ BEGIN
  BEGIN PERFORM public.record_wash_payment_by_key((SELECT id FROM ss_ids WHERE k='washFinance'),500,'cash','','finance-pay-key');
    INSERT INTO ss_results VALUES ('collision paiement refusée',false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO ss_results VALUES ('collision paiement refusée',true); END;
  BEGIN PERFORM public.record_wash_payment_by_key((SELECT id FROM ss_ids WHERE k='washFinance'),401,'cash','','finance-surplus-key');
    INSERT INTO ss_results VALUES ('surpaiement refusé',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('surpaiement refusé',true); END;
  BEGIN PERFORM public.open_cash_session((SELECT id FROM ss_ids WHERE k='stA'),0,'C-SS-2');
    INSERT INTO ss_results VALUES ('deuxième caisse refusée',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('deuxième caisse refusée',true); END;
END $$;
INSERT INTO ss_ids SELECT 'expenseFinance',public.record_expense_by_key((SELECT id FROM ss_ids WHERE k='stA'),100,'Eau','Réparation','','2026-01-02','cash','finance-expense-key');
INSERT INTO ss_results VALUES ('dépense rejouée à contenu identique',
  public.record_expense_by_key((SELECT id FROM ss_ids WHERE k='stA'),100,'Eau','Réparation','','2026-01-02','cash','finance-expense-key')=(SELECT id FROM ss_ids WHERE k='expenseFinance'));
DO $$ BEGIN
  BEGIN PERFORM public.record_expense_by_key((SELECT id FROM ss_ids WHERE k='stA'),101,'Eau','Réparation','','2026-01-02','cash','finance-expense-key');
    INSERT INTO ss_results VALUES ('collision dépense refusée',false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO ss_results VALUES ('collision dépense refusée',true); END;
  BEGIN PERFORM public.record_expense_by_key((SELECT id FROM ss_ids WHERE k='stA2'),100,'Eau','Réparation','','2026-01-02','cash','finance-expense-key');
    INSERT INTO ss_results VALUES ('collision dépense inter-stations refusée',false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO ss_results VALUES ('collision dépense inter-stations refusée',true); END;
END $$;
SELECT public.cancel_expense((SELECT id FROM ss_ids WHERE k='expenseFinance'),'Erreur saisie');
SELECT public.close_cash_session((SELECT id FROM ss_ids WHERE k='session'),10600);
INSERT INTO ss_results VALUES ('clôture après paiement et annulation dépense',
  EXISTS(SELECT 1 FROM public.cash_closures WHERE cash_session_id=(SELECT id FROM ss_ids WHERE k='session')
    AND theoretical_minor=10600 AND difference_minor=0));
DO $$ BEGIN
  BEGIN PERFORM public.cancel_payment((SELECT id FROM ss_ids WHERE k='paymentFinance'),'Erreur saisie');
    INSERT INTO ss_results VALUES ('annulation après clôture refusée',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO ss_results VALUES ('annulation après clôture refusée',true); END;
END $$;
SELECT public.reopen_cash_session((SELECT id FROM ss_ids WHERE k='session'),'Correction');
SELECT public.cancel_payment((SELECT id FROM ss_ids WHERE k='paymentFinance'),'Erreur saisie');
SELECT public.close_cash_session((SELECT id FROM ss_ids WHERE k='session'),10000);
INSERT INTO ss_results VALUES
  ('remboursement tracé après réouverture',(SELECT paid_minor FROM public.washes WHERE id=(SELECT id FROM ss_ids WHERE k='washFinance'))=0
    AND (SELECT count(*) FROM public.payment_cancellations WHERE payment_id=(SELECT id FROM ss_ids WHERE k='paymentFinance'))=1),
  ('seconde clôture repart du comptage précédent',EXISTS(SELECT 1 FROM public.cash_closures WHERE cash_session_id=(SELECT id FROM ss_ids WHERE k='session')
    AND theoretical_minor=10000 AND difference_minor=0));

SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ss_ids WHERE k='reader'),true);
INSERT INTO ss_results VALUES
  ('lecteur : une seule station dans contexte',jsonb_array_length(public.my_context()->'stations')=1),
  ('lecteur : finance masquée',public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'trend'->0->>'collected' IS NULL
    AND jsonb_array_length(public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'byMethod')=0),
  ('lecteur : détails nominatifs masqués',jsonb_array_length(public.my_station_metrics((SELECT id FROM ss_ids WHERE k='stA'),'2026-01-01','2026-01-03')->'bestClients')=0);
DO $$ BEGIN
  BEGIN PERFORM public.my_station_wash_board((SELECT id FROM ss_ids WHERE k='stA2'));
    INSERT INTO ss_results VALUES ('station non affectée refusée',false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ss_results VALUES ('station non affectée refusée',true); END;
  BEGIN PERFORM public.my_station_finance_board((SELECT id FROM ss_ids WHERE k='stA'));
    INSERT INTO ss_results VALUES ('finance sans permission refusée',false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ss_results VALUES ('finance sans permission refusée',true); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ss_ids WHERE k='analyst'),true);
INSERT INTO ss_results VALUES
  ('consolidation restreinte aux stations affectées', (public.my_accessible_analytics_board('2026-01-01','2026-01-03')->'period'->>'revenue')::int=205000
    AND jsonb_array_length(public.my_accessible_analytics_board('2026-01-01','2026-01-03')->'stations')=1),
  ('résultat consolidé non certifié',public.my_accessible_analytics_board('2026-01-01','2026-01-03')->'period'->>'result' IS NULL),
  ('attestation masquée après restriction des stations',
    NOT (public.my_accessible_profitability('2026-01-01','2026-01-02')->>'certified')::boolean
    AND public.my_profitability('2026-01-01','2026-01-02')->>'result' IS NULL);
DO $$ BEGIN
  BEGIN PERFORM public.certify_profitability_period('2026-01-04','2026-01-05','Attestation du périmètre restreint');
    INSERT INTO ss_results VALUES ('certification partielle refusée',false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ss_results VALUES ('certification partielle refusée',true); END;
END $$;
RESET ROLE;
INSERT INTO ss_results VALUES
  ('échecs sans fiche partielle',NOT EXISTS(SELECT 1 FROM public.washes WHERE idempotency_key IN ('bad-qty','bad-discount'))),
  ('périmètre de certification figé',
    (SELECT cardinality(certification_station_ids) FROM public.finance_cost_periods
     WHERE company_id=(SELECT id FROM ss_ids WHERE k='coA') AND start_date='2026-01-01' AND end_date='2026-01-02')=2);
DO $$ BEGIN
  BEGIN UPDATE public.finance_cost_periods SET certification_station_ids=ARRAY[(SELECT id FROM ss_ids WHERE k='stA')]
    WHERE company_id=(SELECT id FROM ss_ids WHERE k='coA') AND start_date='2026-01-01' AND end_date='2026-01-02';
    INSERT INTO ss_results VALUES ('périmètre certifié immuable',false);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO ss_results VALUES ('périmètre certifié immuable',true); END;
END $$;
SELECT label,ok FROM ss_results ORDER BY label;
ROLLBACK;
