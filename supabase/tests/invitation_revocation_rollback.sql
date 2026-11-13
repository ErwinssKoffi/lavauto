-- Révocation d'une invitation liée à un compte : base isolée uniquement.
-- Auth et les rôles sont simulés ; aucune connexion ni e-mail réel.
BEGIN;
CREATE TEMP TABLE rev_ids(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE rev_results(label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON rev_ids, rev_results TO anon, authenticated, service_role;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','rev-owner-a@test.invalid',
  '{"company_name":"Révocation A","station_name":"Station A","owner_name":"Owner A"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','rev-owner-b@test.invalid',
  '{"company_name":"Révocation B","station_name":"Station B","owner_name":"Owner B"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','rev-manager@test.invalid','{"invitation":true}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','rev-legacy@test.invalid','{"invitation":true}');
INSERT INTO rev_ids VALUES
 ('ownerA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),('ownerB','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
 ('manager','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),('invited1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'),
 ('invited2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),('invited3','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),
 ('legacyUser','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7');
INSERT INTO rev_ids SELECT 'companyA',company_id FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='ownerA');
INSERT INTO rev_ids SELECT 'stationA',station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM rev_ids WHERE k='ownerA');
INSERT INTO rev_ids SELECT 'companyB',company_id FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='ownerB');
UPDATE public.plan_limits SET value_int=10 WHERE plan_id='essai' AND key='employees';
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id)
 SELECT (SELECT id FROM rev_ids WHERE k='manager'),(SELECT id FROM rev_ids WHERE k='companyA'),
   'Gérant A','rev-manager@test.invalid',id FROM public.roles WHERE company_id IS NULL AND key='manager';
INSERT INTO public.user_profiles(id,company_id,full_name,email,role_id)
 SELECT (SELECT id FROM rev_ids WHERE k='legacyUser'),(SELECT id FROM rev_ids WHERE k='companyA'),
   'Profil historique','rev-legacy@test.invalid',id FROM public.roles WHERE company_id IS NULL AND key='washer';
INSERT INTO public.user_station_assignments(company_id,user_id,station_id)
 VALUES ((SELECT id FROM rev_ids WHERE k='companyA'),(SELECT id FROM rev_ids WHERE k='manager'),(SELECT id FROM rev_ids WHERE k='stationA')),
        ((SELECT id FROM rev_ids WHERE k='companyA'),(SELECT id FROM rev_ids WHERE k='legacyUser'),(SELECT id FROM rev_ids WHERE k='stationA'));
-- Invitation historique sans association fiable à un profil : elle ne doit
-- jamais être annoncée révoquée en laissant un compte potentiellement actif.
INSERT INTO public.user_invitations(company_id,email,role_id,station_ids,token_hash,invited_by,expires_at)
 SELECT (SELECT id FROM rev_ids WHERE k='companyA'),'rev-legacy@test.invalid',id,
  jsonb_build_array((SELECT id FROM rev_ids WHERE k='stationA')),repeat('9',64),
  (SELECT id FROM rev_ids WHERE k='ownerA'),now()+interval '7 days'
 FROM public.roles WHERE company_id IS NULL AND key='washer';
INSERT INTO rev_ids SELECT 'legacy',id FROM public.user_invitations WHERE email='rev-legacy@test.invalid';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
INSERT INTO rev_ids SELECT 'reserve1',public.reserve_user_invitation('rev-invited1@test.invalid','Invité Un','','cashier',ARRAY[(SELECT id FROM rev_ids WHERE k='stationA')]);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,raw_user_meta_data)
 VALUES ((SELECT id FROM rev_ids WHERE k='invited1'),'rev-invited1@test.invalid',
  jsonb_build_object('invitation',true,'invitation_reservation_id',(SELECT id::text FROM rev_ids WHERE k='reserve1')));
