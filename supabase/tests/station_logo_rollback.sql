-- Test de la migration 051. A exécuter après 001–050 + 051, dans une base de
-- test : toutes les fixtures Auth et Storage sont annulées par ROLLBACK.
BEGIN;
CREATE TEMP TABLE logo_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE logo_results (label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON logo_ids, logo_results TO authenticated, anon;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'logo-a@test.invalid',
    jsonb_build_object('company_name','Logo Tenant A','station_name','Logo Station A','owner_name','Owner A')),
  ('22222222-2222-4222-8222-222222222222', 'logo-b@test.invalid',
    jsonb_build_object('company_name','Logo Tenant B','station_name','Logo Station B','owner_name','Owner B')),
  ('33333333-3333-4333-8333-333333333333', 'logo-staff@test.invalid',
    jsonb_build_object('invitation', true));
INSERT INTO logo_ids VALUES
  ('userA','11111111-1111-4111-8111-111111111111'),
  ('userB','22222222-2222-4222-8222-222222222222'),
  ('staff','33333333-3333-4333-8333-333333333333');
INSERT INTO logo_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = (SELECT id FROM logo_ids WHERE k='userA');
INSERT INTO logo_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = (SELECT id FROM logo_ids WHERE k='userB');
INSERT INTO logo_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = (SELECT id FROM logo_ids WHERE k='userA');
INSERT INTO logo_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = (SELECT id FROM logo_ids WHERE k='userB');

INSERT INTO public.user_profiles (id, company_id, full_name, email, role_id, active)
VALUES ((SELECT id FROM logo_ids WHERE k='staff'), (SELECT id FROM logo_ids WHERE k='coA'),
  'Caissier A', 'logo-staff@test.invalid',
  (SELECT id FROM public.roles WHERE company_id IS NULL AND key='cashier'), true);
INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
VALUES ((SELECT id FROM logo_ids WHERE k='coA'), (SELECT id FROM logo_ids WHERE k='staff'), (SELECT id FROM logo_ids WHERE k='stA'));

