-- Retrait WhatsApp après expiration : base isolée uniquement, aucun réseau.
-- Vérifie les vrais rôles SQL simulés, l'atomicité, la portée et les gardes.
BEGIN;
CREATE TEMP TABLE waexp_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE waexp_results (label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON waexp_ids, waexp_results TO anon, authenticated, service_role;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a2222222-2222-4222-8222-222222222221','waexp-owner-a@test.invalid',
  '{"company_name":"WA expiré A","station_name":"Station WA A","owner_name":"Owner A"}'),
 ('b2222222-2222-4222-8222-222222222222','waexp-owner-b@test.invalid',
  '{"company_name":"WA expiré B","station_name":"Station WA B","owner_name":"Owner B"}'),
 ('c2222222-2222-4222-8222-222222222223','waexp-cashier@test.invalid','{"invitation":true}'),
 ('d2222222-2222-4222-8222-222222222224','waexp-washer@test.invalid','{"invitation":true}'),
 ('e2222222-2222-4222-8222-222222222225','waexp-inactive@test.invalid','{"invitation":true}'),
 ('f2222222-2222-4222-8222-222222222226','waexp-admin@test.invalid','{"invitation":true}');
INSERT INTO waexp_ids VALUES
 ('ownerA','a2222222-2222-4222-8222-222222222221'),('ownerB','b2222222-2222-4222-8222-222222222222'),
 ('cashier','c2222222-2222-4222-8222-222222222223'),('washer','d2222222-2222-4222-8222-222222222224'),
 ('inactive','e2222222-2222-4222-8222-222222222225'),('admin','f2222222-2222-4222-8222-222222222226');
