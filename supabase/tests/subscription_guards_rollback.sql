-- Recette complémentaire 057, à exécuter uniquement dans une base isolée.
-- Quotas, invitations, Storage, périmètre, WhatsApp et vrai rôle service.
BEGIN;
CREATE TEMP TABLE guard_ids(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE guard_results(label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON guard_ids, guard_results TO anon, authenticated, service_role;
-- Simuler les droits de table habituels du rôle Supabase de service ; le refus
-- ci-dessous doit venir des triggers, et non d'un simple manque de GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stations, public.washes TO service_role;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('88888888-8888-4888-8888-888888888881','guard-a@test.invalid',
  '{"company_name":"Garde A","station_name":"Station Garde A","owner_name":"Owner A"}'),
 ('88888888-8888-4888-8888-888888888882','guard-b@test.invalid',
  '{"company_name":"Garde B","station_name":"Station Garde B","owner_name":"Owner B"}'),
 ('88888888-8888-4888-8888-888888888883','guard-admin@test.invalid','{"invitation":true}');
INSERT INTO guard_ids VALUES ('ownerA','88888888-8888-4888-8888-888888888881'),
 ('ownerB','88888888-8888-4888-8888-888888888882'),('admin','88888888-8888-4888-8888-888888888883');
INSERT INTO guard_ids SELECT 'companyA',company_id FROM public.user_profiles WHERE id=(SELECT id FROM guard_ids WHERE k='ownerA');
INSERT INTO guard_ids SELECT 'stationA',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM guard_ids WHERE k='ownerA');
INSERT INTO guard_ids SELECT 'companyB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM guard_ids WHERE k='ownerB');
INSERT INTO guard_ids SELECT 'stationB',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM guard_ids WHERE k='ownerB');
INSERT INTO public.platform_admins(user_id) VALUES ((SELECT id FROM guard_ids WHERE k='admin'));
-- Petit plafond de test, uniquement dans cette transaction annulée.
UPDATE public.plan_limits SET value_int=2 WHERE plan_id='essai' AND key='washes_per_month';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerA'),true);
INSERT INTO guard_results VALUES
 ('contexte A isolé', public.my_subscription_access()->>'companyId'=(SELECT id::text FROM guard_ids WHERE k='companyA')
   AND (SELECT count(*)=0 FROM public.stations WHERE id=(SELECT id FROM guard_ids WHERE k='stationB')));
