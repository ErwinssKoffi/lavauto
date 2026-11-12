-- Test uniquement sur base isolée : aucun réseau, aucun secret, ROLLBACK.
BEGIN;
CREATE TEMP TABLE wa_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE wa_result (label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON wa_ids, wa_result TO authenticated, service_role;
INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES
 ('a1111111-1111-4111-8111-111111111111','wa-a@test.invalid',jsonb_build_object('company_name','Tenant WA A','station_name','Station WA A','owner_name','Owner A')),
 ('b1111111-1111-4111-8111-111111111111','wa-b@test.invalid',jsonb_build_object('company_name','Tenant WA B','station_name','Station WA B','owner_name','Owner B'));
INSERT INTO wa_ids VALUES ('userA','a1111111-1111-4111-8111-111111111111'), ('userB','b1111111-1111-4111-8111-111111111111'),
 ('catA','c1111111-1111-4111-8111-111111111111'),
 ('w1','d1111111-1111-4111-8111-111111111111'), ('w2','d2222222-2222-4222-8222-222222222222'),
 ('w3','d3333333-3333-4333-8333-333333333333'), ('w4','d4444444-4444-4444-8444-444444444444'),
 ('w5','d5555555-5555-4555-8555-555555555555'), ('w6','d6666666-6666-4666-8666-666666666666'),
 ('w7','d7777777-7777-4777-8777-777777777777'), ('w8','d8888888-8888-4888-8888-888888888888'),
 ('w9','d9999999-9999-4999-8999-999999999999'), ('w10','d1010101-1010-4101-8101-101010101010');
INSERT INTO wa_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id=(SELECT v FROM wa_ids WHERE k='userA');
INSERT INTO wa_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id=(SELECT v FROM wa_ids WHERE k='userB');
INSERT INTO wa_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id=(SELECT v FROM wa_ids WHERE k='userA');
INSERT INTO wa_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id=(SELECT v FROM wa_ids WHERE k='userB');
UPDATE public.stations SET activated=true WHERE id IN (SELECT v FROM wa_ids WHERE k IN ('stA','stB'));
INSERT INTO public.vehicle_categories (id,company_id,station_id,name)
 VALUES ((SELECT v FROM wa_ids WHERE k='catA'), (SELECT v FROM wa_ids WHERE k='coA'), (SELECT v FROM wa_ids WHERE k='stA'), 'Berline WA');
SELECT set_config('request.jwt.claim.sub',(SELECT v::text FROM wa_ids WHERE k='userA'),true);
INSERT INTO wa_ids SELECT 'c1', public.save_customer_profile((SELECT v FROM wa_ids WHERE k='stA'),'Sans accord','+225 0700000001','','','whatsapp',true);
INSERT INTO wa_ids SELECT 'c2', public.save_customer_profile((SELECT v FROM wa_ids WHERE k='stA'),'Avec accord','+225 0700000002','','','none',false);
INSERT INTO wa_ids SELECT 'c3', public.save_customer_profile((SELECT v FROM wa_ids WHERE k='stA'),'Numero local','0700000003','','','whatsapp',true);
SELECT set_config('request.jwt.claim.sub',(SELECT v::text FROM wa_ids WHERE k='userB'),true);
INSERT INTO wa_ids SELECT 'cB', public.save_customer_profile((SELECT v FROM wa_ids WHERE k='stB'),'Client autre tenant','+2250700000004','','','whatsapp',true);
SELECT set_config('request.jwt.claim.sub',(SELECT v::text FROM wa_ids WHERE k='userA'),true);
INSERT INTO public.washes (id,company_id,station_id,number,customer_id,customer_name,vehicle_category_id,vehicle_label,total_minor,status,created_by)
SELECT i.v, (SELECT v FROM wa_ids WHERE k='coA'), (SELECT v FROM wa_ids WHERE k='stA'), 'WA-'||i.k,
  CASE WHEN i.k='w3' THEN NULL WHEN i.k='w1' THEN (SELECT v FROM wa_ids WHERE k='c1') ELSE (SELECT v FROM wa_ids WHERE k='c2') END,
  'Client test', (SELECT v FROM wa_ids WHERE k='catA'), 'Berline', 1000, 'quality_check', (SELECT v FROM wa_ids WHERE k='userA')
FROM wa_ids i WHERE i.k LIKE 'w%';

INSERT INTO wa_result VALUES
 ('Nouvelles tables sous RLS et sans accès direct utilisateur',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.whatsapp_consent_events'::regclass,'public.wash_whatsapp_notifications'::regclass,'public.wash_whatsapp_events'::regclass))
  AND NOT has_table_privilege('authenticated','public.wash_whatsapp_notifications','SELECT')
  AND NOT has_table_privilege('anon','public.whatsapp_consent_events','INSERT')),
 ('Aucun accès anon ou utilisateur au worker',
  NOT has_function_privilege('anon','public.enqueue_wash_whatsapp(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.claim_wash_whatsapp(uuid,text)','EXECUTE')
  AND has_function_privilege('service_role','public.claim_wash_whatsapp(uuid,text)','EXECUTE')),
 ('Canal préféré et fidélité ne valent pas consentement',
  NOT (SELECT whatsapp_consent_granted FROM public.customers WHERE id=(SELECT v FROM wa_ids WHERE k='c1')));

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c3'),true,'Accord au comptoir','0700000003');
    INSERT INTO wa_result VALUES ('Numéro international obligatoire',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO wa_result VALUES ('Numéro international obligatoire',true); END;
  BEGIN
    PERFORM public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),true,'','+2250700000002');
    INSERT INTO wa_result VALUES ('Preuve de consentement obligatoire',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO wa_result VALUES ('Preuve de consentement obligatoire',true); END;
  BEGIN
    PERFORM public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),true,'Accord au comptoir','+2250700999999');
    INSERT INTO wa_result VALUES ('Accord refusé si le numéro confirmé a changé',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO wa_result VALUES ('Accord refusé si le numéro confirmé a changé',true); END;
  BEGIN
    PERFORM public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),true,'Accord au comptoir',NULL);
    INSERT INTO wa_result VALUES ('Accord refusé sans numéro confirmé',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO wa_result VALUES ('Accord refusé sans numéro confirmé',true); END;
  BEGIN
    PERFORM public.my_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='cB'));
    INSERT INTO wa_result VALUES ('Isolation consentement entre entreprises',false);
  EXCEPTION WHEN no_data_found OR insufficient_privilege THEN INSERT INTO wa_result VALUES ('Isolation consentement entre entreprises',true); END;
  BEGIN
    PERFORM public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456');
    INSERT INTO wa_result VALUES ('Worker interdit au JWT utilisateur',false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO wa_result VALUES ('Worker interdit au JWT utilisateur',true); END;
END $$;
INSERT INTO wa_result SELECT 'Refus du mauvais numéro sans preuve ni consentement',
  NOT (j->>'granted')::boolean AND jsonb_array_length(j->'history')=0
FROM (SELECT public.my_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2')) AS j) q;
SELECT public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),true,'Accord explicite au comptoir',' +225 (07) 00000002 ');
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w1'),'approved','');
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w2'),'approved','');
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w3'),'approved','');
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w4'),'approved','');
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w9'),'rejected','Reprise');
RESET ROLE;
INSERT INTO wa_result VALUES
 ('Passage prêt : absence d’accord enregistrée comme blocage',
  (SELECT status='blocked' AND reason_code='no_consent' FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w1'))),
 ('Passage prêt : client non rattaché bloqué',
  (SELECT status='blocked' AND reason_code='no_customer' FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w3'))),
 ('Passage prêt avec accord : mise en attente sans appel fournisseur',
  (SELECT status='pending' AND origin='automatic' AND provider_message_id IS NULL AND recipient_e164='+2250700000002' FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w2'))),
 ('Contrôle qualité refusé : aucune mise en attente',
  NOT EXISTS (SELECT 1 FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w9')));
SET LOCAL ROLE authenticated;
SELECT public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),false,'Retrait demandé par le client',NULL);
RESET ROLE;
INSERT INTO wa_result VALUES
 ('Retrait : toutes les demandes non réclamées annulées',
  (SELECT count(*)=2 FROM public.wash_whatsapp_notifications WHERE wash_id IN (SELECT v FROM wa_ids WHERE k IN ('w2','w4')) AND status='cancelled' AND reason_code='consent_revoked')),
 ('Retrait et accord tracés de façon append-only',
  (SELECT count(*)=2 FROM public.whatsapp_consent_events WHERE customer_id=(SELECT v FROM wa_ids WHERE k='c2')));
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w2'),'manual-request-no-consent');
    INSERT INTO wa_result VALUES ('Envoi manuel sans consentement refusé',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO wa_result VALUES ('Envoi manuel sans consentement refusé',true); END;
END $$;
SELECT public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),true,'Nouvel accord explicite','+2250700000002');
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w5'),'approved','');
SELECT public.save_customer_profile((SELECT v FROM wa_ids WHERE k='stA'),'Avec accord','+2250700999999','','','none',false,(SELECT v FROM wa_ids WHERE k='c2'));
RESET ROLE;
INSERT INTO wa_result VALUES
 ('Changement de numéro révoque et annule la demande',
  NOT (SELECT whatsapp_consent_granted FROM public.customers WHERE id=(SELECT v FROM wa_ids WHERE k='c2'))
  AND (SELECT status='cancelled' AND reason_code='phone_changed' FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w5'))),
 ('Révocation par changement de numéro journalisée',
  (SELECT count(*)=1 FROM public.whatsapp_consent_events WHERE customer_id=(SELECT v FROM wa_ids WHERE k='c2') AND source LIKE 'Révocation automatique%'));
SET LOCAL ROLE authenticated;
SELECT public.save_customer_profile((SELECT v FROM wa_ids WHERE k='stA'),'Avec accord','+2250700000002','','','none',false,(SELECT v FROM wa_ids WHERE k='c2'));
RESET ROLE;
INSERT INTO wa_result VALUES ('Retour à l’ancien numéro ne réactive pas l’accord',
  NOT (SELECT whatsapp_consent_granted FROM public.customers WHERE id=(SELECT v FROM wa_ids WHERE k='c2')));
SET LOCAL ROLE authenticated;
SELECT public.save_customer_whatsapp_consent((SELECT v FROM wa_ids WHERE k='c2'),true,'Accord au comptoir vérifié','+2250700000002');
INSERT INTO wa_ids SELECT 'manual5',public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w5'),'manual-request-number-five');
INSERT INTO wa_result SELECT 'Action manuelle idempotente', v=public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w5'),'manual-request-number-five') FROM wa_ids WHERE k='manual5';
INSERT INTO wa_result SELECT 'Deuxième clic réutilise la demande en attente', v=public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w5'),'different-request-number-five') FROM wa_ids WHERE k='manual5';
INSERT INTO wa_result SELECT 'Journal utilisateur disponible', jsonb_array_length(public.my_wash_whatsapp_journal((SELECT v FROM wa_ids WHERE k='w5')))=2;
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w6'),'manual-not-ready-request');
    INSERT INTO wa_result VALUES ('Envoi manuel exige prêt',false);
  EXCEPTION WHEN check_violation THEN INSERT INTO wa_result VALUES ('Envoi manuel exige prêt',true); END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO wa_result SELECT 'Worker limité au tenant configuré',public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coB'),'123456') IS NULL;
INSERT INTO wa_result SELECT 'Claim atomique avec numéro et paramètres',
  j->>'id'=(SELECT v::text FROM wa_ids WHERE k='manual5') AND j->>'phone'='+2250700000002'
  AND j->>'washNumber'='WA-w5' AND j->>'stationName'='Station WA A'
  FROM (SELECT public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456') AS j) q;
INSERT INTO wa_result SELECT 'Pas de second claim', public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456') IS NULL;
SELECT public.finish_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),(SELECT v FROM wa_ids WHERE k='manual5'),'accepted','wamid.test-one',NULL);
RESET ROLE;
INSERT INTO wa_result VALUES ('Accepté par Meta ne signifie pas livré',
 (SELECT status='accepted' AND accepted_at IS NOT NULL AND delivered_at IS NULL FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='manual5')));
SET LOCAL ROLE service_role;
INSERT INTO wa_result SELECT 'Webhook autre expéditeur ignoré', NOT public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'999999',(SELECT v FROM wa_ids WHERE k='manual5'),'wamid.test-one','delivered',1700000001,NULL);
INSERT INTO wa_result SELECT 'Webhook autre entreprise ignoré', NOT public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coB'),'123456',(SELECT v FROM wa_ids WHERE k='manual5'),'wamid.test-one','delivered',1700000001,NULL);
INSERT INTO wa_result SELECT 'Webhook livré accepté', public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='manual5'),'wamid.test-one','delivered',1700000001,NULL);
SELECT public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='manual5'),'wamid.test-one','delivered',1700000001,NULL);
SELECT public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='manual5'),'wamid.test-one','sent',1700000000,NULL);
RESET ROLE;
INSERT INTO wa_result VALUES ('Événements répétés dédupliqués, ordre retardé sans régression',
 (SELECT status='delivered' AND delivered_at IS NOT NULL FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='manual5'))
 AND (SELECT count(*)=1 FROM public.wash_whatsapp_events WHERE notification_id=(SELECT v FROM wa_ids WHERE k='manual5') AND kind='delivered'));
