-- Recette de l'identité après 057 : uniquement dans une base isolée.
-- Les rôles/Auth sont simulés ; aucune fixture ne subsiste après ROLLBACK.
BEGIN;
CREATE TEMP TABLE ident_ids(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE ident_results(label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON ident_ids, ident_results TO anon, authenticated, service_role;
SELECT set_config('request.jwt.claim.sub','',true);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('99999999-9999-4999-8999-999999999991','ident-owner-a@test.invalid',
  '{"company_name":"Identité A","station_name":"Station A","owner_name":"Owner A"}'),
 ('99999999-9999-4999-8999-999999999992','ident-owner-b@test.invalid',
  '{"company_name":"Identité B","station_name":"Station B","owner_name":"Owner B"}'),
 ('99999999-9999-4999-8999-999999999993','ident-manager@test.invalid','{"invitation":true}'),
 ('99999999-9999-4999-8999-999999999994','ident-washer@test.invalid','{"invitation":true}'),
 ('99999999-9999-4999-8999-999999999995','ident-unlinked@test.invalid','{"invitation":true}');
INSERT INTO ident_ids VALUES
 ('ownerA','99999999-9999-4999-8999-999999999991'),('ownerB','99999999-9999-4999-8999-999999999992'),
 ('manager','99999999-9999-4999-8999-999999999993'),('washer','99999999-9999-4999-8999-999999999994'),
 ('unlinked','99999999-9999-4999-8999-999999999995');
INSERT INTO ident_ids SELECT 'companyA',company_id FROM public.user_profiles WHERE id=(SELECT id FROM ident_ids WHERE k='ownerA');
INSERT INTO ident_ids SELECT 'stationA',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ident_ids WHERE k='ownerA');
INSERT INTO ident_ids SELECT 'companyB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM ident_ids WHERE k='ownerB');
INSERT INTO ident_ids SELECT 'stationB',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ident_ids WHERE k='ownerB');
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id)
 SELECT (SELECT id FROM ident_ids WHERE k='manager'),(SELECT id FROM ident_ids WHERE k='companyA'),
   'Gérant A','ident-manager@test.invalid',id FROM public.roles WHERE company_id IS NULL AND key='manager';
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id)
 SELECT (SELECT id FROM ident_ids WHERE k='washer'),(SELECT id FROM ident_ids WHERE k='companyA'),
   'Laveur A','ident-washer@test.invalid',id FROM public.roles WHERE company_id IS NULL AND key='washer';
INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
 VALUES ((SELECT id FROM ident_ids WHERE k='companyA'),(SELECT id FROM ident_ids WHERE k='manager'),(SELECT id FROM ident_ids WHERE k='stationA')),
        ((SELECT id FROM ident_ids WHERE k='companyA'),(SELECT id FROM ident_ids WHERE k='washer'),(SELECT id FROM ident_ids WHERE k='stationA')),
        -- Donnée corrompue simulée en service : elle ne doit pas ouvrir B.
        ((SELECT id FROM ident_ids WHERE k='companyA'),(SELECT id FROM ident_ids WHERE k='washer'),(SELECT id FROM ident_ids WHERE k='stationB'));
INSERT INTO public.user_invitations(company_id,email,role_id,station_ids,token_hash,invited_by,expires_at)
 SELECT (SELECT id FROM ident_ids WHERE k='companyA'),'ident-legacy@test.invalid',id,
   jsonb_build_array((SELECT id FROM ident_ids WHERE k='stationA')),repeat('9',64),
   (SELECT id FROM ident_ids WHERE k='ownerA'),now()+interval '7 days'
 FROM public.roles WHERE company_id IS NULL AND key='washer';