INSERT INTO waexp_ids SELECT 'companyA',company_id FROM public.user_profiles WHERE id=(SELECT id FROM waexp_ids WHERE k='ownerA');
INSERT INTO waexp_ids SELECT 'stationA',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM waexp_ids WHERE k='ownerA');
INSERT INTO waexp_ids SELECT 'companyB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM waexp_ids WHERE k='ownerB');
INSERT INTO waexp_ids SELECT 'stationB',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM waexp_ids WHERE k='ownerB');
INSERT INTO public.platform_admins(user_id) VALUES ((SELECT id FROM waexp_ids WHERE k='admin'));
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
 SELECT (SELECT id FROM waexp_ids WHERE k='cashier'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  'Caissier non affecté','waexp-cashier@test.invalid',id,true FROM public.roles WHERE company_id IS NULL AND key='cashier';
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
 SELECT (SELECT id FROM waexp_ids WHERE k='washer'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  'Laveur sans permission','waexp-washer@test.invalid',id,true FROM public.roles WHERE company_id IS NULL AND key='washer';
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
 SELECT (SELECT id FROM waexp_ids WHERE k='inactive'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  'Caissier inactif','waexp-inactive@test.invalid',id,false FROM public.roles WHERE company_id IS NULL AND key='cashier';
INSERT INTO public.user_station_assignments(company_id,user_id,station_id) VALUES
 ((SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='washer'),(SELECT id FROM waexp_ids WHERE k='stationA')),
 ((SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='inactive'),(SELECT id FROM waexp_ids WHERE k='stationA'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
INSERT INTO waexp_ids SELECT 'catA',public.save_station_category((SELECT id FROM waexp_ids WHERE k='stationA'),NULL,'Catégorie WA A',true);
INSERT INTO waexp_ids SELECT 'customerA',public.save_customer_profile((SELECT id FROM waexp_ids WHERE k='stationA'),
 'Client A','+2250700000001','','Notes à conserver','whatsapp',true);
SELECT public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),true,'Accord explicite du client','+2250700000001');
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerB'),true);
INSERT INTO waexp_ids SELECT 'catB',public.save_station_category((SELECT id FROM waexp_ids WHERE k='stationB'),NULL,'Catégorie WA B',true);
INSERT INTO waexp_ids SELECT 'customerB',public.save_customer_profile((SELECT id FROM waexp_ids WHERE k='stationB'),
 'Client B','+2250700000002');
SELECT public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerB'),true,'Accord explicite du client','+2250700000002');
RESET ROLE;
-- Préférences héritées Premium : le retrait Standard ne doit pas les modifier.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
UPDATE public.customers SET communication_preferences='{"optIn":true,"legacy":"préserver"}'::jsonb
 WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA');
CREATE TEMP TABLE waexp_before ON COMMIT DROP AS SELECT to_jsonb(c)-ARRAY[
 'whatsapp_consent_granted','whatsapp_consent_phone','whatsapp_consent_event_id','whatsapp_consent_at','updated_at'] AS profile
 FROM public.customers c WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA');
INSERT INTO waexp_ids VALUES ('washA1',gen_random_uuid()),('washA2',gen_random_uuid()),('washA3',gen_random_uuid()),('washB',gen_random_uuid());
INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 SELECT id,(SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='stationA'),
  'WA-EXPIRED-'||k,(SELECT id FROM waexp_ids WHERE k='customerA'),(SELECT id FROM waexp_ids WHERE k='catA'),1000,'quality_check',
  (SELECT id FROM waexp_ids WHERE k='ownerA') FROM waexp_ids WHERE k IN ('washA1','washA2','washA3');
SET LOCAL ROLE authenticated;
SELECT public.record_wash_quality_check((SELECT id FROM waexp_ids WHERE k='washA1'),'approved','');
SELECT public.record_wash_quality_check((SELECT id FROM waexp_ids WHERE k='washA2'),'approved','');
SELECT public.record_wash_quality_check((SELECT id FROM waexp_ids WHERE k='washA3'),'approved','');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerB'),true);
INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='washB'),(SELECT id FROM waexp_ids WHERE k='companyB'),
  (SELECT id FROM waexp_ids WHERE k='stationB'),'WA-EXPIRED-B',(SELECT id FROM waexp_ids WHERE k='customerB'),
  (SELECT id FROM waexp_ids WHERE k='catB'),1000,'quality_check',(SELECT id FROM waexp_ids WHERE k='ownerB'));
SET LOCAL ROLE authenticated;
SELECT public.record_wash_quality_check((SELECT id FROM waexp_ids WHERE k='washB'),'approved','');
RESET ROLE;
-- Notification interentreprise historiquement corrompue, insérée uniquement
-- par le rôle propriétaire PostgreSQL : le retrait A ne doit pas toucher B.
INSERT INTO waexp_ids VALUES ('washCorruptB',gen_random_uuid()),('notifCorruptB',gen_random_uuid());
INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='washCorruptB'),(SELECT id FROM waexp_ids WHERE k='companyB'),
  (SELECT id FROM waexp_ids WHERE k='stationB'),'WA-CORRUPT-B',(SELECT id FROM waexp_ids WHERE k='customerB'),
  (SELECT id FROM waexp_ids WHERE k='catB'),1000,'ready',(SELECT id FROM waexp_ids WHERE k='ownerB'));