SET LOCAL ROLE service_role;
SELECT public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'123456',NULL,'wamid.test-one','read',1700000002,NULL);
SELECT public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='manual5'),'wamid.test-one','failed',1700000003,'meta_123');
RESET ROLE;
INSERT INTO wa_result VALUES ('Lecture/livraison non rétrogradée par événement contradictoire',
 (SELECT status='read' AND read_at IS NOT NULL FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='manual5')));
SET LOCAL ROLE authenticated;
INSERT INTO wa_result SELECT 'Clic manuel ne double pas un message déjà livré',v=public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w5'),'manual-after-delivery-request') FROM wa_ids WHERE k='manual5';
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w6'),'approved','');
RESET ROLE;
INSERT INTO wa_ids SELECT 'auto6',id FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w6');
SET LOCAL ROLE service_role;
SELECT public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456');
-- Webhook arrivé AVANT la réponse HTTP : corrélation via callback opaque.
INSERT INTO wa_result SELECT 'Webhook précoce corrélé',public.apply_wash_whatsapp_status((SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='auto6'),'wamid.early','delivered',1700000004,NULL);
SELECT public.finish_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),(SELECT v FROM wa_ids WHERE k='auto6'),'accepted','wamid.early',NULL);
RESET ROLE;
INSERT INTO wa_result VALUES ('Réponse HTTP tardive ne rétrograde pas livré',
 (SELECT status='delivered' AND provider_message_id='wamid.early' FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='auto6'))),
 ('Acceptation HTTP tardive conservée dans le journal',
 (SELECT count(*)=1 FROM public.wash_whatsapp_events WHERE notification_id=(SELECT v FROM wa_ids WHERE k='auto6') AND kind='accepted'));