SET LOCAL ROLE service_role;
INSERT INTO rev_ids SELECT 'invitation1',(public.finalize_user_invitation((SELECT id FROM rev_ids WHERE k='reserve1'),(SELECT id FROM rev_ids WHERE k='invited1'),repeat('1',64))->>'invitationId')::uuid;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='invited1'),true);
INSERT INTO rev_results VALUES ('invité actif avant révocation',
 public.current_company_id()=(SELECT id FROM rev_ids WHERE k='companyA')
 AND public.has_permission('washes.view') AND (public.my_context()->>'active')::boolean);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation1'));
  INSERT INTO rev_results VALUES('collaborateur sans permission ne révoque pas',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO rev_results VALUES('collaborateur sans permission ne révoque pas',true); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerB'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation1'));
  INSERT INTO rev_results VALUES('autre entreprise ne révoque pas',false);
 EXCEPTION WHEN no_data_found OR insufficient_privilege THEN INSERT INTO rev_results VALUES('autre entreprise ne révoque pas',true); END;
END $$;
RESET ROLE;
-- Une permission d'inviter seule ne doit pas permettre de désactiver un compte.
DELETE FROM public.role_permissions WHERE permission_id='employees.disable'
 AND role_id=(SELECT id FROM public.roles WHERE company_id IS NULL AND key='manager');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='manager'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation1'));
  RAISE EXCEPTION 'révocation autorisée' USING ERRCODE='P0001';
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO rev_results VALUES('révocation exige aussi employees.disable',true);
           WHEN raise_exception THEN INSERT INTO rev_results VALUES('révocation exige aussi employees.disable',false); END;
END $$;
RESET ROLE;
INSERT INTO public.role_permissions(role_id,permission_id)
 SELECT id,'employees.disable' FROM public.roles WHERE company_id IS NULL AND key='manager';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='legacy'));
  RAISE EXCEPTION 'révocation historique autorisée' USING ERRCODE='P0001';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO rev_results VALUES('invitation historique non liée nécessite rapprochement',true);
           WHEN raise_exception THEN INSERT INTO rev_results VALUES('invitation historique non liée nécessite rapprochement',false); END;
END $$;
INSERT INTO rev_results VALUES ('invitation historique et profil conservés pour rapprochement',
 (SELECT revoked_at IS NULL FROM public.user_invitations WHERE id=(SELECT id FROM rev_ids WHERE k='legacy'))
 AND (SELECT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='legacyUser')));
INSERT INTO rev_results VALUES ('réservations finalisées comptées avant révocation',
 (public.my_subscription_usage()->'usage'->>'employees')::integer=4);
SELECT public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation1'));
INSERT INTO rev_results VALUES ('révocation désactive le profil et marque l’invitation ensemble',
 (SELECT revoked_at IS NOT NULL AND accepted_at IS NULL FROM public.user_invitations WHERE id=(SELECT id FROM rev_ids WHERE k='invitation1'))
 AND (SELECT NOT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='invited1')));
INSERT INTO rev_results VALUES ('révocation libère le quota de profil actif',
 (public.my_subscription_usage()->'usage'->>'employees')::integer=3);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation1'));
  INSERT INTO rev_results VALUES('rejeu après réponse perdue reste sûr',true);
 EXCEPTION WHEN no_data_found THEN INSERT INTO rev_results VALUES('rejeu après réponse perdue reste sûr',false); END;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='invited1'),true);
INSERT INTO rev_results VALUES ('compte révoqué sans entreprise ni permission',
 public.current_company_id() IS NULL AND NOT public.has_permission('washes.view')
 AND NOT public.can_access_station((SELECT id FROM rev_ids WHERE k='stationA'))
 AND NOT (public.my_context()->>'active')::boolean);
