BEGIN;
CREATE TEMP TABLE p10_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE p10_board (k text PRIMARY KEY, val jsonb) ON COMMIT DROP;
CREATE TEMP TABLE p10_result (label text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON p10_ids, p10_board, p10_result TO authenticated, anon;

INSERT INTO p10_result VALUES
  ('storage cross-tenant refuse 42501', false, 'en attente du garde'),
  ('periode inversee refusee 23514', false, 'en attente du garde'),
  ('cle invalide refusee 23514', false, 'en attente du garde'),
  ('RPC non autorisee refusee 23514', false, 'en attente du garde'),
  ('ecriture directe idempotence refusee 42501', false, 'en attente du garde'),
  ('anon storage insert refuse 42501', false, 'en attente du garde'),
  ('bucket insert authenticated refuse 42501', false, 'en attente du garde'),
  ('my_washes_page sans permission 42501', false, 'en attente du garde'),
  ('anon objects SELECT filtre 0 ligne malgre grant historique', false, 'en attente du garde'),
  ('anon buckets SELECT filtre 0 ligne malgre grant historique', false, 'en attente du garde');

-- 048 n a pas ete appliquee : 045, 046, 047, 049 et 050 portent le schema
-- a 49 migrations. Les grants Storage de supabase_storage_admin restent non
-- revoquables depuis postgres ; la garde 050 est donc RLS RESTRICTIVE.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'p10-a@test.invalid', jsonb_build_object('company_name','Tenant P10 A','station_name','Station P10 A','owner_name','Owner P10 A')),
  ('22222222-2222-4222-8222-222222222222', 'p10-b@test.invalid', jsonb_build_object('company_name','Tenant P10 B','station_name','Station P10 B','owner_name','Owner P10 B')),
  ('88888888-8888-4888-8888-888888888888', 'p10-admin@test.invalid', jsonb_build_object('owner_name','Super admin P10'));