DO $$ BEGIN
 BEGIN PERFORM public.my_station_setup((SELECT id FROM guard_ids WHERE k='stationB'));
  INSERT INTO guard_results VALUES('lecture station autre tenant refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('lecture station autre tenant refusée',true); END;
 BEGIN PERFORM public.reserve_user_invitation('other@test.invalid','Hors tenant','','cashier',ARRAY[(SELECT id FROM guard_ids WHERE k='stationB')]);
  INSERT INTO guard_results VALUES('invitation station autre tenant refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('invitation station autre tenant refusée',true); END;
 BEGIN PERFORM public.finalize_user_invitation(gen_random_uuid(),gen_random_uuid(),repeat('a',64));
  INSERT INTO guard_results VALUES('finalisation interdite au client',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('finalisation interdite au client',true); END;
 BEGIN PERFORM 1 FROM public.invitation_reservations;
  INSERT INTO guard_results VALUES('réservations privées',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('réservations privées',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO guard_results VALUES('service dispose bien du droit d’insérer une station',has_table_privilege('service_role','public.stations','INSERT'));
DO $$ BEGIN
 BEGIN INSERT INTO public.stations(company_id,name) VALUES((SELECT id FROM guard_ids WHERE k='companyA'),'Station de trop');
  INSERT INTO guard_results VALUES('quota station appliqué',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO guard_results VALUES('quota station appliqué',true); END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerA'),true);

-- Le Standard conserve le cycle de lavage ordinaire, y compris le trigger 053.
INSERT INTO guard_ids SELECT 'requestA',public.request_subscription_plan('standard');
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='admin'),true);
SELECT public.admin_decide_subscription_request((SELECT id FROM guard_ids WHERE k='requestA'),true);
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerA'),true);
INSERT INTO guard_ids SELECT 'categoryA',public.save_station_category((SELECT id FROM guard_ids WHERE k='stationA'),NULL,'Catégorie A',true);
INSERT INTO guard_ids SELECT 'customerA',public.save_customer_profile((SELECT id FROM guard_ids WHERE k='stationA'),'Client A','+2250700000001');
SELECT public.save_customer_whatsapp_consent((SELECT id FROM guard_ids WHERE k='customerA'),true,'Accord au comptoir','+2250700000001');
INSERT INTO guard_results VALUES ('avis transactionnel Standard distinct de la file CRM fidélité',
  NOT public.has_permission('notifications.view')
  AND (public.my_customer_whatsapp_consent((SELECT id FROM guard_ids WHERE k='customerA'))->>'granted')::boolean);
DO $$ BEGIN
 BEGIN PERFORM whatsapp_consent_granted FROM public.customers WHERE id=(SELECT id FROM guard_ids WHERE k='customerA');
  INSERT INTO guard_results VALUES('consentement WhatsApp interdit en lecture directe',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('consentement WhatsApp interdit en lecture directe',true); END;
 BEGIN UPDATE public.customers SET whatsapp_consent_granted=false WHERE id=(SELECT id FROM guard_ids WHERE k='customerA');
  INSERT INTO guard_results VALUES('consentement WhatsApp non modifiable directement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('consentement WhatsApp non modifiable directement',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.washes(company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM guard_ids WHERE k='companyA'),(SELECT id FROM guard_ids WHERE k='stationA'),'GUARD-A',
  (SELECT id FROM guard_ids WHERE k='customerA'),(SELECT id FROM guard_ids WHERE k='categoryA'),1000,'quality_check',(SELECT id FROM guard_ids WHERE k='ownerA')) RETURNING id;
INSERT INTO guard_ids SELECT 'washA',id FROM public.washes WHERE number='GUARD-A';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerA'),true);
SELECT public.record_wash_quality_check((SELECT id FROM guard_ids WHERE k='washA'),'approved','');
INSERT INTO guard_results VALUES ('standard passe en prêt et journalise WhatsApp',
  (SELECT status='ready' FROM public.washes WHERE id=(SELECT id FROM guard_ids WHERE k='washA'))
  AND public.my_wash_whatsapp_journal((SELECT id FROM guard_ids WHERE k='washA'))->0->>'status'='pending');

-- Réservations d'invitations et quotas d'employés, propriétaire inclus.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO guard_ids SELECT 'reservation1',public.reserve_user_invitation('guard-invite1@test.invalid','Invité Un','','cashier',ARRAY[(SELECT id FROM guard_ids WHERE k='stationB')]);
INSERT INTO guard_ids SELECT 'reservation2',public.reserve_user_invitation('guard-invite2@test.invalid','Invité Deux','','washer',ARRAY[(SELECT id FROM guard_ids WHERE k='stationB')]);
INSERT INTO guard_results VALUES ('réservations comptées dans le relevé de quota',
 (public.my_subscription_usage()->'usage'->>'employees')::integer=3);
INSERT INTO guard_results VALUES ('vue et helper de quota comptent les réservations sans divulgation inter-tenant',
 (SELECT employees_used=3 FROM public.v_company_quota_usage WHERE company_id=(SELECT id FROM guard_ids WHERE k='companyB'))
 AND public.my_quota_account_count((SELECT id FROM guard_ids WHERE k='companyA')) IS NULL
 AND NOT has_table_privilege('authenticated','public.invitation_reservations','SELECT'));
SELECT public.refresh_subscription_usage((date_trunc('month',now() AT TIME ZONE 'UTC'))::date);
INSERT INTO guard_results VALUES ('instantané recalculé inclut les réservations',
 EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_subscription_usage()->'rows') AS x(item)
  WHERE item->>'metricKey'='employees' AND (item->>'valueInt')::integer=3));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='admin'),true);
INSERT INTO guard_results VALUES ('plateforme compte les mêmes places et masque son ancienne RPC',
 EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_platform_board()->'companies') AS x(item)
   WHERE item->>'companyId'=(SELECT id::text FROM guard_ids WHERE k='companyB')
     AND (item->>'employeeCount')::integer=3 AND (item->'quota'->>'employeesUsed')::integer=3
     AND item->>'subscriptionStatus'='trial' AND item->'subscriptionReason'='null'::jsonb)
 AND NOT has_function_privilege('authenticated','public.wg_platform_board_before_subscriptions()','EXECUTE'));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