SET LOCAL ROLE authenticated;
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w7'),'approved','');
RESET ROLE;
INSERT INTO wa_ids SELECT 'auto7',id FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w7');
SET LOCAL ROLE service_role;
SELECT public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456');
SELECT public.finish_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),(SELECT v FROM wa_ids WHERE k='auto7'),'unknown',NULL,'network_uncertain');
RESET ROLE;
INSERT INTO wa_result VALUES ('Réponse réseau incertaine non qualifiée d’échec ni de succès',
 (SELECT status='unknown' AND provider_message_id IS NULL FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='auto7')));
SET LOCAL ROLE authenticated;
INSERT INTO wa_result SELECT 'Résultat incertain ne peut être renvoyé par erreur',v=public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w7'),'manual-uncertain-retry-key') FROM wa_ids WHERE k='auto7';
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w8'),'approved','');
SELECT public.transition_wash_status((SELECT v FROM wa_ids WHERE k='w8'),'delivered','');
RESET ROLE;
INSERT INTO wa_result VALUES ('Fiche restituée avant claim : demande annulée',
 (SELECT status='cancelled' AND reason_code='wash_no_longer_ready' FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w8')));

-- Une erreur certaine peut être corrigée et relancée explicitement ; une
-- interruption après claim devient incertaine et n'est jamais réémise.
SET LOCAL ROLE authenticated;
INSERT INTO wa_ids SELECT 'manual2a',public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w2'),'manual-known-failure-one');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456');
SELECT public.finish_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),(SELECT v FROM wa_ids WHERE k='manual2a'),'failed',NULL,'http_400:meta_132000');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO wa_ids SELECT 'manual2b',public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w2'),'manual-known-failure-two');
INSERT INTO wa_result VALUES ('Après refus certain, relance manuelle distincte autorisée',
 (SELECT v FROM wa_ids WHERE k='manual2a') <> (SELECT v FROM wa_ids WHERE k='manual2b'));
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456');
RESET ROLE;
-- Simule l'arrêt du worker après le claim sans effectuer d'appel réseau.
UPDATE public.wash_whatsapp_notifications SET claimed_at=clock_timestamp()-interval '6 minutes' WHERE id=(SELECT v FROM wa_ids WHERE k='manual2b');
SET LOCAL ROLE service_role;
INSERT INTO wa_result SELECT 'Claim expiré devient incertain',public.expire_wash_whatsapp_claims((SELECT v FROM wa_ids WHERE k='coA'))=1;
RESET ROLE;
INSERT INTO wa_result VALUES ('Expiration ne remet jamais en attente',
 (SELECT status='unknown' AND reason_code='claim_expired' FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='manual2b')));