INSERT INTO ident_ids SELECT 'legacy',id FROM public.user_invitations WHERE email='ident-legacy@test.invalid';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ident_ids WHERE k='manager'),true);
INSERT INTO ident_results VALUES
 ('le gérant de test peut gérer les employés mais pas l’abonnement',
   public.has_permission('employees.manage') AND public.has_permission('employees.invite')
   AND NOT public.has_permission('subscription.manage')
   AND (SELECT count(*)=1 FROM public.user_profiles WHERE id=(SELECT id FROM ident_ids WHERE k='ownerA'))),
 ('écritures d’identité directes non accordées',
   NOT has_table_privilege('authenticated','public.user_profiles','INSERT')
   AND NOT has_table_privilege('authenticated','public.user_profiles','UPDATE')
   AND NOT has_column_privilege('authenticated','public.user_profiles','role_id','UPDATE')
   AND NOT has_table_privilege('authenticated','public.user_station_assignments','DELETE')
   AND NOT has_table_privilege('authenticated','public.user_invitations','INSERT')
   AND NOT has_table_privilege('authenticated','public.user_invitations','UPDATE')),
 ('gérant limité aux stations existantes de son entreprise',
   public.can_access_station((SELECT id FROM ident_ids WHERE k='stationA'))
   AND NOT public.can_access_station((SELECT id FROM ident_ids WHERE k='stationB'))
   AND NOT public.can_access_station('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid)
   AND NOT public.can_access_station(NULL::uuid));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ident_ids WHERE k='ownerA'),true);
INSERT INTO ident_results VALUES ('propriétaire limité aux stations de son entreprise',
 public.can_access_station((SELECT id FROM ident_ids WHERE k='stationA'))
 AND NOT public.can_access_station((SELECT id FROM ident_ids WHERE k='stationB')));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ident_ids WHERE k='washer'),true);
INSERT INTO ident_results VALUES ('laveur limité aux stations affectées de son entreprise',
 public.can_access_station((SELECT id FROM ident_ids WHERE k='stationA'))
 AND NOT public.can_access_station((SELECT id FROM ident_ids WHERE k='stationB')));
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ident_ids WHERE k='manager'),true);

