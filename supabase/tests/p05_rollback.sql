-- Test d'intégration Prompt 05 — À EXÉCUTER DANS UNE TRANSACTION AVEC ROLLBACK.
-- Aucune donnée persistée : 3 comptes Auth, 2 entreprises, 2 stations, 2 fiches,
-- 2 postes, 2 clients. 17 contrôles, tous attendus vrais.
-- Le connecteur Supabase exécute ce script via `execute_query` (BEGIN … ROLLBACK).
BEGIN;
CREATE TEMP TABLE p05_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE p05_result (label text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON p05_ids, p05_result TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner-a@test.invalid',
   jsonb_build_object('company_name','Tenant A','station_name','Station A','owner_name','Owner A')),
  ('22222222-2222-4222-8222-222222222222', 'owner-b@test.invalid',
   jsonb_build_object('company_name','Tenant B','station_name','Station B','owner_name','Owner B')),
  ('33333333-3333-4333-8333-333333333333', 'emp-a@test.invalid',
   jsonb_build_object('invitation', true));

INSERT INTO p05_ids VALUES ('userA','11111111-1111-4111-8111-111111111111'),
  ('userB','22222222-2222-4222-8222-222222222222'),
  ('empA','33333333-3333-4333-8333-333333333333'),
  ('catA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('catB','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  ('srvA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('srvB','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  ('postA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  ('cliA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
  ('cliB','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4');
INSERT INTO p05_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p05_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = '22222222-2222-4222-8222-222222222222';
INSERT INTO p05_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p05_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = '22222222-2222-4222-8222-222222222222';

INSERT INTO public.user_profiles (id, company_id, full_name, email, role_id, active)
SELECT '33333333-3333-4333-8333-333333333333', (SELECT v FROM p05_ids WHERE k='coA'),
  'Employe A', 'emp-a@test.invalid',
  (SELECT id FROM public.roles WHERE company_id IS NULL AND key = 'washer'), true;
INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
SELECT (SELECT v FROM p05_ids WHERE k='coA'), '33333333-3333-4333-8333-333333333333',
  (SELECT v FROM p05_ids WHERE k='stA');

UPDATE public.stations SET activated = true
WHERE id IN (SELECT v FROM p05_ids WHERE k IN ('stA','stB'));

INSERT INTO public.vehicle_categories (id, company_id, station_id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(SELECT v FROM p05_ids WHERE k='coA'),(SELECT v FROM p05_ids WHERE k='stA'),'Berline A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',(SELECT v FROM p05_ids WHERE k='coB'),(SELECT v FROM p05_ids WHERE k='stB'),'Berline B');
INSERT INTO public.services (id, company_id, station_id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',(SELECT v FROM p05_ids WHERE k='coA'),(SELECT v FROM p05_ids WHERE k='stA'),'Lavage A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',(SELECT v FROM p05_ids WHERE k='coB'),(SELECT v FROM p05_ids WHERE k='stB'),'Lavage B');
INSERT INTO public.service_prices (company_id, station_id, service_id, vehicle_category_id, price_minor) VALUES
  ((SELECT v FROM p05_ids WHERE k='coA'),(SELECT v FROM p05_ids WHERE k='stA'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',3000),
  ((SELECT v FROM p05_ids WHERE k='coB'),(SELECT v FROM p05_ids WHERE k='stB'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',3000);
INSERT INTO public.wash_posts (id, company_id, station_id, name, capacity)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',(SELECT v FROM p05_ids WHERE k='coA'),(SELECT v FROM p05_ids WHERE k='stA'),'Piste A',2);
INSERT INTO public.customers (id, company_id, station_id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',(SELECT v FROM p05_ids WHERE k='coA'),(SELECT v FROM p05_ids WHERE k='stA'),'Client A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',(SELECT v FROM p05_ids WHERE k='coB'),(SELECT v FROM p05_ids WHERE k='stB'),'Client B');

-- ── Session propriétaire A ──────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO p05_ids SELECT 'washA', public.create_wash_full(jsonb_build_object(
  'station_id',(SELECT v FROM p05_ids WHERE k='stA'),
  'category_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'plate','1234 AB 01','customer_name','Client A','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','qty',1)),
  'employee_ids',jsonb_build_array('33333333-3333-4333-8333-333333333333'),
  'post_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','idempotency_key','p05-wash-a'));
SELECT set_config('p05.washA',(SELECT v::text FROM p05_ids WHERE k='washA'),true);

INSERT INTO p05_result VALUES
  ('creation : affectation multiple + historique initial',
   (SELECT status='assigned' AND plate='1234 AB 01' AND vehicle_id IS NOT NULL FROM public.washes WHERE id=(SELECT v FROM p05_ids WHERE k='washA'))
   AND (SELECT count(*)=1 FROM public.wash_assignments WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA') AND unassigned_at IS NULL)
   AND (SELECT count(*)=2 FROM public.wash_status_history WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA')),
   'status=assigned, 1 affectation, 2 evenements, vehicule cree'),
  ('prix fige a la creation : 3000',
   (SELECT count(*)=1 AND min(unit_price_minor)=3000 FROM public.wash_items WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA')),
   'unit_price_minor');

-- Modifier la grille tarifaire : la fiche deja enregistree ne bouge pas.
UPDATE public.service_prices SET price_minor = 9999
WHERE service_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
INSERT INTO p05_result VALUES
  ('prix inchangé après modification de la grille',
   (SELECT min(unit_price_minor)=3000 FROM public.wash_items WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA')),
   'grille=9999, fiche=3000');

-- Idempotence : même clé → même fiche, aucun lavage compté deux fois.
SELECT public.create_wash_full(jsonb_build_object(
  'station_id',(SELECT v FROM p05_ids WHERE k='stA'),
  'category_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'plate','1234 AB 01','customer_name','Client A','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','qty',1)),
  'employee_ids','[]'::jsonb,'idempotency_key','p05-wash-a'));
INSERT INTO p05_result VALUES
  ('idempotence : aucun lavage compté deux fois',
   (SELECT count(*)=1 FROM public.washes WHERE idempotency_key='p05-wash-a'),
   '1 fiche pour 2 appels');

-- Cycle complet : assigned → in_progress → quality_check → ready → delivered.
SELECT public.transition_wash_status((SELECT v FROM p05_ids WHERE k='washA'),'in_progress');
SELECT public.transition_wash_status((SELECT v FROM p05_ids WHERE k='washA'),'quality_check');
DO $$ BEGIN
  BEGIN
    PERFORM public.transition_wash_status(current_setting('p05.washA')::uuid,'ready');
    INSERT INTO p05_result VALUES ('contrôle qualité obligatoire',false,'ready direct autorisé');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p05_result VALUES ('contrôle qualité obligatoire',true,'23514 : ready direct refusé');
  END;
END $$;
-- Création d'un poste sur une station explicite et projection stationId.
SELECT public.create_wash_post('Piste C', 2, (SELECT v FROM p05_ids WHERE k='stA'));
INSERT INTO p05_result VALUES
  ('postes : stationId projeté et création sur station explicite',
   (SELECT count(*)=2 FROM jsonb_array_elements(public.my_wash_posts()) t(p)
    WHERE (t.p->>'stationId')=(SELECT v::text FROM p05_ids WHERE k='stA')),
   '2 postes pour la station A');
SELECT public.record_wash_quality_check((SELECT v FROM p05_ids WHERE k='washA'),'approved','RAS');
INSERT INTO p05_result VALUES
  ('« terminé »/ready n’est PAS « livré »/delivered',
   (SELECT status='ready' AND finished_at IS NOT NULL AND delivered_at IS NULL
    FROM public.washes WHERE id=(SELECT v FROM p05_ids WHERE k='washA'))
   AND (SELECT count(*)=1 FROM public.wash_quality_checks WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA') AND result='approved'),
   'ready, delivered_at NULL, qualite approuvee');
DO $$ BEGIN
  BEGIN
    PERFORM public.transition_wash_status(current_setting('p05.washA')::uuid,'in_progress');
    INSERT INTO p05_result VALUES ('transition interdite après livraison/terminaison',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p05_result VALUES ('transition interdite refusée',true,'23514');
  END;
END $$;
SELECT public.transition_wash_status((SELECT v FROM p05_ids WHERE k='washA'),'delivered');
INSERT INTO p05_result VALUES
  ('livraison distincte et tracée',
   (SELECT status='delivered' AND delivered_at IS NOT NULL FROM public.washes WHERE id=(SELECT v FROM p05_ids WHERE k='washA'))
   AND (SELECT bool_or(to_status='delivered') FROM public.wash_status_history WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA')),
   'delivered_at + historique');

-- Paiement idempotent, sans impact caisse (Mobile Money).
SELECT public.record_wash_payment_by_key((SELECT v FROM p05_ids WHERE k='washA'),1000,'mobile_money','','p05-pay-1');
SELECT public.record_wash_payment_by_key((SELECT v FROM p05_ids WHERE k='washA'),1000,'mobile_money','','p05-pay-1');
INSERT INTO p05_result VALUES
  ('paiement idempotent : un seul encaissement',
   (SELECT count(*)=1 FROM public.payments WHERE wash_id=(SELECT v FROM p05_ids WHERE k='washA'))
   AND (SELECT paid_minor=1000 FROM public.washes WHERE id=(SELECT v FROM p05_ids WHERE k='washA')),
   '1 paiement, 1000');

-- ── Session propriétaire B : isolation A/B ──────────────────────────────────
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
INSERT INTO p05_ids SELECT 'washB', public.create_wash_full(jsonb_build_object(
  'station_id',(SELECT v FROM p05_ids WHERE k='stB'),
  'category_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'plate','9999 ZZ 99','customer_name','Client B','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','qty',1)),
  'employee_ids','[]'::jsonb,'idempotency_key','p05-wash-b'));
SELECT set_config('p05.washB',(SELECT v::text FROM p05_ids WHERE k='washB'),true);
INSERT INTO p05_result VALUES
  ('clients B : isolation A/B 0 fuite',
   (SELECT count(*)=1 FROM jsonb_array_elements(public.my_company_clients()) t(c)
    WHERE (t.c->>'name')='Client B')
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_company_clients()) t(c)
    WHERE (t.c->>'name')='Client A'),
   'B voit 1 client, pas celui de A');
INSERT INTO p05_result VALUES
  ('isolation B : 0 fuite de la fiche A',
   (SELECT count(*)=1 FROM jsonb_array_elements(public.my_wash_board()) t(w) WHERE (t.w->>'id')=current_setting('p05.washB'))
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_wash_board()) t(w) WHERE (t.w->>'id')=current_setting('p05.washA')),
   'board B = 1 fiche, fiche A invisible');
DO $$ BEGIN
  BEGIN
    PERFORM public.transition_wash_status(current_setting('p05.washA')::uuid,'in_progress');
    INSERT INTO p05_result VALUES ('B peut modifier la fiche de A',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    INSERT INTO p05_result VALUES ('B ne peut pas modifier la fiche de A',true,'P0002');
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO p05_result VALUES
  ('clients A : UUID serveur pour la création de fiche',
   (SELECT count(*)=1 FROM jsonb_array_elements(public.my_company_clients()) t(c)
    WHERE (t.c->>'name')='Client A')
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_company_clients()) t(c)
    WHERE (t.c->>'name')='Client B'),
   'A voit 1 client, pas celui de B');
INSERT INTO p05_result VALUES
  ('isolation A : 0 fuite de la fiche B',
   (SELECT count(*)=1 FROM jsonb_array_elements(public.my_wash_board()) t(w) WHERE (t.w->>'id')=current_setting('p05.washA'))
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_wash_board()) t(w) WHERE (t.w->>'id')=current_setting('p05.washB')),
   'board A = 1 fiche, fiche B invisible');
INSERT INTO p05_result VALUES
  ('historique véhicule servi par le serveur',
   (SELECT count(*)=1 FROM jsonb_array_elements(public.my_vehicle_history('1234 AB 01')) t(w)
    WHERE (t.w->>'plate')='1234 AB 01'),
   '1 fiche pour la plaque A');

-- Écriture directe refusée (REVOKE sur authenticated, RPC seuls autorisés).
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.washes SET status='delivered' WHERE id=current_setting('p05.washA')::uuid;
    INSERT INTO p05_result VALUES ('écriture directe autorisée',false,'aucune exception');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO p05_result VALUES ('écriture directe refusée',true,'42501');
  END;
END $$;
RESET ROLE;

SELECT label, ok, detail FROM p05_result ORDER BY label;
ROLLBACK;