SET LOCAL ROLE authenticated;
INSERT INTO wa_result SELECT 'Demande incertaine reste idempotente',v=public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w2'),'manual-expired-claim-key') FROM wa_ids WHERE k='manual2b';
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO wa_result SELECT 'Webhook peut résoudre un résultat incertain', public.apply_wash_whatsapp_status(
 (SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='manual2b'),'wamid.recovered','delivered',1700000005,NULL);
RESET ROLE;
INSERT INTO wa_result VALUES ('Résolution tardive est tracée comme livrée',
 (SELECT status='delivered' AND provider_message_id='wamid.recovered' FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='manual2b')));

-- Un échec peut être corrigé tardivement par Meta après une relance manuelle.
-- Annuler cette relance si elle n'a pas encore été réclamée.
SET LOCAL ROLE authenticated;
SELECT public.record_wash_quality_check((SELECT v FROM wa_ids WHERE k='w10'),'approved','');
RESET ROLE;
INSERT INTO wa_ids SELECT 'auto10',id FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT v FROM wa_ids WHERE k='w10');
SET LOCAL ROLE service_role;
SELECT public.claim_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),'123456');
SELECT public.finish_wash_whatsapp((SELECT v FROM wa_ids WHERE k='coA'),(SELECT v FROM wa_ids WHERE k='auto10'),'failed',NULL,'http_400:meta_132000');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO wa_ids SELECT 'manual10',public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w10'),'manual-after-failed-ten');
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO wa_result SELECT 'Livraison tardive corrige l’échec précédent',public.apply_wash_whatsapp_status(
 (SELECT v FROM wa_ids WHERE k='coA'),'123456',(SELECT v FROM wa_ids WHERE k='auto10'),'wamid.late','delivered',1700000006,NULL);