INSERT INTO public.wash_whatsapp_notifications(id,company_id,station_id,wash_id,customer_id,consent_event_id,recipient_e164,origin,request_key,status,created_by,created_at)
 VALUES((SELECT id FROM waexp_ids WHERE k='notifCorruptB'),(SELECT id FROM waexp_ids WHERE k='companyB'),
  (SELECT id FROM waexp_ids WHERE k='stationB'),(SELECT id FROM waexp_ids WHERE k='washCorruptB'),(SELECT id FROM waexp_ids WHERE k='customerA'),
  (SELECT whatsapp_consent_event_id FROM public.customers WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA')),
  '+2250700000001','manual','manual:corrupt-cross-tenant','pending',(SELECT id FROM waexp_ids WHERE k='ownerB'),'2000-01-01 00:00:00+00');
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO waexp_ids SELECT 'sending', (public.claim_wash_whatsapp((SELECT id FROM waexp_ids WHERE k='companyA'),'123456')->>'id')::uuid;
RESET ROLE;
INSERT INTO waexp_results VALUES ('fixture : une transmission réclamée, deux demandes en attente',
 (SELECT count(*)=1 FROM public.wash_whatsapp_notifications WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA') AND status='sending')
 AND (SELECT count(*)=2 FROM public.wash_whatsapp_notifications WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA') AND status='pending'));
-- Simuler la fin d'une période payante Standard sans modifier les données CRM.
UPDATE public.subscriptions SET plan_id='standard',status='active',current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date-1
 WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');

-- Une demande corrompue de la même entreprise référence le client A depuis
-- une autre station. Le retrait ne doit pas la modifier ; après réactivation,
-- le worker devra refuser sa transmission. Le quota n'est élargi que dans ce
-- test en ROLLBACK, pour préparer cette seconde station artificielle.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='admin'),true);
UPDATE public.plan_limits SET value_int=2 WHERE plan_id='standard' AND key='stations';
INSERT INTO waexp_ids VALUES ('stationCorruptA',gen_random_uuid()),('washCorruptEarlyA',gen_random_uuid()),('notifCorruptEarlyA',gen_random_uuid());
INSERT INTO public.stations(id,company_id,name)
 VALUES((SELECT id FROM waexp_ids WHERE k='stationCorruptA'),(SELECT id FROM waexp_ids WHERE k='companyA'),'Station corrompue test');
INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='washCorruptEarlyA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  (SELECT id FROM waexp_ids WHERE k='stationCorruptA'),'WA-CORRUPT-EARLY-A',(SELECT id FROM waexp_ids WHERE k='customerA'),
  (SELECT id FROM waexp_ids WHERE k='catA'),1000,'ready',(SELECT id FROM waexp_ids WHERE k='ownerA'));
INSERT INTO public.wash_whatsapp_notifications(id,company_id,station_id,wash_id,customer_id,consent_event_id,recipient_e164,origin,request_key,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='notifCorruptEarlyA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  (SELECT id FROM waexp_ids WHERE k='stationCorruptA'),(SELECT id FROM waexp_ids WHERE k='washCorruptEarlyA'),(SELECT id FROM waexp_ids WHERE k='customerA'),
  (SELECT whatsapp_consent_event_id FROM public.customers WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA')),
  '+2250700000001','manual','manual:corrupt-cross-station-before-withdrawal','pending',(SELECT id FROM waexp_ids WHERE k='ownerA'));
SELECT set_config('request.jwt.claim.sub','',true);

INSERT INTO waexp_results VALUES ('capacité privée inaccessible aux rôles API',
 NOT has_schema_privilege('anon','lavauto_private','USAGE')
 AND NOT has_schema_privilege('authenticated','lavauto_private','USAGE')
 AND NOT has_schema_privilege('service_role','lavauto_private','USAGE')
 AND NOT has_table_privilege('authenticated','lavauto_private.whatsapp_withdrawal_context','INSERT')
 AND NOT has_table_privilege('service_role','lavauto_private.whatsapp_withdrawal_context','SELECT')
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='lavauto_private.whatsapp_withdrawal_context'::regclass));

-- Recréer des grants et une policy permissifs de test : les gardes serveur,
-- pas seulement l'absence de GRANT, doivent refuser les mutations ordinaires.
GRANT UPDATE ON public.customers TO authenticated;
CREATE POLICY waexp_permissive_customer ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
SELECT set_config('lavauto.whatsapp_withdrawal','true',true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),true,'Nouvel accord interdit','+2250700000001');
  INSERT INTO waexp_results VALUES('nouvel accord refusé après expiration payante',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('nouvel accord refusé après expiration payante',true); END;
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'abc',NULL);
  INSERT INTO waexp_results VALUES('preuve trop courte refusée',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO waexp_results VALUES('preuve trop courte refusée',true); END;
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,repeat('x',501),NULL);
  INSERT INTO waexp_results VALUES('preuve trop longue refusée',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO waexp_results VALUES('preuve trop longue refusée',true); END;
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),NULL,'Retrait invalide',NULL);
  INSERT INTO waexp_results VALUES('état nul refusé',false);
 EXCEPTION WHEN check_violation THEN INSERT INTO waexp_results VALUES('état nul refusé',true); END;
 BEGIN PERFORM public.save_customer_profile((SELECT id FROM waexp_ids WHERE k='stationA'),'Autre nom','+2250700000001','','','none',false,(SELECT id FROM waexp_ids WHERE k='customerA'));
  INSERT INTO waexp_results VALUES('RPC de modification ordinaire toujours refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('RPC de modification ordinaire toujours refusée',true); END;
 BEGIN UPDATE public.customers SET name='Mutation directe' WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA');
  INSERT INTO waexp_results VALUES('UPDATE direct ordinaire refusé malgré grants et GUC',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('UPDATE direct ordinaire refusé malgré grants et GUC',true); END;
 BEGIN UPDATE public.customers SET whatsapp_consent_granted=false WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA');
  INSERT INTO waexp_results VALUES('retrait direct sans preuve ni capacité refusé',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('retrait direct sans preuve ni capacité refusé',true); END;
 BEGIN INSERT INTO lavauto_private.whatsapp_withdrawal_context(transaction_id,backend_pid,company_id,station_id,customer_id,actor_user_id,event_id,event_at,source)
  VALUES(txid_current(),pg_backend_pid(),(SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='stationA'),
   (SELECT id FROM waexp_ids WHERE k='customerA'),auth.uid(),gen_random_uuid(),clock_timestamp(),'Preuve forgée');
  INSERT INTO waexp_results VALUES('capacité non forgeable directement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité non forgeable directement',true); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerB'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait autre entreprise',NULL);
  INSERT INTO waexp_results VALUES('retrait interentreprise refusé',false);
 EXCEPTION WHEN no_data_found OR insufficient_privilege THEN INSERT INTO waexp_results VALUES('retrait interentreprise refusé',true); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='cashier'),true);
