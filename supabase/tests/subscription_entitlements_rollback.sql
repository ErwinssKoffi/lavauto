-- Recette isolée 057 : bootstrap, demandes, activation, droits et expiration.
-- Transaction annulée ; ne jamais exécuter sur une base de production.
BEGIN;
CREATE TEMP TABLE sub_ids(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE sub_results(label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON sub_ids, sub_results TO anon, authenticated, service_role;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('77777777-7777-4777-8777-777777777771','sub-owner@test.invalid',
  '{"company_name":"Essai A","station_name":"Station A","owner_name":"Owner A","requested_plan_id":"standard"}'),
 ('77777777-7777-4777-8777-777777777772','sub-expired@test.invalid',
  '{"company_name":"Essai B","station_name":"Station B","owner_name":"Owner B"}'),
 ('77777777-7777-4777-8777-777777777773','sub-admin@test.invalid','{"invitation":true}'),
 ('77777777-7777-4777-8777-777777777774','sub-legacy@test.invalid','{"invitation":true}'),
 ('77777777-7777-4777-8777-777777777775','sub-employee@test.invalid','{"invitation":true}');
INSERT INTO sub_ids VALUES ('owner','77777777-7777-4777-8777-777777777771'),
 ('expired','77777777-7777-4777-8777-777777777772'),('admin','77777777-7777-4777-8777-777777777773'),
 ('legacy','77777777-7777-4777-8777-777777777774'),('employee','77777777-7777-4777-8777-777777777775');
INSERT INTO sub_ids SELECT 'company',company_id FROM public.user_profiles WHERE id=(SELECT id FROM sub_ids WHERE k='owner');
INSERT INTO sub_ids SELECT 'station',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM sub_ids WHERE k='owner');
INSERT INTO sub_ids SELECT 'companyB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM sub_ids WHERE k='expired');
INSERT INTO sub_ids SELECT 'stationB',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM sub_ids WHERE k='expired');
INSERT INTO sub_ids SELECT 'request',id FROM public.subscription_changes WHERE company_id=(SELECT id FROM sub_ids WHERE k='company') AND status='pending';
INSERT INTO public.platform_admins(user_id) VALUES ((SELECT id FROM sub_ids WHERE k='admin'));
-- Deux tenants avec des agrégats distincts : une vue vide ne prouverait pas
-- l'isolation effective de security_invoker après la restriction des colonnes.
INSERT INTO public.vehicle_categories(company_id,station_id,name) VALUES
 ((SELECT id FROM sub_ids WHERE k='company'),(SELECT id FROM sub_ids WHERE k='station'),'Vue A'),
 ((SELECT id FROM sub_ids WHERE k='companyB'),(SELECT id FROM sub_ids WHERE k='stationB'),'Vue B');
INSERT INTO public.washes(company_id,station_id,number,vehicle_category_id,total_minor) VALUES
 ((SELECT id FROM sub_ids WHERE k='company'),(SELECT id FROM sub_ids WHERE k='station'),'VUE-A',
   (SELECT id FROM public.vehicle_categories WHERE station_id=(SELECT id FROM sub_ids WHERE k='station') AND name='Vue A'),0),
 ((SELECT id FROM sub_ids WHERE k='companyB'),(SELECT id FROM sub_ids WHERE k='stationB'),'VUE-B',
   (SELECT id FROM public.vehicle_categories WHERE station_id=(SELECT id FROM sub_ids WHERE k='stationB') AND name='Vue B'),54321);