DO $$ BEGIN
 BEGIN PERFORM public.my_subscription_access();
  INSERT INTO rev_results VALUES('compte révoqué sans lecture abonnement',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO rev_results VALUES('compte révoqué sans lecture abonnement',true); END;
END $$;
SELECT public.accept_my_invitations();
RESET ROLE;
INSERT INTO rev_results VALUES ('révocation ne prétend pas supprimer le compte Auth',
 EXISTS (SELECT 1 FROM auth.users WHERE id=(SELECT id FROM rev_ids WHERE k='invited1'))
 AND (SELECT accepted_at IS NULL AND revoked_at IS NOT NULL FROM public.user_invitations WHERE id=(SELECT id FROM rev_ids WHERE k='invitation1')));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
-- Une réactivation explicite redonne potentiellement accès au compte Auth. Un
-- ancien rejeu de révocation ne doit pas annuler silencieusement cette décision.
SELECT public.admin_update_user((SELECT id FROM rev_ids WHERE k='invited1'),NULL,true,NULL);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation1'));
  INSERT INTO rev_results VALUES('rejeu ne désactive pas un compte réactivé depuis',false);
 EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO rev_results VALUES('rejeu ne désactive pas un compte réactivé depuis',true); END;
END $$;
INSERT INTO rev_results VALUES ('compte réactivé reste actif après rejeu',
 (SELECT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='invited1')));
SELECT public.admin_update_user((SELECT id FROM rev_ids WHERE k='invited1'),NULL,false,NULL);

-- Défense contre une association administrativement corrompue : la révocation
-- ne doit jamais désactiver le propriétaire ou le profil d'un autre tenant.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO public.user_invitations(company_id,email,role_id,station_ids,token_hash,invited_by,expires_at)
 SELECT (SELECT id FROM rev_ids WHERE k='companyA'),x.email,r.id,
   jsonb_build_array((SELECT id FROM rev_ids WHERE k='stationA')),x.hash,
   (SELECT id FROM rev_ids WHERE k='manager'),now()+interval '7 days'
 FROM public.roles r CROSS JOIN (VALUES ('rev-protected@test.invalid',repeat('a',64)),('rev-other@test.invalid',repeat('b',64))) AS x(email,hash)
 WHERE r.company_id IS NULL AND r.key='washer';
INSERT INTO rev_ids SELECT 'protected',id FROM public.user_invitations WHERE email='rev-protected@test.invalid';
INSERT INTO rev_ids SELECT 'other',id FROM public.user_invitations WHERE email='rev-other@test.invalid';
INSERT INTO public.invitation_reservations(company_id,requested_by,email,full_name,role_id,station_ids,status,auth_user_id,invitation_id)
 SELECT (SELECT id FROM rev_ids WHERE k='companyA'),(SELECT id FROM rev_ids WHERE k='manager'),x.email,'Association de test',r.id,
   ARRAY[(SELECT id FROM rev_ids WHERE k='stationA')],'finalized',x.user_id,x.invitation_id
 FROM public.roles r CROSS JOIN (VALUES
   ('rev-protected@test.invalid',(SELECT id FROM rev_ids WHERE k='ownerA'),(SELECT id FROM rev_ids WHERE k='protected')),
   ('rev-other@test.invalid',(SELECT id FROM rev_ids WHERE k='ownerB'),(SELECT id FROM rev_ids WHERE k='other'))
 ) AS x(email,user_id,invitation_id) WHERE r.company_id IS NULL AND r.key='washer';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='manager'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='protected'));
  INSERT INTO rev_results VALUES('association corrompue ne désactive pas le propriétaire',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO rev_results VALUES('association corrompue ne désactive pas le propriétaire',true); END;
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='other'));
  INSERT INTO rev_results VALUES('association corrompue ne désactive pas un autre tenant',false);
 EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO rev_results VALUES('association corrompue ne désactive pas un autre tenant',true); END;
END $$;
RESET ROLE;
INSERT INTO rev_results VALUES ('associations corrompues ne modifient aucun des deux comptes',
 (SELECT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='ownerA'))
 AND (SELECT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='ownerB'))
 AND (SELECT bool_and(revoked_at IS NULL) FROM public.user_invitations WHERE id IN
   ((SELECT id FROM rev_ids WHERE k='protected'),(SELECT id FROM rev_ids WHERE k='other'))));