INSERT INTO waexp_results VALUES ('fixture caissier : permission clients mais station non affectée',
 public.has_permission('customers.manage') AND NOT public.can_access_station((SELECT id FROM waexp_ids WHERE k='stationA')));
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait hors station',NULL);
  INSERT INTO waexp_results VALUES('station non affectée refusée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('station non affectée refusée',true); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='washer'),true);
INSERT INTO waexp_results VALUES ('fixture laveur : station affectée mais pas de permission clients',
 NOT public.has_permission('customers.manage') AND public.can_access_station((SELECT id FROM waexp_ids WHERE k='stationA')));
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait sans permission',NULL);
  INSERT INTO waexp_results VALUES('permission customers.manage obligatoire',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('permission customers.manage obligatoire',true); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='inactive'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait profil inactif',NULL);
  INSERT INTO waexp_results VALUES('profil inactif refusé',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('profil inactif refusé',true); END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait anonyme',NULL);
  INSERT INTO waexp_results VALUES('RPC non accessible à anon',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('RPC non accessible à anon',true); END;
END $$;
RESET ROLE;

-- Tester aussi la forme des mutations alors qu'une capacité privée est
-- artificiellement injectée par le propriétaire PostgreSQL. Cette injection
-- est impossible aux rôles API ; les grants/policies ci-dessous sont eux
-- aussi volontairement permissifs et disparaissent au ROLLBACK.
GRANT SELECT, UPDATE ON public.wash_whatsapp_notifications TO authenticated;
GRANT INSERT ON public.whatsapp_consent_events, public.wash_whatsapp_events TO authenticated;
GRANT UPDATE ON public.stations TO authenticated;
CREATE POLICY waexp_permissive_notification ON public.wash_whatsapp_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY waexp_permissive_consent ON public.whatsapp_consent_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY waexp_permissive_event ON public.wash_whatsapp_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY waexp_permissive_station ON public.stations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
INSERT INTO waexp_ids SELECT 'pendingA',id FROM public.wash_whatsapp_notifications
 WHERE customer_id=(SELECT id FROM waexp_ids WHERE k='customerA') AND company_id=(SELECT id FROM waexp_ids WHERE k='companyA')
   AND station_id=(SELECT id FROM waexp_ids WHERE k='stationA') AND status='pending' LIMIT 1;
INSERT INTO waexp_ids VALUES ('scopeEvent',gen_random_uuid());
INSERT INTO lavauto_private.whatsapp_withdrawal_context
 (transaction_id,backend_pid,company_id,station_id,customer_id,actor_user_id,event_id,event_at,phone_e164,source)
 VALUES(txid_current(),pg_backend_pid(),(SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='stationA'),
  (SELECT id FROM waexp_ids WHERE k='customerA'),(SELECT id FROM waexp_ids WHERE k='ownerA'),(SELECT id FROM waexp_ids WHERE k='scopeEvent'),
  '2026-11-12 10:00:00+00','+2250700000001','Retrait autorisé');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN INSERT INTO public.whatsapp_consent_events(id,company_id,station_id,customer_id,kind,phone_e164,source,actor_user_id,created_at)
  VALUES((SELECT id FROM waexp_ids WHERE k='scopeEvent'),(SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='stationA'),
   (SELECT id FROM waexp_ids WHERE k='customerA'),'granted','+2250700000001','Retrait autorisé',auth.uid(),'2026-11-12 10:00:00+00');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité ne permet pas un accord',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('capacité ne permet pas un accord',false); END;
 BEGIN INSERT INTO public.whatsapp_consent_events(id,company_id,station_id,customer_id,kind,phone_e164,source,actor_user_id,created_at)
  VALUES((SELECT id FROM waexp_ids WHERE k='scopeEvent'),(SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='stationA'),
   (SELECT id FROM waexp_ids WHERE k='customerA'),'revoked','+2250700000001','Preuve différente',auth.uid(),'2026-11-12 10:00:00+00');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité ne permet pas une autre preuve',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('capacité ne permet pas une autre preuve',false); END;
 BEGIN UPDATE public.customers SET name='Modification cachée',whatsapp_consent_granted=false,whatsapp_consent_phone=NULL,
  whatsapp_consent_event_id=(SELECT id FROM waexp_ids WHERE k='scopeEvent'),whatsapp_consent_at='2026-11-12 10:00:00+00',updated_at='2026-11-12 10:00:00+00'
  WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité ne permet pas de modifier une autre colonne client',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('capacité ne permet pas de modifier une autre colonne client',false); END;
 BEGIN UPDATE public.wash_whatsapp_notifications SET status='sending' WHERE id=(SELECT id FROM waexp_ids WHERE k='pendingA');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité ne permet pas de réclamer un envoi',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('capacité ne permet pas de réclamer un envoi',false); END;
 BEGIN UPDATE public.wash_whatsapp_notifications SET status='cancelled',reason_code='consent_revoked',recipient_e164='+2250700999999'
  WHERE id=(SELECT id FROM waexp_ids WHERE k='pendingA');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('annulation ne permet pas de modifier le destinataire',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('annulation ne permet pas de modifier le destinataire',false); END;
 BEGIN INSERT INTO public.wash_whatsapp_events(notification_id,company_id,station_id,kind,reason_code)
  VALUES((SELECT id FROM waexp_ids WHERE k='pendingA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
   (SELECT id FROM waexp_ids WHERE k='stationA'),'cancelled','consent_revoked');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('journal de retrait exige une demande déjà annulée',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('journal de retrait exige une demande déjà annulée',false); END;
 BEGIN UPDATE public.stations SET name='Station modifiée' WHERE id=(SELECT id FROM waexp_ids WHERE k='stationA');
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P5002';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité sans effet sur les autres tables',true);
  WHEN SQLSTATE 'P5002' THEN INSERT INTO waexp_results VALUES('capacité sans effet sur les autres tables',false); END;
END $$;
RESET ROLE;
DELETE FROM lavauto_private.whatsapp_withdrawal_context;

-- La suspension et un autre statut de lecture seule ne deviennent pas des
-- exceptions d'écriture. L'admin ici ne sert qu'à préparer les fixtures.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='admin'),true);
UPDATE public.companies SET suspended=true WHERE id=(SELECT id FROM waexp_ids WHERE k='companyA');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait entreprise suspendue',NULL);
  INSERT INTO waexp_results VALUES('suspension entreprise toujours appliquée',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('suspension entreprise toujours appliquée',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='admin'),true);
UPDATE public.companies SET suspended=false WHERE id=(SELECT id FROM waexp_ids WHERE k='companyA');
UPDATE public.subscriptions SET status='past_due' WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait hors expiration',NULL);
  INSERT INTO waexp_results VALUES('autre motif de lecture seule non contourné',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('autre motif de lecture seule non contourné',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.subscriptions SET status='cancelled' WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait abonnement annulé',NULL);
  INSERT INTO waexp_results VALUES('abonnement annulé non assimilé à une expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('abonnement annulé non assimilé à une expiration',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.subscriptions SET status='active' WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');
CREATE TEMP TABLE waexp_subscription_backup ON COMMIT DROP AS SELECT * FROM public.subscriptions
 WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');
DELETE FROM public.subscriptions WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait sans abonnement',NULL);
  INSERT INTO waexp_results VALUES('absence d’abonnement ne crée pas d’exception',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('absence d’abonnement ne crée pas d’exception',true); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.subscriptions SELECT * FROM waexp_subscription_backup;

-- Injecter une erreur après mise à jour des demandes mais avant leur journal :
-- toute la preuve, la fiche et toutes les annulations doivent être annulées.
CREATE FUNCTION pg_temp.waexp_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='cancelled' AND NEW.reason_code='consent_revoked' THEN
  RAISE EXCEPTION 'Panne de journal simulée' USING ERRCODE='P5001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_waexp_fail_event BEFORE INSERT ON public.wash_whatsapp_events
 FOR EACH ROW EXECUTE FUNCTION pg_temp.waexp_fail_event();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait avec panne simulée',NULL);
  INSERT INTO waexp_results VALUES('erreur de journal provoque le rollback',false);
 EXCEPTION WHEN SQLSTATE 'P5001' THEN INSERT INTO waexp_results VALUES('erreur de journal provoque le rollback',true); END;
END $$;
RESET ROLE;
DROP TRIGGER zz_waexp_fail_event ON public.wash_whatsapp_events;
INSERT INTO waexp_results VALUES ('panne : preuve fiche annulations et capacité toutes annulées',
 (SELECT whatsapp_consent_granted FROM public.customers WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA'))
 AND NOT EXISTS (SELECT 1 FROM public.whatsapp_consent_events WHERE customer_id=(SELECT id FROM waexp_ids WHERE k='customerA') AND kind='revoked')
 AND (SELECT count(*)=2 FROM public.wash_whatsapp_notifications WHERE customer_id=(SELECT id FROM waexp_ids WHERE k='customerA')
  AND company_id=(SELECT id FROM waexp_ids WHERE k='companyA') AND station_id=(SELECT id FROM waexp_ids WHERE k='stationA') AND status='pending')
 AND NOT EXISTS (SELECT 1 FROM public.wash_whatsapp_events WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA') AND kind='cancelled')
 AND NOT EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context));

-- Après affectation par l'administrateur, un caissier autorisé peut aussi
-- enregistrer le retrait : ce n'est pas une exception réservée au propriétaire.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='admin'),true);
INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
 VALUES ((SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='cashier'),(SELECT id FROM waexp_ids WHERE k='stationA'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='cashier'),true);
INSERT INTO waexp_ids SELECT 'revocation',public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),false,'Retrait explicite au comptoir',NULL);
INSERT INTO waexp_results VALUES ('consultation confirme le retrait en lecture seule',
 NOT (public.my_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'))->>'granted')::boolean
 AND public.my_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'))->'history'->0->>'kind'='revoked');
DO $$ BEGIN
 BEGIN PERFORM public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),true,'Accord encore interdit','+2250700000001');
  INSERT INTO waexp_results VALUES('nouvel accord après retrait toujours interdit',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('nouvel accord après retrait toujours interdit',true); END;
 BEGIN UPDATE public.customers SET name='Mutation après retrait' WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA');
  INSERT INTO waexp_results VALUES('capacité détruite avant retour de la RPC',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO waexp_results VALUES('capacité détruite avant retour de la RPC',true); END;
END $$;
RESET ROLE;
INSERT INTO waexp_results VALUES ('preuve liée à la fiche et à son auteur',
 EXISTS (SELECT 1 FROM public.whatsapp_consent_events e JOIN public.customers c ON c.whatsapp_consent_event_id=e.id
  WHERE e.id=(SELECT id FROM waexp_ids WHERE k='revocation') AND e.kind='revoked'
   AND e.company_id=(SELECT id FROM waexp_ids WHERE k='companyA') AND e.station_id=(SELECT id FROM waexp_ids WHERE k='stationA')
   AND e.customer_id=c.id AND e.actor_user_id=(SELECT id FROM waexp_ids WHERE k='cashier')
   AND e.phone_e164='+2250700000001' AND e.source='Retrait explicite au comptoir'
   AND NOT c.whatsapp_consent_granted AND c.whatsapp_consent_phone IS NULL AND c.whatsapp_consent_at=e.created_at)),
 ('toutes les demandes non réclamées annulées et journalisées',
 (SELECT count(*)=2 FROM public.wash_whatsapp_notifications n WHERE n.customer_id=(SELECT id FROM waexp_ids WHERE k='customerA')
  AND n.status='cancelled' AND n.reason_code='consent_revoked'
  AND EXISTS (SELECT 1 FROM public.wash_whatsapp_events e WHERE e.notification_id=n.id AND e.kind='cancelled' AND e.reason_code='consent_revoked'))),
 ('transmission déjà réclamée non rappelée',
 (SELECT status='sending' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='sending'))),
 ('autres champs client conservés même après retour Standard',
 (SELECT (to_jsonb(c)-ARRAY['whatsapp_consent_granted','whatsapp_consent_phone','whatsapp_consent_event_id','whatsapp_consent_at','updated_at'])
  IS NOT DISTINCT FROM (SELECT profile FROM waexp_before) FROM public.customers c WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA'))),
 ('autre entreprise et sa demande conservées',
 (SELECT whatsapp_consent_granted FROM public.customers WHERE id=(SELECT id FROM waexp_ids WHERE k='customerB'))
 AND (SELECT status='pending' FROM public.wash_whatsapp_notifications WHERE wash_id=(SELECT id FROM waexp_ids WHERE k='washB'))),
 ('notification interentreprise corrompue jamais modifiée par le retrait',
 (SELECT status='pending' AND reason_code IS NULL FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='notifCorruptB'))
 AND NOT EXISTS (SELECT 1 FROM public.wash_whatsapp_events WHERE notification_id=(SELECT id FROM waexp_ids WHERE k='notifCorruptB'))),
 ('notification interstation corrompue jamais modifiée par le retrait',
 (SELECT status='pending' AND reason_code IS NULL FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='notifCorruptEarlyA'))
 AND NOT EXISTS (SELECT 1 FROM public.wash_whatsapp_events WHERE notification_id=(SELECT id FROM waexp_ids WHERE k='notifCorruptEarlyA'))),
 ('capacité effacée après succès', NOT EXISTS (SELECT 1 FROM lavauto_private.whatsapp_withdrawal_context));

-- Un callback d'un claim antérieur reste enregistrable après retrait et expiry.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT public.finish_wash_whatsapp((SELECT id FROM waexp_ids WHERE k='companyA'),(SELECT id FROM waexp_ids WHERE k='sending'),'accepted','wamid.waexp',NULL);
INSERT INTO waexp_results VALUES ('callback tardif reste enregistrable après retrait',
 public.apply_wash_whatsapp_status((SELECT id FROM waexp_ids WHERE k='companyA'),'123456',(SELECT id FROM waexp_ids WHERE k='sending'),'wamid.waexp','delivered',1700000000,NULL));
RESET ROLE;
UPDATE public.subscriptions SET current_period_end=(clock_timestamp() AT TIME ZONE 'UTC')::date+30
 WHERE company_id=(SELECT id FROM waexp_ids WHERE k='companyA');
SET LOCAL ROLE service_role;
INSERT INTO waexp_results VALUES ('réactivation ne remet pas les anciennes demandes en attente',
 public.claim_wash_whatsapp((SELECT id FROM waexp_ids WHERE k='companyA'),'123456') IS NULL);
RESET ROLE;
INSERT INTO waexp_results VALUES ('résultat fournisseur et annulations conservés après réactivation',
 (SELECT status='delivered' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='sending'))
 AND (SELECT count(*)=2 FROM public.wash_whatsapp_notifications WHERE customer_id=(SELECT id FROM waexp_ids WHERE k='customerA')
  AND status='cancelled' AND reason_code='consent_revoked')),
 ('worker annule la notification interstation corrompue après réactivation',
 (SELECT status='cancelled' AND reason_code='consent_changed' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='notifCorruptEarlyA')));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='cashier'),true);
SELECT public.save_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'),true,'Nouvel accord explicite après réactivation','+2250700000001');
INSERT INTO waexp_results VALUES ('un nouvel accord explicite reste possible après réactivation',
 (public.my_customer_whatsapp_consent((SELECT id FROM waexp_ids WHERE k='customerA'))->>'granted')::boolean);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO waexp_results VALUES ('nouvel accord ne ressuscite pas les anciennes demandes annulées',
 public.claim_wash_whatsapp((SELECT id FROM waexp_ids WHERE k='companyA'),'123456') IS NULL);
RESET ROLE;
-- Même si un compte privilégié a créé une notification pour une autre station
-- ou pour le mauvais client avec la preuve actuelle, ne jamais l'envoyer.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='ownerA'),true);
INSERT INTO waexp_ids SELECT 'otherCustomerA',public.save_customer_profile((SELECT id FROM waexp_ids WHERE k='stationA'),'Autre client A','+2250700000003');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM waexp_ids WHERE k='admin'),true);
INSERT INTO waexp_ids VALUES ('washCorruptA',gen_random_uuid()),('notifCorruptA',gen_random_uuid()),
 ('washWrongCustomerA',gen_random_uuid()),('notifWrongCustomerA',gen_random_uuid());
INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='washCorruptA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  (SELECT id FROM waexp_ids WHERE k='stationCorruptA'),'WA-CORRUPT-A',(SELECT id FROM waexp_ids WHERE k='customerA'),
  (SELECT id FROM waexp_ids WHERE k='catA'),1000,'ready',(SELECT id FROM waexp_ids WHERE k='ownerA'));
INSERT INTO public.wash_whatsapp_notifications(id,company_id,station_id,wash_id,customer_id,consent_event_id,recipient_e164,origin,request_key,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='notifCorruptA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  (SELECT id FROM waexp_ids WHERE k='stationCorruptA'),(SELECT id FROM waexp_ids WHERE k='washCorruptA'),(SELECT id FROM waexp_ids WHERE k='customerA'),
  (SELECT whatsapp_consent_event_id FROM public.customers WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA')),
  '+2250700000001','manual','manual:corrupt-cross-station','pending',(SELECT id FROM waexp_ids WHERE k='ownerA'));
INSERT INTO public.washes(id,company_id,station_id,number,customer_id,vehicle_category_id,total_minor,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='washWrongCustomerA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  (SELECT id FROM waexp_ids WHERE k='stationA'),'WA-WRONG-CUSTOMER',(SELECT id FROM waexp_ids WHERE k='otherCustomerA'),
  (SELECT id FROM waexp_ids WHERE k='catA'),1000,'ready',(SELECT id FROM waexp_ids WHERE k='ownerA'));
INSERT INTO public.wash_whatsapp_notifications(id,company_id,station_id,wash_id,customer_id,consent_event_id,recipient_e164,origin,request_key,status,created_by)
 VALUES((SELECT id FROM waexp_ids WHERE k='notifWrongCustomerA'),(SELECT id FROM waexp_ids WHERE k='companyA'),
  (SELECT id FROM waexp_ids WHERE k='stationA'),(SELECT id FROM waexp_ids WHERE k='washWrongCustomerA'),(SELECT id FROM waexp_ids WHERE k='customerA'),
  (SELECT whatsapp_consent_event_id FROM public.customers WHERE id=(SELECT id FROM waexp_ids WHERE k='customerA')),
  '+2250700000001','manual','manual:corrupt-wrong-customer','pending',(SELECT id FROM waexp_ids WHERE k='ownerA'));
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO waexp_results VALUES ('claim refuse une notification corrompue vers une autre station',
 public.claim_wash_whatsapp((SELECT id FROM waexp_ids WHERE k='companyA'),'123456') IS NULL);
RESET ROLE;
INSERT INTO waexp_results VALUES ('notification interstation corrompue annulée avant transmission',
 (SELECT status='cancelled' AND reason_code='consent_changed' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='notifCorruptA'))),
 ('notification vers un autre client annulée avant transmission',
 (SELECT status='cancelled' AND reason_code='wash_no_longer_ready' FROM public.wash_whatsapp_notifications WHERE id=(SELECT id FROM waexp_ids WHERE k='notifWrongCustomerA')));

SELECT label, ok FROM waexp_results ORDER BY label;
ROLLBACK;