INSERT INTO sub_results VALUES
 ('quota Premium jamais annoncé illimité par le libellé historique',
   NOT (SELECT features @> '["Lavages illimités"]'::jsonb FROM public.plans WHERE id='premium')
   AND (SELECT features @> '["Quota mensuel défini par la formule"]'::jsonb FROM public.plans WHERE id='premium')),
 ('bootstrap crée essai et demande sans activation',(SELECT plan_id='essai' AND status='trial' AND pending_plan_id='standard'
   AND trial_ends_at=started_at + interval '14 days' FROM public.subscriptions WHERE company_id=(SELECT id FROM sub_ids WHERE k='company'))),
 ('une demande initiale existe',(SELECT count(*)=1 FROM public.subscription_changes WHERE company_id=(SELECT id FROM sub_ids WHERE k='company') AND status='pending')),
 ('écritures abonnements et demandes directes révoquées',NOT has_table_privilege('authenticated','public.subscriptions','UPDATE')
   AND NOT has_table_privilege('authenticated','public.subscription_changes','INSERT')
   AND NOT has_table_privilege('authenticated','public.subscription_changes','UPDATE')),
 ('anciens points de contournement interdits',NOT has_function_privilege('authenticated','public.admin_set_company_subscription(uuid,text,text)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.bootstrap_company_from_auth_user(uuid,text,jsonb)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.subscription_period_reason(text,text,timestamptz,date,timestamptz)','EXECUTE')
   AND NOT has_function_privilege('anon','public.request_subscription_plan(text)','EXECUTE'));

-- Le même helper sert à l'autorisation et au motif de my_subscription_access.
-- Tester les instants exacts sans modifier l'horloge du système PostgreSQL.
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
INSERT INTO sub_results VALUES
 ('frontière payante UTC exclusive à la microseconde',
   public.subscription_period_reason('standard','active',NULL,'2028-01-01','2027-12-31 23:59:59.999999+00') IS NULL
   AND public.subscription_period_reason('standard','active',NULL,'2028-01-01','2028-01-01 00:00:00+00')='period_expired'
   AND public.subscription_period_reason('standard','active',NULL,'2028-01-01','2028-01-01 00:00:00.000001+00')='period_expired'),
 ('frontière essai exclusive et statuts invalides fermés',
   public.subscription_period_reason('essai','trial','2028-01-01 00:00:00+00',NULL,'2027-12-31 23:59:59.999999+00') IS NULL
   AND public.subscription_period_reason('essai','trial','2028-01-01 00:00:00+00',NULL,'2028-01-01 00:00:00+00')='trial_expired'
   AND public.subscription_period_reason('essai','active',NULL,'2028-01-01','2027-12-31 23:00:00+00')='invalid_status'
   AND public.subscription_period_reason('premium','active',NULL,NULL,'2027-12-31 23:00:00+00')='period_expired');
SET LOCAL TIME ZONE 'UTC';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='owner'),true);
INSERT INTO sub_results VALUES
 ('essai complet actif',public.my_subscription_access()->>'planId'='essai'
   AND (public.my_subscription_access()->>'canWrite')::boolean
   AND (public.my_subscription_access()->'features'->>'stock')::boolean
   AND public.has_permission('inventory.view') AND public.has_permission('crm.view')),
 ('choix ne remplace pas essai',public.my_subscription_access()->>'pendingPlanId'='standard'),
 ('redemande identique idempotente',public.request_subscription_plan('standard')=(SELECT id FROM sub_ids WHERE k='request'));