DO $$ BEGIN
 BEGIN PERFORM public.reserve_user_invitation('guard-invite3@test.invalid','Invité Trois','','cashier',ARRAY[(SELECT id FROM guard_ids WHERE k='stationB')]);
  INSERT INTO guard_results VALUES('quota comptes inclut invitations en vol',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO guard_results VALUES('quota comptes inclut invitations en vol',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('88888888-8888-4888-8888-888888888891','guard-invite1@test.invalid',jsonb_build_object('invitation',true,'invitation_reservation_id',(SELECT id::text FROM guard_ids WHERE k='reservation1')));
INSERT INTO guard_ids VALUES('invite1','88888888-8888-4888-8888-888888888891');
SET LOCAL ROLE service_role;
INSERT INTO guard_ids SELECT 'invitation1',(public.finalize_user_invitation((SELECT id FROM guard_ids WHERE k='reservation1'),(SELECT id FROM guard_ids WHERE k='invite1'),repeat('a',64))->>'invitationId')::uuid;
INSERT INTO guard_results VALUES ('finalisation service idempotente',
 (public.finalize_user_invitation((SELECT id FROM guard_ids WHERE k='reservation1'),(SELECT id FROM guard_ids WHERE k='invite1'),repeat('b',64))->>'invitationId')::uuid=(SELECT id FROM guard_ids WHERE k='invitation1'));
INSERT INTO guard_results VALUES ('réponse perdue retrouve finalisation',
 public.inspect_user_invitation((SELECT id FROM guard_ids WHERE k='reservation1'),(SELECT id FROM guard_ids WHERE k='invite1'))->>'status'='finalized');
INSERT INTO guard_results VALUES ('réservation sans compte mise en rapprochement',
 public.inspect_user_invitation((SELECT id FROM guard_ids WHERE k='reservation2'),NULL)->>'status'='cleanup');
SELECT public.release_user_invitation((SELECT id FROM guard_ids WHERE k='reservation2'));
RESET ROLE;
INSERT INTO guard_results VALUES ('profil affectation et invitation commités ensemble',
 (SELECT count(*)=1 FROM public.user_profiles WHERE id=(SELECT id FROM guard_ids WHERE k='invite1'))
 AND (SELECT count(*)=1 FROM public.user_station_assignments WHERE user_id=(SELECT id FROM guard_ids WHERE k='invite1') AND station_id=(SELECT id FROM guard_ids WHERE k='stationB'))
 AND (SELECT count(*)=1 FROM public.user_invitations WHERE id=(SELECT id FROM guard_ids WHERE k='invitation1')));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO guard_results VALUES ('place libérée visible après rapprochement',
 (public.my_subscription_usage()->'usage'->>'employees')::integer=2);
INSERT INTO guard_ids SELECT 'reservation3',public.reserve_user_invitation('guard-invite3@test.invalid','Invité Trois','','cashier',ARRAY[(SELECT id FROM guard_ids WHERE k='stationB')]);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('88888888-8888-4888-8888-888888888893','guard-invite3@test.invalid',jsonb_build_object('invitation',true,'invitation_reservation_id',(SELECT id::text FROM guard_ids WHERE k='reservation3')));
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.release_user_invitation((SELECT id FROM guard_ids WHERE k='reservation3'));
  INSERT INTO guard_results VALUES('compte Auth orphelin empêche libération',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO guard_results VALUES('compte Auth orphelin empêche libération',true); END;
 BEGIN PERFORM public.finalize_user_invitation((SELECT id FROM guard_ids WHERE k='reservation3'),(SELECT id FROM guard_ids WHERE k='invite1'),repeat('a',64));
  INSERT INTO guard_results VALUES('compte Auth différent de la réservation refusé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO guard_results VALUES('compte Auth différent de la réservation refusé',true); END;
END $$;
RESET ROLE;

-- Préparer deux notifications en essai : une en vol, l'autre en échec avec
-- relance encore en attente avant réception d'un éventuel webhook tardif.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO guard_ids SELECT 'categoryB',public.save_station_category((SELECT id FROM guard_ids WHERE k='stationB'),NULL,'Catégorie B',true);
INSERT INTO guard_ids SELECT 'customerB',public.save_customer_profile((SELECT id FROM guard_ids WHERE k='stationB'),'Client B','+2250700000002');
SELECT public.save_customer_whatsapp_consent((SELECT id FROM guard_ids WHERE k='customerB'),true,'Accord au comptoir','+2250700000002');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.washes(company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by,created_at)
 VALUES((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='stationB'),'GUARD-B1',
  (SELECT id FROM guard_ids WHERE k='customerB'),(SELECT id FROM guard_ids WHERE k='categoryB'),1000,'quality_check',
  (SELECT id FROM guard_ids WHERE k='ownerB'),clock_timestamp()-interval '2 months');
INSERT INTO guard_ids SELECT 'washB1',id FROM public.washes WHERE number='GUARD-B1';
INSERT INTO guard_results VALUES ('antidatation de création neutralisée',
 (SELECT created_at >= date_trunc('month',clock_timestamp()) FROM public.washes WHERE id=(SELECT id FROM guard_ids WHERE k='washB1')));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
SELECT public.record_wash_quality_check((SELECT id FROM guard_ids WHERE k='washB1'),'approved','');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.washes(company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='stationB'),'GUARD-B2',
  (SELECT id FROM guard_ids WHERE k='customerB'),(SELECT id FROM guard_ids WHERE k='categoryB'),1000,'quality_check',(SELECT id FROM guard_ids WHERE k='ownerB'));
INSERT INTO guard_ids SELECT 'washB2',id FROM public.washes WHERE number='GUARD-B2';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
SELECT public.record_wash_quality_check((SELECT id FROM guard_ids WHERE k='washB2'),'approved','');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN INSERT INTO public.washes(company_id,station_id,number,vehicle_category_id,total_minor,status,created_by)
  VALUES((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='stationB'),'GUARD-OVER',
   (SELECT id FROM guard_ids WHERE k='categoryB'),1000,'pending',(SELECT id FROM guard_ids WHERE k='ownerB'));
  INSERT INTO guard_results VALUES('quota lavages appliqué',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO guard_results VALUES('quota lavages appliqué',true); END;
 BEGIN UPDATE public.washes SET created_at=created_at-interval '2 months' WHERE id=(SELECT id FROM guard_ids WHERE k='washB1');
  INSERT INTO guard_results VALUES('date de lavage immuable',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('date de lavage immuable',true); END;
END $$;
RESET ROLE;
-- Les bornes du quota doivent rester UTC même si la session utilise UTC+14.
-- Les fixtures historiques/futures sont insérées uniquement en tant qu'admin.
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='admin'),true);
INSERT INTO public.washes(company_id,station_id,number,vehicle_category_id,total_minor,status,created_by,created_at) VALUES
 ((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='stationB'),'GUARD-B-PREV',
  (SELECT id FROM guard_ids WHERE k='categoryB'),7000,'pending',(SELECT id FROM guard_ids WHERE k='ownerB'),
  ((date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') - interval '1 microsecond') AT TIME ZONE 'UTC')),
 ((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='stationB'),'GUARD-B-NEXT',
  (SELECT id FROM guard_ids WHERE k='categoryB'),8000,'pending',(SELECT id FROM guard_ids WHERE k='ownerB'),
  ((date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
-- Évaluer la véritable expression par défaut avec deux instants synthétiques,
-- afin de couvrir minuit UTC même lorsque la recette tourne en milieu de mois.
DO $$ DECLARE default_expr text; before_utc date; at_utc date; BEGIN
 SELECT pg_get_expr(proargdefaults,0) INTO default_expr FROM pg_proc
  WHERE oid='public.my_subscription_usage(date)'::regprocedure;
 IF default_expr IS NOT NULL AND position('now()' in default_expr)>0 THEN
  EXECUTE 'SELECT '||replace(default_expr,'now()',quote_literal('2026-11-30 23:59:59.999999+00')||'::timestamptz') INTO before_utc;
  EXECUTE 'SELECT '||replace(default_expr,'now()',quote_literal('2026-12-01 00:00:00+00')||'::timestamptz') INTO at_utc;
 END IF;
 INSERT INTO guard_results VALUES ('période par défaut UTC autour de minuit malgré UTC+14',
  COALESCE(before_utc=date '2026-11-01' AND at_utc=date '2026-12-01',false)
  AND public.my_subscription_usage()->>'periodStart'=(date_trunc('month',now() AT TIME ZONE 'UTC'))::date::text);
END $$;
SELECT public.refresh_subscription_usage((date_trunc('month',now() AT TIME ZONE 'UTC'))::date);
INSERT INTO guard_results VALUES ('quota et vue utilisent le mois UTC malgré un autre fuseau',
 (public.my_subscription_usage((date_trunc('month',now() AT TIME ZONE 'UTC'))::date)->'usage'->>'washes')::integer=2
 AND (SELECT washes_month_used=2 FROM public.v_company_quota_usage WHERE company_id=(SELECT id FROM guard_ids WHERE k='companyB'))
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_subscription_usage((date_trunc('month',now() AT TIME ZONE 'UTC'))::date)->'rows') AS x(item)
   WHERE item->>'metricKey'='washes' AND (item->>'valueInt')::integer=2));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='admin'),true);
INSERT INTO guard_results VALUES ('plateforme exclut les lavages hors du mois UTC',
 EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_platform_board()->'companies') AS x(item)
   WHERE item->>'companyId'=(SELECT id::text FROM guard_ids WHERE k='companyB')
     AND (item->>'washesMonth')::integer=2 AND (item->>'monthlyRevenue')::integer=2000));
SET LOCAL TIME ZONE 'UTC';
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO storage.objects(bucket_id,name,owner,metadata)
 VALUES('station-assets',(SELECT id::text FROM guard_ids WHERE k='companyB')||'/garde.webp',(SELECT id FROM guard_ids WHERE k='ownerB'),'{}'::jsonb);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO guard_ids SELECT 'notifB1',id FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT id FROM guard_ids WHERE k='washB1');
INSERT INTO guard_ids SELECT 'notifB2',id FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT id FROM guard_ids WHERE k='washB2');
SET LOCAL ROLE service_role;
INSERT INTO guard_results VALUES ('service réclame notification avant expiration',
 (public.claim_wash_whatsapp((SELECT id FROM guard_ids WHERE k='companyB'),'123456')->>'id')::uuid=(SELECT id FROM guard_ids WHERE k='notifB1'));
INSERT INTO guard_results VALUES ('seconde notification réclamée avant expiration',
 (public.claim_wash_whatsapp((SELECT id FROM guard_ids WHERE k='companyB'),'123456')->>'id')::uuid=(SELECT id FROM guard_ids WHERE k='notifB2'));
SELECT public.finish_wash_whatsapp((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='notifB2'),'failed',NULL,'test');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO guard_ids SELECT 'retryB2',public.enqueue_wash_whatsapp((SELECT id FROM guard_ids WHERE k='washB2'),'guard-retry-b2-key');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.subscriptions SET trial_ends_at=clock_timestamp()-interval '1 second' WHERE company_id=(SELECT id FROM guard_ids WHERE k='companyB');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO guard_results VALUES ('expiration conserve contexte et stockage lisible',
 (public.my_context()->>'active')::boolean AND NOT (public.my_subscription_access()->>'canWrite')::boolean
 AND (SELECT count(*)=1 FROM storage.objects WHERE bucket_id='station-assets' AND name=(SELECT id::text FROM guard_ids WHERE k='companyB')||'/garde.webp'));
DO $$ DECLARE changed integer; BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name,owner,metadata)
  VALUES('station-assets',(SELECT id::text FROM guard_ids WHERE k='companyB')||'/bloque.webp',(SELECT id FROM guard_ids WHERE k='ownerB'),'{}'::jsonb);
  INSERT INTO guard_results VALUES('upload Storage refusé après expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('upload Storage refusé après expiration',true); END;
 UPDATE storage.objects SET metadata='{"blocked":true}'::jsonb
  WHERE bucket_id='station-assets' AND name=(SELECT id::text FROM guard_ids WHERE k='companyB')||'/garde.webp';
 GET DIAGNOSTICS changed=ROW_COUNT;
 INSERT INTO guard_results VALUES('modification Storage refusée après expiration',changed=0);
 BEGIN PERFORM public.reserve_user_invitation('guard-late@test.invalid','Invitation tardive','','cashier',ARRAY[(SELECT id FROM guard_ids WHERE k='stationB')]);
  INSERT INTO guard_results VALUES('invitation refusée après expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('invitation refusée après expiration',true); END;
 BEGIN PERFORM public.transition_wash_status((SELECT id FROM guard_ids WHERE k='washB1'),'delivered','');
  INSERT INTO guard_results VALUES('lavage inchangé après expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('lavage inchangé après expiration',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.claim_wash_whatsapp((SELECT id FROM guard_ids WHERE k='companyB'),'123456');
  INSERT INTO guard_results VALUES('service ne réclame pas après expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('service ne réclame pas après expiration',true); END;
 BEGIN PERFORM public.finalize_user_invitation((SELECT id FROM guard_ids WHERE k='reservation3'),'88888888-8888-4888-8888-888888888893',repeat('a',64));
  INSERT INTO guard_results VALUES('service ne finalise pas après expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('service ne finalise pas après expiration',true); END;
END $$;
SELECT public.inspect_user_invitation((SELECT id FROM guard_ids WHERE k='reservation3'),'88888888-8888-4888-8888-888888888893');
DO $$ BEGIN
 BEGIN PERFORM public.finalize_user_invitation((SELECT id FROM guard_ids WHERE k='reservation3'),'88888888-8888-4888-8888-888888888893',repeat('a',64));
  INSERT INTO guard_results VALUES('rapprochement empêche finalisation tardive',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO guard_results VALUES('rapprochement empêche finalisation tardive',true); END;
END $$;
SELECT public.finish_wash_whatsapp((SELECT id FROM guard_ids WHERE k='companyB'),(SELECT id FROM guard_ids WHERE k='notifB1'),'accepted','wamid.guard-1',NULL);
INSERT INTO guard_results VALUES ('callback fournisseur tardif conservé',
 public.apply_wash_whatsapp_status((SELECT id FROM guard_ids WHERE k='companyB'),'123456',(SELECT id FROM guard_ids WHERE k='notifB1'),'wamid.guard-1','delivered',1700000000,NULL));
RESET ROLE;
INSERT INTO guard_results VALUES ('relance reste en attente après refus du claim',
 (SELECT status='pending' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM guard_ids WHERE k='retryB2')));
SET LOCAL ROLE service_role;
INSERT INTO guard_results VALUES ('livraison tardive après expiration annule la relance',
 public.apply_wash_whatsapp_status((SELECT id FROM guard_ids WHERE k='companyB'),'123456',(SELECT id FROM guard_ids WHERE k='notifB2'),'wamid.guard-2','delivered',1700000000,NULL));
RESET ROLE;
INSERT INTO guard_results VALUES ('résultats en vol et annulation de relance conservés après expiration',
 (SELECT status='delivered' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM guard_ids WHERE k='notifB1'))
 AND (SELECT status='delivered' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM guard_ids WHERE k='notifB2'))
 AND (SELECT status='cancelled' AND reason_code='delivery_confirmed_elsewhere' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM guard_ids WHERE k='retryB2'))
 AND (SELECT EXISTS(SELECT 1 FROM public.wash_whatsapp_events WHERE notification_id=(SELECT id FROM guard_ids WHERE k='retryB2') AND kind='cancelled')));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='ownerB'),true);