-- Objets de test, insérés uniquement dans la transaction de recette.
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('station-assets', (SELECT id FROM logo_ids WHERE k='coA')::text || '/logo-a.webp', (SELECT id FROM logo_ids WHERE k='userA'), '{}'::jsonb),
  ('station-assets', (SELECT id FROM logo_ids WHERE k='coB')::text || '/logo-b.webp', (SELECT id FROM logo_ids WHERE k='userB'), '{}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM logo_ids WHERE k='userA'), true);
SELECT public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), (SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp');
INSERT INTO logo_results SELECT 'association persistée et relue dans my_context',
  (SELECT logo_path = (SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp' FROM public.stations WHERE id = (SELECT id FROM logo_ids WHERE k='stA'))
  AND (public.my_context()->'stations'->0->>'logoPath') = (SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp';

DO $$ BEGIN
  BEGIN
    PERFORM public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), 'https://example.invalid/logo.png');
    INSERT INTO logo_results VALUES ('URL arbitraire refusée', false);
  EXCEPTION WHEN SQLSTATE '23514' THEN INSERT INTO logo_results VALUES ('URL arbitraire refusée', true); END;
  BEGIN
    PERFORM public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), (SELECT id::text FROM logo_ids WHERE k='coB') || '/logo-b.webp');
    INSERT INTO logo_results VALUES ('chemin autre tenant refusé', false);
  EXCEPTION WHEN SQLSTATE '23514' THEN INSERT INTO logo_results VALUES ('chemin autre tenant refusé', true); END;
  BEGIN
    PERFORM public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), (SELECT id::text FROM logo_ids WHERE k='coA') || '/absent.webp');
    INSERT INTO logo_results VALUES ('objet absent refusé', false);
  EXCEPTION WHEN SQLSTATE '23514' THEN INSERT INTO logo_results VALUES ('objet absent refusé', true); END;
  BEGIN
    PERFORM public.save_station_logo((SELECT id FROM logo_ids WHERE k='stB'), (SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp');
    INSERT INTO logo_results VALUES ('station autre tenant refusée', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO logo_results VALUES ('station autre tenant refusée', true); END;
  BEGIN
    UPDATE public.stations SET logo_path = 'https://example.invalid/logo.png' WHERE id = (SELECT id FROM logo_ids WHERE k='stA');
    INSERT INTO logo_results VALUES ('URL directe refusée par le garde', false);
  EXCEPTION WHEN SQLSTATE '23514' THEN INSERT INTO logo_results VALUES ('URL directe refusée par le garde', true); END;
END $$;

-- Le caissier peut lire le contexte de sa station mais ne peut ni associer un
-- autre logo, ni contourner la RPC ou modifier les objets du bucket privé.
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM logo_ids WHERE k='staff'), true);
INSERT INTO logo_results SELECT 'logo lisible par un employé affecté',
  (public.my_context()->'stations'->0->>'logoPath') = (SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp';
DO $$ DECLARE v_rows integer; BEGIN
  BEGIN
    PERFORM public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), NULL);
    INSERT INTO logo_results VALUES ('RPC interdite sans settings.manage', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO logo_results VALUES ('RPC interdite sans settings.manage', true); END;
  BEGIN
    UPDATE public.stations SET logo_path = NULL WHERE id = (SELECT id FROM logo_ids WHERE k='stA');
    INSERT INTO logo_results VALUES ('écriture directe interdite sans settings.manage', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO logo_results VALUES ('écriture directe interdite sans settings.manage', true); END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('station-assets', (SELECT id::text FROM logo_ids WHERE k='coA') || '/non-autorise.webp', (SELECT id FROM logo_ids WHERE k='staff'), '{}'::jsonb);
    INSERT INTO logo_results VALUES ('upload interdit sans settings.manage', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO logo_results VALUES ('upload interdit sans settings.manage', true); END;
  UPDATE storage.objects SET metadata = '{"changed":true}'::jsonb
    WHERE bucket_id='station-assets' AND name=(SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO logo_results VALUES ('remplacement Storage interdit sans settings.manage', v_rows = 0);
  DELETE FROM storage.objects
    WHERE bucket_id='station-assets' AND name=(SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO logo_results VALUES ('suppression Storage interdite sans settings.manage', v_rows = 0);
END $$;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM logo_ids WHERE k='userB'), true);
INSERT INTO logo_results SELECT 'contexte B sans logo de A',
  (public.my_context()->'stations'->0->>'logoPath') IS NULL;
SELECT public.save_station_logo((SELECT id FROM logo_ids WHERE k='stB'), (SELECT id::text FROM logo_ids WHERE k='coB') || '/logo-b.webp');
INSERT INTO logo_results SELECT 'association B indépendante',
  (public.my_context()->'stations'->0->>'logoPath') = (SELECT id::text FROM logo_ids WHERE k='coB') || '/logo-b.webp';

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM logo_ids WHERE k='userA'), true);
SELECT public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), NULL);
INSERT INTO logo_results SELECT 'retrait dissocie sans supprimer le fichier',
  (SELECT logo_path IS NULL FROM public.stations WHERE id = (SELECT id FROM logo_ids WHERE k='stA'))
  AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='station-assets' AND name=(SELECT id::text FROM logo_ids WHERE k='coA') || '/logo-a.webp');

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.save_station_logo((SELECT id FROM logo_ids WHERE k='stA'), NULL);
    INSERT INTO logo_results VALUES ('RPC interdite à anon', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO logo_results VALUES ('RPC interdite à anon', true); END;
END $$;

SELECT label, ok FROM logo_results ORDER BY label;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM logo_results WHERE ok IS NOT TRUE) THEN
    RAISE EXCEPTION 'Au moins un test station logo a échoué';
  END IF;
END $$;
ROLLBACK;