DO $$ BEGIN
 BEGIN PERFORM public.admin_decide_subscription_request((SELECT id FROM sub_ids WHERE k='request'),true);
  INSERT INTO sub_results VALUES('propriétaire ne valide pas lui-même',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('propriétaire ne valide pas lui-même',true); END;
 BEGIN UPDATE public.subscriptions SET plan_id='premium' WHERE company_id=(SELECT id FROM sub_ids WHERE k='company');
  INSERT INTO sub_results VALUES('abonnement non modifiable en direct',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('abonnement non modifiable en direct',true); END;
END $$;
-- Données avancées réelles : leurs champs, listes et totaux doivent être
-- masqués en Standard mais réapparaître sans perte après retour en Premium.
INSERT INTO sub_ids SELECT 'product',public.save_product((SELECT id FROM sub_ids WHERE k='station'),'Shampoing','test-shampoo','', 'unité',0,true,NULL);
-- Mouvements de fixture non nuls et attestation historique : l'occultation
-- doit s'appliquer aux rapports, pas uniquement aux tables sous RLS.
RESET ROLE;
INSERT INTO public.stock_movements(company_id,station_id,product_id,kind,qty_delta,unit_cost_minor) VALUES
 ((SELECT id FROM sub_ids WHERE k='company'),(SELECT id FROM sub_ids WHERE k='station'),(SELECT id FROM sub_ids WHERE k='product'),'purchase_receipt',2,1234),
 ((SELECT id FROM sub_ids WHERE k='company'),(SELECT id FROM sub_ids WHERE k='station'),(SELECT id FROM sub_ids WHERE k='product'),'consumption',-1,1234);
SET LOCAL ROLE authenticated;
SELECT public.certify_profitability_period(current_date,current_date,'Attestation complète des coûts de test');
INSERT INTO sub_results VALUES ('essai conserve coûts et attestation certifiés',
 (public.my_station_profitability((SELECT id FROM sub_ids WHERE k='station'),current_date,current_date)->>'purchases')::bigint=2468
 AND (public.my_profitability(current_date,current_date)->>'consumptions')::bigint=1234
 AND (public.my_profitability(current_date,current_date)->>'certified')::boolean);
INSERT INTO sub_ids SELECT 'fleet',public.save_fleet((SELECT id FROM sub_ids WHERE k='station'),'Flotte Premium');
INSERT INTO sub_ids SELECT 'client',public.save_customer_profile((SELECT id FROM sub_ids WHERE k='station'),'Cliente Premium',
  '','','','none',true,NULL,(SELECT id FROM sub_ids WHERE k='fleet'));
INSERT INTO sub_ids SELECT 'vehicle',public.save_customer_vehicle((SELECT id FROM sub_ids WHERE k='station'),
  (SELECT id FROM sub_ids WHERE k='client'),'PREM-01');
INSERT INTO sub_ids SELECT 'program',public.create_loyalty_program((SELECT id FROM sub_ids WHERE k='station'),'Fidélité Premium');
SELECT public.enroll_loyalty_customer((SELECT id FROM sub_ids WHERE k='station'),(SELECT id FROM sub_ids WHERE k='client'),
  (SELECT id FROM sub_ids WHERE k='program'),'CARD-PREMIUM');
INSERT INTO sub_ids SELECT 'contract',public.save_fleet_contract((SELECT id FROM sub_ids WHERE k='station'),
  (SELECT id FROM sub_ids WHERE k='fleet'),'CONTRAT-PREMIUM',current_date,current_date+365,0,100000,'active');
SELECT public.record_fleet_receivable((SELECT id FROM sub_ids WHERE k='station'),(SELECT id FROM sub_ids WHERE k='fleet'),
  (SELECT id FROM sub_ids WHERE k='contract'),12000);
INSERT INTO sub_results VALUES ('essai lit les données avancées initiales',
  (public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'stats'->>'fleets')::integer=1
  AND (public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'stats'->>'openReceivablesMinor')::integer=12000
  AND (public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'stats'->>'activeCards')::integer=1);

SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='admin'),true);
INSERT INTO sub_results VALUES ('demande visible à la plateforme',jsonb_array_length(public.admin_subscription_requests())=1);
SELECT public.admin_decide_subscription_request((SELECT id FROM sub_ids WHERE k='request'),true);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='owner'),true);
INSERT INTO sub_results VALUES
 ('standard activé explicitement',public.my_subscription_access()->>'planId'='standard'
   AND public.my_subscription_access()->>'status'='active' AND public.my_subscription_access()->>'pendingPlanId' IS NULL
   AND (public.my_subscription_access()->>'canWrite')::boolean),
 ('standard conserve le coeur',public.has_permission('customers.manage') AND public.has_permission('reports.view')
   AND public.has_permission('commissions.view')),
 ('standard exclut les modules avancés',NOT public.has_permission('inventory.view')
   AND NOT public.has_permission('crm.view') AND NOT public.has_permission('fleets.view')
   AND NOT public.has_permission('analytics.view') AND NOT public.has_permission('audit.view')),
 ('donnée stock masquée en accès direct',(SELECT count(*)=0 FROM public.products WHERE id=(SELECT id FROM sub_ids WHERE k='product'))),
 ('clients restent consultables',jsonb_typeof(public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'clients')='array'
   AND jsonb_array_length(public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'loyaltyPrograms')=0),
 ('listes et totaux avancés masqués dans les deux boards',
   jsonb_array_length(public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'fleets')=0
   AND jsonb_array_length(public.my_crm_board()->'loyaltyCards')=0
   AND public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'stats'->'fleets'='null'::jsonb
   AND public.my_crm_board()->'stats'->'openReceivablesMinor'='null'::jsonb
   AND public.my_crm_board()->'stats'->'activeCards'='null'::jsonb),
 ('champs avancés masqués dans les deux boards',
   NOT ((public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'clients'->0) ? 'fleetId')
   AND NOT ((public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'clients'->0) ? 'loyaltyOptIn')
   AND NOT ((public.my_crm_board()->'vehicles'->0) ? 'fleetId')),
 ('colonnes avancées non exposées directement',
   NOT has_column_privilege('authenticated','public.customers','fleet_id','SELECT')
   AND NOT has_column_privilege('authenticated','public.customers','loyalty_opt_in','SELECT')
   AND NOT has_column_privilege('authenticated','public.vehicles','fleet_id','SELECT')
   AND NOT has_column_privilege('authenticated','public.washes','promotion_id','SELECT')
   AND has_column_privilege('authenticated','public.customers','name','SELECT')),
 ('lecture directe des colonnes essentielles et vues security_invoker',
   (SELECT count(*)=1 FROM public.customers WHERE name='Cliente Premium')
   AND has_table_privilege('authenticated','public.v_station_daily_activity','SELECT')
   AND has_table_privilege('authenticated','public.v_company_quota_usage','SELECT')
   AND NOT has_table_privilege('anon','public.v_station_daily_activity','SELECT')
   AND NOT has_table_privilege('anon','public.v_company_quota_usage','SELECT')
   AND NOT has_table_privilege('authenticated','public.v_station_daily_activity','UPDATE')
   AND NOT has_table_privilege('authenticated','public.v_company_quota_usage','UPDATE')
   AND (SELECT count(*)=1 AND max(revenue_minor)=0 FROM public.v_station_daily_activity
     WHERE company_id=(SELECT id FROM sub_ids WHERE k='company'))
   AND (SELECT count(*)=1 FROM public.v_company_quota_usage WHERE company_id=(SELECT id FROM sub_ids WHERE k='company'))),
 ('vues security_invoker isolent effectivement le second tenant',
   (SELECT count(*)=0 FROM public.v_station_daily_activity WHERE company_id=(SELECT id FROM sub_ids WHERE k='companyB'))
   AND (SELECT count(*)=0 FROM public.v_company_quota_usage WHERE company_id=(SELECT id FROM sub_ids WHERE k='companyB'))),
 ('rapports masquent coûts et attestation sans les remplacer par zéro',
   public.my_station_profitability((SELECT id FROM sub_ids WHERE k='station'),current_date,current_date)->'purchases'='null'::jsonb
   AND public.my_station_profitability((SELECT id FROM sub_ids WHERE k='station'),current_date,current_date)->'consumptions'='null'::jsonb
   AND public.my_accessible_profitability(current_date,current_date)->'operatingExpenses'='null'::jsonb
   AND public.my_accessible_profitability(current_date,current_date)->'fixedCosts'='null'::jsonb
   AND public.my_profitability(current_date,current_date)->'grossMargin'='null'::jsonb
   AND public.my_profitability(current_date,current_date)->'result'='null'::jsonb
   AND public.my_profitability(current_date,current_date)->'attestation'='null'::jsonb
   AND NOT (public.my_profitability(current_date,current_date)->>'certified')::boolean
   AND (public.my_profitability(current_date,current_date)->>'costsMissing')::boolean
   AND (public.my_profitability(current_date,current_date)->>'revenue')::bigint=0),
 ('projections et commandes non filtrées non exécutables directement',
   NOT has_function_privilege('authenticated','public.wg_station_profitability_unfiltered(uuid,date,date)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wg_accessible_profitability_unfiltered(date,date)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wg_link_expense_to_purchase_order_unchecked(uuid,uuid)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.wg_apply_promotion_to_wash_unchecked(uuid,text,text)','EXECUTE')),
 ('validation ouvre une période mensuelle explicite',
   (public.my_subscription_access()->>'currentPeriodEnd')::date =
     ((clock_timestamp() AT TIME ZONE 'UTC')::date + interval '1 month')::date),
 ('validation anticipée remplace immédiatement l’essai non expiré',
   (public.my_subscription_access()->>'trialEndsAt')::timestamptz > clock_timestamp()
   AND public.my_subscription_access()->>'planId'='standard'
   AND public.my_subscription_access()->>'status'='active'
   AND NOT (public.my_subscription_access()->'features'->>'stock')::boolean);