-- Une exception de test annule toute mutation qui aurait été autorisée ; on
-- observe aussi le refus RLS silencieux (zéro ligne), pas seulement le GRANT.
DO $$ DECLARE n integer; BEGIN
 BEGIN
  UPDATE public.user_profiles SET role_id=(SELECT id FROM public.roles WHERE company_id IS NULL AND key='owner')
   WHERE id=(SELECT id FROM ident_ids WHERE k='manager');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('auto-promotion directe en propriétaire refusée',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('auto-promotion directe en propriétaire refusée',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('auto-promotion directe en propriétaire refusée',false); END;
 BEGIN
  UPDATE public.user_profiles SET active=false WHERE id=(SELECT id FROM ident_ids WHERE k='ownerA');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('désactivation directe du propriétaire refusée',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('désactivation directe du propriétaire refusée',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('désactivation directe du propriétaire refusée',false); END;
 BEGIN
  INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
   SELECT (SELECT id FROM ident_ids WHERE k='unlinked'),(SELECT id FROM ident_ids WHERE k='companyA'),
     'Profil non autorisé','ident-unlinked@test.invalid',id,false FROM public.roles WHERE company_id IS NULL AND key='owner';
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('création directe de profil refusée',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('création directe de profil refusée',false); END;
 BEGIN
  DELETE FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ident_ids WHERE k='washer');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('suppression directe d’affectation refusée',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('suppression directe d’affectation refusée',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('suppression directe d’affectation refusée',false); END;
 BEGIN
  INSERT INTO public.user_invitations(company_id,email,role_id,station_ids,token_hash,invited_by,expires_at)
   SELECT (SELECT id FROM ident_ids WHERE k='companyA'),'ident-forged@test.invalid',id,
     jsonb_build_array((SELECT id FROM ident_ids WHERE k='stationA')),repeat('8',64),
     (SELECT id FROM ident_ids WHERE k='manager'),now()+interval '7 days'
   FROM public.roles WHERE company_id IS NULL AND key='owner';
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('création directe d’invitation refusée',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('création directe d’invitation refusée',false); END;
 BEGIN
  UPDATE public.user_invitations SET accepted_at=now() WHERE id=(SELECT id FROM ident_ids WHERE k='legacy');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('modification directe d’invitation refusée',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('modification directe d’invitation refusée',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('modification directe d’invitation refusée',false); END;
 BEGIN
  PERFORM public.admin_update_user((SELECT id FROM ident_ids WHERE k='ownerA'),NULL,false,NULL);
  INSERT INTO ident_results VALUES('RPC interdit au gérant de désactiver le propriétaire',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('RPC interdit au gérant de désactiver le propriétaire',true); END;
 BEGIN
  PERFORM public.request_subscription_plan('premium');
  INSERT INTO ident_results VALUES('RPC de demande interdite au gérant',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('RPC de demande interdite au gérant',true); END;
END $$;
SELECT public.admin_update_user((SELECT id FROM ident_ids WHERE k='washer'),'cashier',NULL,ARRAY[(SELECT id FROM ident_ids WHERE k='stationA')]);
INSERT INTO ident_results VALUES ('RPC autorisée conserve rôle et affectation du collaborateur',
 (SELECT r.key='cashier' FROM public.user_profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=(SELECT id FROM ident_ids WHERE k='washer'))
 AND (SELECT count(*)=1 FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ident_ids WHERE k='washer') AND station_id=(SELECT id FROM ident_ids WHERE k='stationA')));

-- Défense en profondeur : même si un grant et une policy permissive sont
-- ajoutés plus tard, les policies restrictives doivent empêcher l'écriture.
RESET ROLE;
GRANT INSERT, UPDATE (role_id) ON public.user_profiles TO authenticated;
GRANT DELETE ON public.user_station_assignments TO authenticated;
GRANT UPDATE ON public.user_invitations TO authenticated;
CREATE POLICY ident_extra_permissive ON public.user_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ident_extra_permissive ON public.user_station_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ident_extra_permissive ON public.user_invitations FOR ALL TO authenticated USING (true) WITH CHECK (true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 BEGIN
  UPDATE public.user_profiles SET role_id=(SELECT id FROM public.roles WHERE company_id IS NULL AND key='owner')
   WHERE id=(SELECT id FROM ident_ids WHERE k='manager');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('RLS bloque promotion malgré grant colonne ajouté',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('RLS bloque promotion malgré grant colonne ajouté',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('RLS bloque promotion malgré grant colonne ajouté',false); END;
 BEGIN
  INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id,active)
   SELECT (SELECT id FROM ident_ids WHERE k='unlinked'),(SELECT id FROM ident_ids WHERE k='companyA'),
     'Profil non autorisé','ident-unlinked@test.invalid',id,false FROM public.roles WHERE company_id IS NULL AND key='owner';
  RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('RLS bloque création malgré grant et policy ajoutés',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('RLS bloque création malgré grant et policy ajoutés',false); END;
 BEGIN
  DELETE FROM public.user_station_assignments WHERE user_id=(SELECT id FROM ident_ids WHERE k='washer');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('RLS bloque suppression malgré grant ajouté',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('RLS bloque suppression malgré grant ajouté',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('RLS bloque suppression malgré grant ajouté',false); END;
 BEGIN
  UPDATE public.user_invitations SET accepted_at=now() WHERE id=(SELECT id FROM ident_ids WHERE k='legacy');
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n>0 THEN RAISE EXCEPTION 'mutation autorisée' USING ERRCODE='P0001'; END IF;
  INSERT INTO ident_results VALUES('RLS bloque modification d’invitation malgré grant ajouté',true);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('RLS bloque modification d’invitation malgré grant ajouté',true);
           WHEN raise_exception THEN INSERT INTO ident_results VALUES('RLS bloque modification d’invitation malgré grant ajouté',false); END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
-- Un profil supprimé logiquement ne compte plus dans le quota. Il ne doit pas
-- rester autorisé même si active=true dans une donnée historique ou importée.
UPDATE public.user_profiles SET deleted_at=clock_timestamp() WHERE id=(SELECT id FROM ident_ids WHERE k='manager');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM ident_ids WHERE k='manager'),true);
INSERT INTO ident_results VALUES
 ('profil supprimé sans entreprise courante',public.current_company_id() IS NULL),
 ('profil supprimé sans permission métier',NOT public.has_permission('employees.manage')),
 ('profil supprimé sans portée station',NOT public.can_access_station((SELECT id FROM ident_ids WHERE k='stationA'))),
 ('profil supprimé signalé inactif dans le contexte',NOT (public.my_context()->>'active')::boolean),
 ('profil supprimé ne demande pas une formule',NOT public.has_permission('subscription.manage'));
DO $$ BEGIN
 BEGIN PERFORM public.my_subscription_access();
  INSERT INTO ident_results VALUES('profil supprimé sans accès abonnement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO ident_results VALUES('profil supprimé sans accès abonnement',true); END;
END $$;
RESET ROLE;
SELECT label,ok FROM ident_results ORDER BY label;
ROLLBACK;