INSERT INTO guard_ids SELECT 'retraitB',public.save_customer_whatsapp_consent((SELECT id FROM guard_ids WHERE k='customerB'),false,'Retrait demandé au comptoir',NULL);
INSERT INTO guard_results VALUES ('retrait WhatsApp autorisé après expiration de l’essai',
 NOT (public.my_customer_whatsapp_consent((SELECT id FROM guard_ids WHERE k='customerB'))->>'granted')::boolean
 AND public.my_customer_whatsapp_consent((SELECT id FROM guard_ids WHERE k='customerB'))->'history'->0->>'kind'='revoked');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO guard_results VALUES ('finalisation expirée sans profil ni affectation partiels',
 NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id='88888888-8888-4888-8888-888888888893')
 AND NOT EXISTS (SELECT 1 FROM public.user_station_assignments WHERE user_id='88888888-8888-4888-8888-888888888893')
 AND NOT EXISTS (SELECT 1 FROM public.user_invitations WHERE email='guard-invite3@test.invalid'));

-- Après changement de limites, le tableau doit signaler à la fois l'essai
-- expiré, un dépassement incluant les réservations et une limite absente.
UPDATE public.plan_limits SET value_int=2 WHERE plan_id='essai' AND key='employees';
DELETE FROM public.plan_limits WHERE plan_id='essai' AND key='stations';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM guard_ids WHERE k='admin'),true);
INSERT INTO guard_results VALUES ('plateforme montre expiration et quota dépassé malgré les réservations',
 EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_platform_board()->'companies') AS x(item)
   WHERE item->>'companyId'=(SELECT id::text FROM guard_ids WHERE k='companyB')
     AND item->>'subscriptionReason'='trial_expired' AND (item->>'employeeCount')::integer=3
     AND (item->'quota'->>'quotaExceeded')::boolean AND item->'limits'->'stations'='null'::jsonb)
 AND (public.my_platform_board()->'stats'->>'quotasExceeded')::integer >= 1);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Vrai SET ROLE service_role avec GRANT explicite, pas superutilisateur.
INSERT INTO public.companies(name,country_code,currency_code) VALUES('Garde sans abonnement','CI','XOF');
INSERT INTO guard_ids SELECT 'noSub',id FROM public.companies WHERE name='Garde sans abonnement';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN INSERT INTO public.stations(company_id,name) VALUES((SELECT id FROM guard_ids WHERE k='noSub'),'Refus service');
  INSERT INTO guard_results VALUES('service bloqué sans abonnement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO guard_results VALUES('service bloqué sans abonnement',true); END;
END $$;
RESET ROLE;
SELECT label, ok FROM guard_results ORDER BY label;
ROLLBACK;