DO $$ BEGIN
 BEGIN PERFORM fleet_id FROM public.customers WHERE id=(SELECT id FROM sub_ids WHERE k='client');
  INSERT INTO sub_results VALUES('colonne flotte inaccessible réellement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('colonne flotte inaccessible réellement',true); END;
 BEGIN PERFORM * FROM public.washes;
  INSERT INTO sub_results VALUES('select étoile inaccessible réellement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('select étoile inaccessible réellement',true); END;
 BEGIN PERFORM public.my_station_stock_board((SELECT id FROM sub_ids WHERE k='station'));
  INSERT INTO sub_results VALUES('board stock refusé en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('board stock refusé en standard',true); END;
 BEGIN PERFORM public.my_accessible_analytics_board(current_date,current_date,NULL,NULL);
  INSERT INTO sub_results VALUES('consolidation refusée en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('consolidation refusée en standard',true); END;
 BEGIN PERFORM public.save_product((SELECT id FROM sub_ids WHERE k='station'),'Produit refusé','rejected','', 'unité',0,true,NULL);
  INSERT INTO sub_results VALUES('écriture stock refusée en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('écriture stock refusée en standard',true); END;
 BEGIN PERFORM public.link_expense_to_purchase_order((SELECT id FROM sub_ids WHERE k='client'),(SELECT id FROM sub_ids WHERE k='product'));
  INSERT INTO sub_results VALUES('rattachement stock refusé avant lecture en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('rattachement stock refusé avant lecture en standard',true); END;
 BEGIN PERFORM public.certify_profitability_period(current_date,current_date,'Nouvelle attestation de test complète');
  INSERT INTO sub_results VALUES('certification refusée avant lecture en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('certification refusée avant lecture en standard',true); END;
 BEGIN PERFORM public.accrue_loyalty_for_wash((SELECT id FROM sub_ids WHERE k='client'),'test');
  INSERT INTO sub_results VALUES('fidélité refusée avant lecture en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('fidélité refusée avant lecture en standard',true); END;
 BEGIN PERFORM public.consume_package_for_wash((SELECT id FROM sub_ids WHERE k='client'));
  INSERT INTO sub_results VALUES('forfait refusé avant lecture en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('forfait refusé avant lecture en standard',true); END;
 BEGIN PERFORM public.apply_promotion_to_wash((SELECT id FROM sub_ids WHERE k='client'),'TEST','test');
  INSERT INTO sub_results VALUES('promotion refusée avant lecture en standard',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('promotion refusée avant lecture en standard',true); END;
END $$;
-- Les capacités étant indépendantes, vérifier une configuration personnalisée
-- « consolidation sans stock » : les deux boards ne doivent rien divulguer.
RESET ROLE;
UPDATE public.plan_entitlements SET enabled=true WHERE plan_id='standard' AND feature_key='consolidation';
SET LOCAL ROLE authenticated;
INSERT INTO sub_results VALUES ('consolidation personnalisée sans stock garde les montants masqués',
 public.my_accessible_analytics_board(current_date,current_date,NULL,NULL)->'stations'->0->'consumptions'='null'::jsonb
 AND public.my_analytics_board(current_date,current_date,NULL,NULL)->'stations'->0->'consumptions'='null'::jsonb
 AND public.my_accessible_analytics_board(current_date,current_date,NULL,NULL)->'period'->'result'='null'::jsonb
 AND NOT (public.my_analytics_board(current_date,current_date,NULL,NULL)->'stats'->>'certified')::boolean);
RESET ROLE;
UPDATE public.plan_entitlements SET enabled=false WHERE plan_id='standard' AND feature_key='consolidation';
SET LOCAL ROLE authenticated;
SELECT public.save_customer_profile((SELECT id FROM sub_ids WHERE k='station'),'Client Standard');
SELECT public.save_customer_profile((SELECT id FROM sub_ids WHERE k='station'),'Cliente modifiée',
  '','','','none',false,(SELECT id FROM sub_ids WHERE k='client'),NULL);
SELECT public.save_customer_vehicle((SELECT id FROM sub_ids WHERE k='station'),
  (SELECT id FROM sub_ids WHERE k='client'),'PREM-01','Marque','','',NULL,(SELECT id FROM sub_ids WHERE k='vehicle'));
INSERT INTO sub_results VALUES ('client standard créé',jsonb_array_length(public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'clients')=2);
INSERT INTO sub_ids SELECT 'requestPremium',public.request_subscription_plan('premium');
INSERT INTO sub_results VALUES ('demande premium ne change pas droits',public.my_subscription_access()->>'planId'='standard'
 AND NOT public.has_permission('inventory.view'));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='admin'),true);
SELECT public.admin_decide_subscription_request((SELECT id FROM sub_ids WHERE k='requestPremium'),true);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='owner'),true);
INSERT INTO sub_results VALUES ('premium confirmé rétablit accès et données',public.has_permission('inventory.view')
 AND (SELECT count(*)=1 FROM public.products WHERE id=(SELECT id FROM sub_ids WHERE k='product'))),
 ('premium retrouve les coûts et attestations sans perte',
   (public.my_station_profitability((SELECT id FROM sub_ids WHERE k='station'),current_date,current_date)->>'purchases')::bigint=2468
   AND (public.my_profitability(current_date,current_date)->>'consumptions')::bigint=1234
   AND (public.my_profitability(current_date,current_date)->>'certified')::boolean
   AND public.my_profitability(current_date,current_date)->>'attestation'='Attestation complète des coûts de test'),
 ('modification Standard préserve les rattachements Premium',
   (SELECT x->>'fleetId'=(SELECT id::text FROM sub_ids WHERE k='fleet') AND (x->>'loyaltyOptIn')::boolean
      FROM jsonb_array_elements(public.my_station_crm_board((SELECT id FROM sub_ids WHERE k='station'))->'clients') x
      WHERE x->>'id'=(SELECT id::text FROM sub_ids WHERE k='client'))
   AND (SELECT x->>'fleetId'=(SELECT id::text FROM sub_ids WHERE k='fleet')
      FROM jsonb_array_elements(public.my_crm_board()->'vehicles') x
      WHERE x->>'id'=(SELECT id::text FROM sub_ids WHERE k='vehicle'))
   AND (public.my_crm_board()->'stats'->>'openReceivablesMinor')::integer=12000);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.subscriptions SET trial_ends_at=now()-interval '1 second' WHERE company_id=(SELECT id FROM sub_ids WHERE k='companyB');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='expired'),true);
INSERT INTO sub_results VALUES ('expiration annoncée sans perte de lecture',NOT (public.my_subscription_access()->>'canWrite')::boolean
 AND public.my_subscription_access()->>'reason'='trial_expired'
 AND public.my_station_setup((SELECT id FROM sub_ids WHERE k='stationB'))->'station'->>'name'='Station B');
DO $$ BEGIN
 BEGIN PERFORM public.save_station_setup((SELECT id FROM sub_ids WHERE k='stationB'),'{"address":"refus"}');
  INSERT INTO sub_results VALUES('expiration bloque réglage',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('expiration bloque réglage',true); END;
 BEGIN PERFORM public.save_customer_profile((SELECT id FROM sub_ids WHERE k='stationB'),'Refusé');
  INSERT INTO sub_results VALUES('expiration bloque client',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('expiration bloque client',true); END;
END $$;
INSERT INTO sub_ids SELECT 'expiredRequest',public.request_subscription_plan('standard');
INSERT INTO sub_results VALUES ('demande après expiration ne rouvre pas les écritures',public.my_subscription_access()->>'pendingPlanId'='standard'
 AND NOT (public.my_subscription_access()->>'canWrite')::boolean);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='admin'),true);
SELECT public.admin_decide_subscription_request((SELECT id FROM sub_ids WHERE k='expiredRequest'),true);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='expired'),true);
INSERT INTO sub_results VALUES ('validation après expiration rouvre les écritures',(public.my_subscription_access()->>'canWrite')::boolean
 AND public.my_subscription_access()->>'planId'='standard');
SELECT public.save_station_setup((SELECT id FROM sub_ids WHERE k='stationB'),'{"address":"confirmé"}');
INSERT INTO sub_results VALUES ('écriture possible après validation',public.my_station_setup((SELECT id FROM sub_ids WHERE k='stationB'))->'station'->>'address'='confirmé');
DO $$ BEGIN
 BEGIN PERFORM public.request_subscription_plan('standard');
  INSERT INTO sub_results VALUES('formule active non renouvelée prématurément',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO sub_results VALUES('formule active non renouvelée prématurément',true); END;
END $$;

-- Une date payante est exclusive à minuit UTC, indépendamment du fuseau de
-- session : demain UTC reste ouvert, aujourd'hui UTC est déjà fermé.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date + 1
  WHERE company_id=(SELECT id FROM sub_ids WHERE k='companyB');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='expired'),true);
INSERT INTO sub_results VALUES ('échéance demain UTC ouverte indépendamment du fuseau',
 (public.my_subscription_access()->>'canWrite')::boolean);
-- Une période payante expirée doit devenir lecture seule, et une demande de
-- la même formule doit permettre un renouvellement manuel.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date
  WHERE company_id=(SELECT id FROM sub_ids WHERE k='companyB');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='expired'),true);