INSERT INTO p10_ids VALUES
  ('userA','11111111-1111-4111-8111-111111111111'),
  ('userB','22222222-2222-4222-8222-222222222222'),
  ('admin','88888888-8888-4888-8888-888888888888'),
  ('catA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('catB','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('washA1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  ('washA2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  ('washB1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');

INSERT INTO p10_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p10_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = '22222222-2222-4222-8222-222222222222';
INSERT INTO p10_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p10_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = '22222222-2222-4222-8222-222222222222';

INSERT INTO public.platform_admins (user_id) VALUES ((SELECT id FROM p10_ids WHERE k='admin'));
UPDATE public.stations SET activated = true WHERE id IN (SELECT id FROM p10_ids WHERE k IN ('stA','stB'));

INSERT INTO public.vehicle_categories (id, company_id, station_id, name) VALUES
  ((SELECT id FROM p10_ids WHERE k='catA'), (SELECT id FROM p10_ids WHERE k='coA'), (SELECT id FROM p10_ids WHERE k='stA'), 'Berline P10 A'),
  ((SELECT id FROM p10_ids WHERE k='catB'), (SELECT id FROM p10_ids WHERE k='coB'), (SELECT id FROM p10_ids WHERE k='stB'), 'Berline P10 B');

INSERT INTO public.washes (id, company_id, station_id, number, customer_name, vehicle_category_id, vehicle_label, plate, discount_minor, total_minor, paid_minor, status) VALUES
  ((SELECT id FROM p10_ids WHERE k='washA1'), (SELECT id FROM p10_ids WHERE k='coA'), (SELECT id FROM p10_ids WHERE k='stA'), 'P10-A1', 'Client A', (SELECT id FROM p10_ids WHERE k='catA'), 'Berline P10 A', '0001 AB 01', 0, 5000, 0, 'pending'),
  ((SELECT id FROM p10_ids WHERE k='washA2'), (SELECT id FROM p10_ids WHERE k='coA'), (SELECT id FROM p10_ids WHERE k='stA'), 'P10-A2', 'Client A', (SELECT id FROM p10_ids WHERE k='catA'), 'Berline P10 A', '0002 AB 01', 0, 5000, 0, 'pending'),
  ((SELECT id FROM p10_ids WHERE k='washB1'), (SELECT id FROM p10_ids WHERE k='coB'), (SELECT id FROM p10_ids WHERE k='stB'), 'P10-B1', 'Client B', (SELECT id FROM p10_ids WHERE k='catB'), 'Berline P10 B', '0001 BC 01', 0, 5000, 0, 'pending');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

INSERT INTO p10_board SELECT 'pageA', public.my_washes_page(5, 0);
INSERT INTO p10_board SELECT 'limitA', public.my_washes_page(500, -5);
INSERT INTO p10_board SELECT 'pathA', jsonb_build_object('path', public.station_asset_path('Logo A.PNG'));
INSERT INTO p10_board SELECT 'claimFirst', public.claim_rpc_idempotency('my_washes_page', 'p10-key-0000001');
INSERT INTO p10_board SELECT 'claimSecond', public.claim_rpc_idempotency('my_washes_page', 'p10-key-0000001');
INSERT INTO p10_board SELECT 'qaA', public.my_qa_board();

INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES ('station-assets', (SELECT id FROM p10_ids WHERE k='coA')::text || '/logo-a.png',
  (SELECT id FROM p10_ids WHERE k='userA'), '{}'::jsonb);

INSERT INTO p10_board SELECT 'bucketSelectA', jsonb_build_object('count', (SELECT count(*) FROM storage.buckets));

-- Le grant SELECT anon historique subsiste, mais la policy RESTRICTIVE false
-- filtre toutes les lignes, y compris l'objet reel insere ci-dessus.
SET LOCAL ROLE anon;
INSERT INTO p10_board SELECT 'anonObjects', jsonb_build_object('count', (SELECT count(*) FROM storage.objects));
INSERT INTO p10_board SELECT 'anonBuckets', jsonb_build_object('count', (SELECT count(*) FROM storage.buckets));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
UPDATE p10_result SET ok = ((SELECT val FROM p10_board WHERE k='anonObjects')->>'count') = '0',
  detail = 'RLS restrictive : 0 objet visible par anon' WHERE label = 'anon objects SELECT filtre 0 ligne malgre grant historique';
UPDATE p10_result SET ok = ((SELECT val FROM p10_board WHERE k='anonBuckets')->>'count') = '0',
  detail = 'RLS restrictive : 0 bucket visible par anon' WHERE label = 'anon buckets SELECT filtre 0 ligne malgre grant historique';

DO $$ BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner, metadata)
  VALUES ('station-assets', (SELECT id FROM p10_ids WHERE k='coB')::text || '/logo-b.png',
    (SELECT id FROM p10_ids WHERE k='userA'), '{}'::jsonb);
  UPDATE p10_result SET ok = false, detail = 'insertion cross-tenant acceptee' WHERE label = 'storage cross-tenant refuse 42501';
EXCEPTION WHEN SQLSTATE '42501' THEN
  UPDATE p10_result SET ok = true, detail = '42501 : RLS du dossier entreprise' WHERE label = 'storage cross-tenant refuse 42501';
END $$;

DO $$ BEGIN
  PERFORM public.my_washes_page(5, 0, current_date, current_date - 1);
  UPDATE p10_result SET ok = false, detail = 'periode inversee acceptee' WHERE label = 'periode inversee refusee 23514';
EXCEPTION WHEN SQLSTATE '23514' THEN
  UPDATE p10_result SET ok = true, detail = '23514 : periode inversee' WHERE label = 'periode inversee refusee 23514';
END $$;

DO $$ BEGIN
  PERFORM public.claim_rpc_idempotency('my_qa_board', 'bad');
  UPDATE p10_result SET ok = false, detail = 'cle invalide acceptee' WHERE label = 'cle invalide refusee 23514';
EXCEPTION WHEN SQLSTATE '23514' THEN
  UPDATE p10_result SET ok = true, detail = '23514 : cle trop courte' WHERE label = 'cle invalide refusee 23514';
END $$;

DO $$ BEGIN
  PERFORM public.claim_rpc_idempotency('drop_all_tables', 'p10-key-0000002');
  UPDATE p10_result SET ok = false, detail = 'RPC non autorisee acceptee' WHERE label = 'RPC non autorisee refusee 23514';
EXCEPTION WHEN SQLSTATE '23514' THEN
  UPDATE p10_result SET ok = true, detail = '23514 : liste blanche des RPC' WHERE label = 'RPC non autorisee refusee 23514';
END $$;

DO $$ BEGIN
  INSERT INTO public.rpc_idempotency_keys (company_id, user_id, rpc_name, idempotency_key)
  VALUES ((SELECT id FROM p10_ids WHERE k='coA'), (SELECT id FROM p10_ids WHERE k='userA'),
    'my_washes_page', 'p10-direct-0001');
  UPDATE p10_result SET ok = false, detail = 'ecriture directe acceptee' WHERE label = 'ecriture directe idempotence refusee 42501';
EXCEPTION WHEN SQLSTATE '42501' THEN
  UPDATE p10_result SET ok = true, detail = '42501 : table en RLS sans grant' WHERE label = 'ecriture directe idempotence refusee 42501';
END $$;

DO $$ BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('station-assets', 'anon/logo.png', NULL, '{}'::jsonb);
    UPDATE p10_result SET ok = false, detail = 'anon a ecrit' WHERE label = 'anon storage insert refuse 42501';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    UPDATE p10_result SET ok = true, detail = '42501 : deny-all anon sur Storage' WHERE label = 'anon storage insert refuse 42501';
  END;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
END $$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
INSERT INTO p10_board SELECT 'pageB', public.my_washes_page(5, 0);

SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
INSERT INTO p10_board SELECT 'qaAdmin', public.my_qa_board();

DO $$ BEGIN
  INSERT INTO storage.buckets (id, name) VALUES ('p10-probe', 'p10-probe');
  UPDATE p10_result SET ok = false, detail = 'bucket cree par authenticated' WHERE label = 'bucket insert authenticated refuse 42501';
EXCEPTION WHEN SQLSTATE '42501' THEN
  UPDATE p10_result SET ok = true, detail = '42501 : policy restrictive bucket insert deny' WHERE label = 'bucket insert authenticated refuse 42501';
END $$;

SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$ BEGIN
  PERFORM public.my_washes_page(5, 0);
  UPDATE p10_result SET ok = false, detail = 'RPC lue sans permission' WHERE label = 'my_washes_page sans permission 42501';
EXCEPTION WHEN SQLSTATE '42501' THEN
  UPDATE p10_result SET ok = true, detail = '42501 : washes.view requis' WHERE label = 'my_washes_page sans permission 42501';
END $$;

RESET ROLE;

INSERT INTO p10_result VALUES
  ('P10 : 49 migrations, 70 tables, 2 vues, 48 permissions, 112 liaisons',
    (SELECT count(*) FROM supabase_migrations.schema_migrations) = 49
    AND (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') = 70
    AND (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN ('v_station_daily_activity','v_company_quota_usage')) = 2
    AND (SELECT count(*) FROM public.permissions) = 48
    AND (SELECT count(*) FROM public.role_permissions) = 112,
    '045-050 : cinq migrations appliquees, 048 retiree'),
  ('P10 : 5 index, 4 RPC SECURITY DEFINER, 0 grant anon, 3 triggers quota',
    (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'ix_p10_%') = 5
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('my_washes_page','station_asset_path','claim_rpc_idempotency','my_qa_board') AND p.prosecdef) = 4
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('my_washes_page','station_asset_path','claim_rpc_idempotency','my_qa_board') AND has_function_privilege('anon',p.oid,'EXECUTE')) = 0
    AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_quota_stations','trg_quota_profiles','trg_quota_washes')) = 3,
    'index et RPC exposes a authenticated uniquement'),
  ('P10 : bucket prive, 5 policies objets, 5 policies buckets, 5 restrictives',
    (SELECT count(*) FROM storage.buckets WHERE id='station-assets' AND "public" = false) = 1
    AND (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'p10_%') = 5
    AND (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='buckets' AND policyname LIKE 'p10_%') = 5
    AND (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND permissive='RESTRICTIVE') = 5,
    '046 + 049 + 050 : RLS restrictive'),
  ('P10 : my_qa_board mesure la garde RLS, pas les grants historiques',
    ((SELECT val FROM p10_board WHERE k='qaA')->>'anonStorageRevoked') = 'true'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'authenticatedBucketInsertRevoked') = 'true'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'anonStorageSelectGrant') = 'true',
    'grant SELECT anon compense par 0 ligne visible'),
  ('my_qa_board A : compteurs coherents, aucun company_id',
    ((SELECT val FROM p10_board WHERE k='qaA')->>'migrations') = '49'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'tables') = '70'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'indexes') = '5'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'rpcCount') = '4'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'storageBucket') = 'true'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->>'bucketPolicies') = '5'
    AND NOT ((SELECT val FROM p10_board WHERE k='qaA')::text LIKE '%company_id%'),
    'projection camelCase sans tenant brut'),
  ('my_qa_board admin : accessible, aucun company_id',
    ((SELECT val FROM p10_board WHERE k='qaAdmin')->>'migrations') = '49'
    AND ((SELECT val FROM p10_board WHERE k='qaAdmin')->>'storageBucket') = 'true'
    AND NOT ((SELECT val FROM p10_board WHERE k='qaAdmin')::text LIKE '%company_id%'),
    'super admin uniquement'),
  ('station_asset_path A : dossier entreprise cote serveur',
    ((SELECT val FROM p10_board WHERE k='pathA')->>'path') LIKE (SELECT id FROM p10_ids WHERE k='coA')::text || '/%',
    'aucun dossier fourni par le navigateur'),
  ('storage insert A autorise dans son dossier',
    (SELECT count(*) FROM storage.objects WHERE bucket_id='station-assets' AND name LIKE (SELECT id FROM p10_ids WHERE k='coA')::text || '/%') = 1,
    '1 logo temporaire'),
  ('my_washes_page A : 2 fiches, total 2, aucun company_id',
    ((SELECT val FROM p10_board WHERE k='pageA')->>'total') = '2'
    AND jsonb_array_length((SELECT val FROM p10_board WHERE k='pageA')->'rows') = 2
    AND ((SELECT val FROM p10_board WHERE k='pageA')->>'hasMore') = 'false'
    AND NOT ((SELECT val FROM p10_board WHERE k='pageA')::text LIKE '%company_id%'),
    'pagination cote serveur'),
  ('my_washes_page B : 1 fiche, total 1, isolation A/B',
    ((SELECT val FROM p10_board WHERE k='pageB')->>'total') = '1'
    AND jsonb_array_length((SELECT val FROM p10_board WHERE k='pageB')->'rows') = 1
    AND NOT ((SELECT val FROM p10_board WHERE k='pageB')::text LIKE '%P10-A1%')
    AND NOT ((SELECT val FROM p10_board WHERE k='pageB')::text LIKE '%Client A%'),
    'aucune fiche A chez B'),
  ('my_washes_page : limite 500 ramenee a 100, offset -5 a 0',
    ((SELECT val FROM p10_board WHERE k='limitA')->>'limit') = '100'
    AND ((SELECT val FROM p10_board WHERE k='limitA')->>'offset') = '0',
    '100 lignes maximum par page'),
  ('claim_rpc_idempotency : 1er true, 2e false',
    ((SELECT val FROM p10_board WHERE k='claimFirst')->>'firstCall') = 'true'
    AND ((SELECT val FROM p10_board WHERE k='claimSecond')->>'firstCall') = 'false',
    'cle stable rejouee une seule fois'),
  ('idempotence : 1 ligne, table en RLS, aucun company_id dans la reponse',
    (SELECT count(*) FROM public.rpc_idempotency_keys) = 1
    AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.rpc_idempotency_keys'::regclass)
    AND NOT has_table_privilege('authenticated','public.rpc_idempotency_keys','INSERT')
    AND NOT ((SELECT val FROM p10_board WHERE k='claimFirst')::text LIKE '%company_id%'),
    'seule la fonction SECURITY DEFINER ecrit'),
  ('pagination : regles serveur et aucun tenant brut',
    ((SELECT val FROM p10_board WHERE k='pageA')->'rules'->>'pagination') LIKE '%LIMIT OFFSET%'
    AND ((SELECT val FROM p10_board WHERE k='pageA')->'rules'->>'tenant') LIKE '%auth.uid()%',
    'regles documentees cote serveur'),
  ('audit financier : ecriture directe journal refusee',
    NOT has_table_privilege('authenticated','public.audit_logs','UPDATE')
    AND NOT has_table_privilege('authenticated','public.platform_audit_logs','INSERT'),
    'journaux append-only'),
  ('isolation A/B : aucune fiche A chez B',
    (SELECT count(*) FROM public.washes w WHERE w.company_id=(SELECT id FROM p10_ids WHERE k='coB') AND w.customer_name='Client A') = 0
    AND (SELECT count(*) FROM public.washes w WHERE w.company_id=(SELECT id FROM p10_ids WHERE k='coA')) = 2,
    '3 fiches temporaires au total'),
  ('my_qa_board : regles reseau, pagination, stockage, deploiement',
    ((SELECT val FROM p10_board WHERE k='qaA')->'rules'->>'network') LIKE '%Retry exponentiel%'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->'rules'->>'pagination') LIKE '%100 lignes%'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->'rules'->>'storage') LIKE '%RLS restrictive%'
    AND ((SELECT val FROM p10_board WHERE k='qaA')->'rules'->>'deployment') LIKE '%GitHub Actions%',
    'regles partagees avec le frontend'),
  ('P10 : 4 RPC exposees authenticated, 0 anon',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('my_washes_page','station_asset_path','claim_rpc_idempotency','my_qa_board') AND has_function_privilege('authenticated',p.oid,'EXECUTE')) = 4
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('my_washes_page','station_asset_path','claim_rpc_idempotency','my_qa_board') AND has_function_privilege('anon',p.oid,'EXECUTE')) = 0,
    '043, 047, 049 et 050 conserves'),
  ('P10 : bucket SELECT authenticated autorise, 0 ligne anon',
    ((SELECT val FROM p10_board WHERE k='bucketSelectA')->>'count') = '1'
    AND ((SELECT val FROM p10_board WHERE k='anonObjects')->>'count') = '0'
    AND ((SELECT val FROM p10_board WHERE k='anonBuckets')->>'count') = '0',
    'restrictions d ecriture sans bloquer la lecture du bucket'),
  ('P10 : 3 comptes, 3 fiches et 1 objet avant rollback',
    (SELECT count(*) FROM auth.users) = 3
    AND (SELECT count(*) FROM public.washes) = 3
    AND (SELECT count(*) FROM public.companies) = 2
    AND (SELECT count(*) FROM storage.objects) = 1
    AND (SELECT count(*) FROM public.rpc_idempotency_keys) = 1,
    'tout sera annule par ROLLBACK');

SELECT label, ok, detail FROM p10_result ORDER BY ok, label;
ROLLBACK;