-- Si l'acceptation a gagné la course, elle n'est pas révoquée comme une
-- invitation en attente. La gestion du compte passe par admin_update_user.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
INSERT INTO rev_ids SELECT 'reserve2',public.reserve_user_invitation('rev-invited2@test.invalid','Invité Deux','','washer',ARRAY[(SELECT id FROM rev_ids WHERE k='stationA')]);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,raw_user_meta_data)
 VALUES ((SELECT id FROM rev_ids WHERE k='invited2'),'rev-invited2@test.invalid',
  jsonb_build_object('invitation',true,'invitation_reservation_id',(SELECT id::text FROM rev_ids WHERE k='reserve2')));
SET LOCAL ROLE service_role;
INSERT INTO rev_ids SELECT 'invitation2',(public.finalize_user_invitation((SELECT id FROM rev_ids WHERE k='reserve2'),(SELECT id FROM rev_ids WHERE k='invited2'),repeat('2',64))->>'invitationId')::uuid;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='invited2'),true);
SELECT public.accept_my_invitations();
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation2'));
  INSERT INTO rev_results VALUES('acceptation préalable empêche révocation en attente',false);
 EXCEPTION WHEN no_data_found OR object_not_in_prerequisite_state THEN INSERT INTO rev_results VALUES('acceptation préalable empêche révocation en attente',true); END;
END $$;
INSERT INTO rev_results VALUES ('acceptation préalable conserve le compte actif',
 (SELECT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='invited2'))
 AND (SELECT accepted_at IS NOT NULL AND revoked_at IS NULL FROM public.user_invitations WHERE id=(SELECT id FROM rev_ids WHERE k='invitation2')));

-- La lecture seule ne donne pas d'exception implicite à la révocation.
INSERT INTO rev_ids SELECT 'reserve3',public.reserve_user_invitation('rev-invited3@test.invalid','Invité Trois','','washer',ARRAY[(SELECT id FROM rev_ids WHERE k='stationA')]);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,raw_user_meta_data)
 VALUES ((SELECT id FROM rev_ids WHERE k='invited3'),'rev-invited3@test.invalid',
  jsonb_build_object('invitation',true,'invitation_reservation_id',(SELECT id::text FROM rev_ids WHERE k='reserve3')));
SET LOCAL ROLE service_role;
INSERT INTO rev_ids SELECT 'invitation3',(public.finalize_user_invitation((SELECT id FROM rev_ids WHERE k='reserve3'),(SELECT id FROM rev_ids WHERE k='invited3'),repeat('3',64))->>'invitationId')::uuid;
RESET ROLE;
INSERT INTO public.platform_admins(user_id) VALUES ((SELECT id FROM rev_ids WHERE k='invited3'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation3'));
  INSERT INTO rev_results VALUES('révocation ne désactive pas un administrateur plateforme',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO rev_results VALUES('révocation ne désactive pas un administrateur plateforme',true); END;
END $$;
RESET ROLE;
DELETE FROM public.platform_admins WHERE user_id=(SELECT id FROM rev_ids WHERE k='invited3');
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.subscriptions SET trial_ends_at=clock_timestamp()-interval '1 second' WHERE company_id=(SELECT id FROM rev_ids WHERE k='companyA');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM rev_ids WHERE k='ownerA'),true);
DO $$ BEGIN
 BEGIN PERFORM public.revoke_invitation((SELECT id FROM rev_ids WHERE k='invitation3'));
  INSERT INTO rev_results VALUES('révocation refusée après expiration',false);
 EXCEPTION WHEN insufficient_privilege THEN INSERT INTO rev_results VALUES('révocation refusée après expiration',true); END;
END $$;
INSERT INTO rev_results VALUES ('expiration ne produit aucune révocation partielle',
 (SELECT revoked_at IS NULL FROM public.user_invitations WHERE id=(SELECT id FROM rev_ids WHERE k='invitation3'))
 AND (SELECT active FROM public.user_profiles WHERE id=(SELECT id FROM rev_ids WHERE k='invited3')));
RESET ROLE;
SELECT label,ok FROM rev_results ORDER BY label;
ROLLBACK;