INSERT INTO sub_results VALUES ('expiration payante conserve la lecture et bloque les écritures',
 NOT (public.my_subscription_access()->>'canWrite')::boolean
 AND public.my_subscription_access()->>'reason'='period_expired'
 AND public.my_station_setup((SELECT id FROM sub_ids WHERE k='stationB'))->'station'->>'address'='confirmé');
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_profile((SELECT id FROM sub_ids WHERE k='stationB'),'Refus payant');
  INSERT INTO sub_results VALUES('écriture interdite après période payante',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO sub_results VALUES('écriture interdite après période payante',true); END;
END $$;
INSERT INTO sub_ids SELECT 'renewal',public.request_subscription_plan('standard');
INSERT INTO sub_results VALUES ('renouvellement demandé ne rouvre pas les écritures',
 public.my_subscription_access()->>'pendingPlanId'='standard'
 AND NOT (public.my_subscription_access()->>'canWrite')::boolean
 AND public.request_subscription_plan('standard')=(SELECT id FROM sub_ids WHERE k='renewal'));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='admin'),true);
SELECT public.admin_decide_subscription_request((SELECT id FROM sub_ids WHERE k='renewal'),true);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='expired'),true);
INSERT INTO sub_results VALUES ('renouvellement manuel rouvre une période mensuelle',
 (public.my_subscription_access()->>'canWrite')::boolean
 AND (public.my_subscription_access()->>'currentPeriodEnd')::date=((clock_timestamp() AT TIME ZONE 'UTC')::date + interval '1 month')::date);