RESET ROLE;
INSERT INTO wa_result VALUES ('Livraison tardive annule la relance non réclamée',
 (SELECT status='delivered' FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='auto10'))
 AND (SELECT status='cancelled' AND reason_code='delivery_confirmed_elsewhere' FROM public.wash_whatsapp_notifications WHERE id=(SELECT v FROM wa_ids WHERE k='manual10'))
 AND (SELECT count(*)=1 FROM public.wash_whatsapp_events WHERE notification_id=(SELECT v FROM wa_ids WHERE k='manual10') AND kind='cancelled' AND reason_code='delivery_confirmed_elsewhere'));
SET LOCAL ROLE authenticated;
INSERT INTO wa_result SELECT 'Livraison tardive empêche une autre demande',v=public.enqueue_wash_whatsapp((SELECT v FROM wa_ids WHERE k='w10'),'manual-after-late-delivery') FROM wa_ids WHERE k='auto10';
RESET ROLE;
DO $$ BEGIN
 BEGIN
  UPDATE public.whatsapp_consent_events SET source='Modification interdite' WHERE customer_id=(SELECT v FROM wa_ids WHERE k='c2');
  INSERT INTO wa_result VALUES ('Preuves consentement immuables',false);
 EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO wa_result VALUES ('Preuves consentement immuables',true); END;
 BEGIN
  DELETE FROM public.wash_whatsapp_events WHERE notification_id=(SELECT v FROM wa_ids WHERE k='manual5');
  INSERT INTO wa_result VALUES ('Journal envoi immuable',false);
 EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO wa_result VALUES ('Journal envoi immuable',true); END;
END $$;

SELECT label,ok FROM wa_result ORDER BY label;
ROLLBACK;