SELECT public.save_customer_profile((SELECT id FROM sub_ids WHERE k='stationB'),'Renouvellement confirmé');

-- La voie historique signup_company crée aussi l'essai avant station/profil.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM sub_ids WHERE k='legacy'),true);
SELECT public.signup_company('Legacy','Station Legacy','Abidjan','','Ancien propriétaire');
INSERT INTO sub_results VALUES ('bootstrap historique authentifié fonctionnel',public.my_subscription_access()->>'planId'='essai'
  AND (public.my_subscription_access()->>'canWrite')::boolean);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Un tenant sans abonnement est toujours fermé, même pour le rôle service.
INSERT INTO public.companies(name,country_code,currency_code) VALUES('Sans abonnement','CI','XOF');
DO $$ DECLARE c uuid; BEGIN
 SELECT id INTO c FROM public.companies WHERE name='Sans abonnement';
 BEGIN INSERT INTO public.stations(company_id,name) VALUES(c,'Refus');
  INSERT INTO sub_results VALUES('abonnement absent refuse même service',false);
 EXCEPTION WHEN check_violation OR insufficient_privilege THEN INSERT INTO sub_results VALUES('abonnement absent refuse même service',true); END;
END $$;
INSERT INTO sub_results VALUES ('produit conservé en base',(SELECT count(*)=1 FROM public.products WHERE id=(SELECT id FROM sub_ids WHERE k='product')));
SELECT label, ok FROM sub_results ORDER BY label;
ROLLBACK;
