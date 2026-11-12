-- Test d'intégration Prompt 09 — À EXÉCUTER DANS UNE TRANSACTION AVEC ROLLBACK.
-- Aucune donnée persistée : 3 comptes Auth temporaires (2 tenants + 1 super admin),
-- 2 entreprises, 2 stations, 3 fiches de lavage, usage et journal plateforme.
-- Aucun navigateur, aucun fournisseur, aucun e-mail, aucun secret réel.
BEGIN;
CREATE TEMP TABLE p09_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE p09_board (k text PRIMARY KEY, val jsonb) ON COMMIT DROP;
CREATE TEMP TABLE p09_result (label text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON p09_ids, p09_board, p09_result TO authenticated;

INSERT INTO p09_result VALUES
  ('044 appliquee : 44 migrations, 0 fixture metier',
    (SELECT count(*) FROM supabase_migrations.schema_migrations) = 44 AND
    (SELECT count(*) FROM public.customers) = 0 AND
    (SELECT count(*) FROM public.washes) = 0 AND
    (SELECT count(*) FROM public.subscription_usage) = 0 AND
    (SELECT count(*) FROM public.platform_audit_logs) = 0 AND
    (SELECT count(*) FROM auth.users) = 0,
    'etat initial avant fixtures : 44 migrations, 69 tables'),
  ('quota : 3e lavage refuse 23514', false, 'en attente du garde'),
  ('comparaison incomplete refusee 23514', false, 'en attente du garde'),
  ('periode > 92 jours refusee 23514', false, 'en attente du garde'),
  ('back-office refuse au tenant 42501', false, 'en attente du garde');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'p09-a@test.invalid',
   jsonb_build_object('company_name','Tenant P09 A','station_name','Station P09 A','owner_name','Owner P09 A')),
  ('22222222-2222-4222-8222-222222222222', 'p09-b@test.invalid',
   jsonb_build_object('company_name','Tenant P09 B','station_name','Station P09 B','owner_name','Owner P09 B')),
  ('88888888-8888-4888-8888-888888888888', 'p09-admin@test.invalid',
   jsonb_build_object('owner_name','Super admin P09'));

INSERT INTO p09_ids VALUES
  ('userA','11111111-1111-4111-8111-111111111111'),
  ('userB','22222222-2222-4222-8222-222222222222'),
  ('admin','88888888-8888-4888-8888-888888888888'),
  ('catA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('catB','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('washA1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  ('washA2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  ('washA3','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'),
  ('washB1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4');
INSERT INTO p09_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p09_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = '22222222-2222-4222-8222-222222222222';
INSERT INTO p09_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p09_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = '22222222-2222-4222-8222-222222222222';

INSERT INTO public.platform_admins (user_id)
VALUES ((SELECT id FROM p09_ids WHERE k='admin'));

UPDATE public.stations SET activated = true
WHERE id IN (SELECT id FROM p09_ids WHERE k IN ('stA','stB'));

INSERT INTO public.vehicle_categories (id, company_id, station_id, name) VALUES
  ((SELECT id FROM p09_ids WHERE k='catA'), (SELECT id FROM p09_ids WHERE k='coA'),
   (SELECT id FROM p09_ids WHERE k='stA'), 'Berline P09 A'),
  ((SELECT id FROM p09_ids WHERE k='catB'), (SELECT id FROM p09_ids WHERE k='coB'),
   (SELECT id FROM p09_ids WHERE k='stB'), 'Berline P09 B');

SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
SELECT public.admin_save_plan('essai','Essai P09',0,14,true,1,'[]'::jsonb);
SELECT public.admin_set_plan_limit('essai','washes_per_month',2);

SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.washes (id, company_id, station_id, number, customer_name,
  vehicle_category_id, vehicle_label, plate, discount_minor, total_minor, paid_minor, status)
VALUES ((SELECT id FROM p09_ids WHERE k='washA1'), (SELECT id FROM p09_ids WHERE k='coA'),
  (SELECT id FROM p09_ids WHERE k='stA'), 'P09-A1', 'Client A',
  (SELECT id FROM p09_ids WHERE k='catA'), 'Berline P09 A', '0001 AB 01', 0, 5000, 0, 'pending');
INSERT INTO public.washes (id, company_id, station_id, number, customer_name,
  vehicle_category_id, vehicle_label, plate, discount_minor, total_minor, paid_minor, status)
VALUES ((SELECT id FROM p09_ids WHERE k='washA2'), (SELECT id FROM p09_ids WHERE k='coA'),
  (SELECT id FROM p09_ids WHERE k='stA'), 'P09-A2', 'Client A',
  (SELECT id FROM p09_ids WHERE k='catA'), 'Berline P09 A', '0002 AB 01', 0, 5000, 0, 'pending');

DO $$
BEGIN
  INSERT INTO public.washes (id, company_id, station_id, number, customer_name,
    vehicle_category_id, vehicle_label, plate, discount_minor, total_minor, paid_minor, status)
  VALUES ((SELECT id FROM p09_ids WHERE k='washA3'), (SELECT id FROM p09_ids WHERE k='coA'),
    (SELECT id FROM p09_ids WHERE k='stA'), 'P09-A3', 'Client A',
    (SELECT id FROM p09_ids WHERE k='catA'), 'Berline P09 A', '0003 AB 01', 0, 5000, 0, 'pending');
  UPDATE p09_result SET ok = false, detail = 'le garde n a pas refuse le 3e lavage'
    WHERE label = 'quota : 3e lavage refuse 23514';
EXCEPTION WHEN SQLSTATE '23514' THEN
  UPDATE p09_result SET ok = true, detail = '23514 : quota washes_per_month atteint'
    WHERE label = 'quota : 3e lavage refuse 23514';
END $$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
INSERT INTO public.washes (id, company_id, station_id, number, customer_name,
  vehicle_category_id, vehicle_label, plate, discount_minor, total_minor, paid_minor, status)
VALUES ((SELECT id FROM p09_ids WHERE k='washB1'), (SELECT id FROM p09_ids WHERE k='coB'),
  (SELECT id FROM p09_ids WHERE k='stB'), 'P09-B1', 'Client B',
  (SELECT id FROM p09_ids WHERE k='catB'), 'Berline P09 B', '0001 BC 01', 0, 5000, 0, 'pending');

SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO p09_board SELECT 'analyticsA', public.my_analytics_board(
  (date_trunc('month', now()))::date,
  current_date,
  (date_trunc('month', now()) - interval '1 month')::date,
  (date_trunc('month', now()) - interval '1 day')::date
);
INSERT INTO p09_board SELECT 'usageA', public.my_subscription_usage((date_trunc('month', now()))::date);
INSERT INTO p09_board SELECT 'limitA', jsonb_build_object('value',
  public.current_plan_limit((SELECT id FROM p09_ids WHERE k='coA'), 'washes_per_month'));

DO $$
BEGIN
  PERFORM public.my_analytics_board(current_date, current_date, current_date, NULL);
  UPDATE p09_result SET ok = false, detail = 'comparaison incomplete acceptee'
    WHERE label = 'comparaison incomplete refusee 23514';
EXCEPTION WHEN SQLSTATE '23514' THEN
  UPDATE p09_result SET ok = true, detail = '23514 : deux dates de comparaison requises'
    WHERE label = 'comparaison incomplete refusee 23514';
END $$;

DO $$
BEGIN
  PERFORM public.my_analytics_board(current_date - 100, current_date);
  UPDATE p09_result SET ok = false, detail = 'periode de 100 jours acceptee'
    WHERE label = 'periode > 92 jours refusee 23514';
EXCEPTION WHEN SQLSTATE '23514' THEN
  UPDATE p09_result SET ok = true, detail = '23514 : 92 jours maximum'
    WHERE label = 'periode > 92 jours refusee 23514';
END $$;

DO $$
BEGIN
  PERFORM public.my_platform_board();
  UPDATE p09_result SET ok = false, detail = 'tenant a lu le back-office'
    WHERE label = 'back-office refuse au tenant 42501';
EXCEPTION WHEN SQLSTATE '42501' THEN
  UPDATE p09_result SET ok = true, detail = '42501 : super admin uniquement'
    WHERE label = 'back-office refuse au tenant 42501';
END $$;

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
INSERT INTO p09_board SELECT 'analyticsB', public.my_analytics_board(
  (date_trunc('month', now()))::date, current_date
);

SELECT set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
SELECT public.refresh_subscription_usage((date_trunc('month', now()))::date);
SELECT public.admin_set_company_subscription((SELECT id FROM p09_ids WHERE k='coA'), 'standard', 'active');
SELECT public.admin_set_company_suspended((SELECT id FROM p09_ids WHERE k='coA'), true);
INSERT INTO p09_board SELECT 'platform', public.my_platform_board();

INSERT INTO p09_result VALUES
  ('P09 : 48 permissions, 112 liaisons, 2 vues, 69 tables',
    (SELECT count(*) FROM public.permissions) = 48 AND
    (SELECT count(*) FROM public.role_permissions) = 112 AND
    (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN
      ('v_station_daily_activity','v_company_quota_usage')) = 2 AND
    (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
      AND table_type='BASE TABLE') = 69,
    '039-044 : fondation additive, aucun table supplementaire'),
  ('P09 : 12 RPC SECURITY DEFINER, 8 exposees, 0 grant anon, 3 triggers',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('current_plan_limit','subscription_usage_snapshot','assert_subscription_limit',
         'enforce_subscription_limit','refresh_subscription_usage','my_analytics_board',
         'my_subscription_usage','my_platform_board','admin_save_plan',
         'admin_set_plan_limit','admin_set_company_subscription',
         'admin_set_company_suspended') AND p.prosecdef) = 12 AND
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('refresh_subscription_usage','my_analytics_board','my_subscription_usage',
         'my_platform_board','admin_save_plan','admin_set_plan_limit',
         'admin_set_company_subscription','admin_set_company_suspended')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 8 AND
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('current_plan_limit','subscription_usage_snapshot','assert_subscription_limit',
         'enforce_subscription_limit','refresh_subscription_usage','my_analytics_board',
         'my_subscription_usage','my_platform_board','admin_save_plan',
         'admin_set_plan_limit','admin_set_company_subscription',
         'admin_set_company_suspended')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 0 AND
    (SELECT count(*) FROM pg_trigger WHERE tgname IN
      ('trg_quota_stations','trg_quota_profiles','trg_quota_washes')) = 3,
    '4 helpers internes revoques, 8 RPC utilisateur'),
  ('P09 : ecritures directes revokées sur plans, limites, abonnements, usage',
    NOT has_table_privilege('authenticated','public.plans','INSERT') AND
    NOT has_table_privilege('authenticated','public.plan_limits','UPDATE') AND
    NOT has_table_privilege('authenticated','public.subscriptions','DELETE') AND
    NOT has_table_privilege('authenticated','public.subscription_usage','INSERT') AND
    NOT has_table_privilege('authenticated','public.companies','UPDATE') AND
    NOT has_table_privilege('authenticated','public.platform_audit_logs','INSERT'),
    '043 : seules les RPC admin ecrivent'),
  ('vues en security_invoker, aucun SELECT anon',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
        ('v_station_daily_activity','v_company_quota_usage')
      AND c.reloptions::text LIKE '%security_invoker=true%') = 2 AND
    NOT has_table_privilege('anon','public.v_station_daily_activity','SELECT') AND
    NOT has_table_privilege('anon','public.v_company_quota_usage','SELECT'),
    'RLS de l appelant conservee'),
  ('admin_save_plan : formule essai administrable, prix hypothèse conserve',
    (SELECT name FROM public.plans WHERE id='essai') = 'Essai P09' AND
    (SELECT price_monthly_minor FROM public.plans WHERE id='essai') = 0 AND
    (SELECT count(*) FROM public.platform_audit_logs WHERE action='plan.saved') = 1,
    '0 FCFA reste une hypothese commerciale'),
  ('admin_set_plan_limit : quota essai fixe a 2 lavages/mois',
    (SELECT value_int FROM public.plan_limits WHERE plan_id='essai' AND key='washes_per_month') = 2 AND
    (SELECT count(*) FROM public.platform_audit_logs WHERE action='plan.limit') = 1,
    'limite lue cote serveur'),
  ('quota : 2 lavages A autorises',
    (SELECT count(*) FROM public.washes w WHERE w.company_id=(SELECT id FROM p09_ids WHERE k='coA')
      AND w.status <> 'cancelled') = 2,
    '2 x 5000 = 10000'),
  ('quota : 1 lavage B autorise, aucune fiche A chez B',
    (SELECT count(*) FROM public.washes w WHERE w.company_id=(SELECT id FROM p09_ids WHERE k='coB')) = 1 AND
    (SELECT count(*) FROM public.washes w WHERE w.company_id=(SELECT id FROM p09_ids WHERE k='coB')
      AND w.customer_name='Client A') = 0,
    'isolation A/B des fiches'),
  ('vue v_company_quota_usage : A=2, B=1',
    (SELECT washes_month_used FROM public.v_company_quota_usage
      WHERE company_id=(SELECT id FROM p09_ids WHERE k='coA')) = 2 AND
    (SELECT washes_month_used FROM public.v_company_quota_usage
      WHERE company_id=(SELECT id FROM p09_ids WHERE k='coB')) = 1,
    'agregation securisee'),
  ('current_plan_limit A = 2 cote serveur avant changement de formule',
    ((SELECT val FROM p09_board WHERE k='limitA')->>'value') = '2',
    'aucune limite envoyee par le navigateur'),
  ('refresh_subscription_usage : 6 lignes derivees des donnees reelles',
    (SELECT count(*) FROM public.subscription_usage) = 6 AND
    (SELECT count(*) FROM public.subscription_usage u
      WHERE u.company_id=(SELECT id FROM p09_ids WHERE k='coA')
        AND u.metric_key='washes' AND u.value_int=2) = 1 AND
    (SELECT count(*) FROM public.subscription_usage u
      WHERE u.company_id=(SELECT id FROM p09_ids WHERE k='coB')
        AND u.metric_key='washes' AND u.value_int=1) = 1,
    '044 : correctif du snapshot employes'),
  ('my_subscription_usage A : limites et usage reels',
    ((SELECT val FROM p09_board WHERE k='usageA')->'limits'->>'washesPerMonth') = '2' AND
    ((SELECT val FROM p09_board WHERE k='usageA')->'usage'->>'washes') = '2' AND
    ((SELECT val FROM p09_board WHERE k='usageA')->'usage'->>'stations') = '1',
    'lecture tenant, aucun company_id'),
  ('analytics A : CA 10000, 1 station, definitions P07 partagees',
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'period'->>'revenue') = '10000' AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'stats'->>'stations') = '1' AND
    jsonb_array_length((SELECT val FROM p09_board WHERE k='analyticsA')->'stations') = 1 AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'definitions'->>'partialBalance')
      LIKE '%Solde partiel%',
    'my_profitability reste la source unique'),
  ('analytics A : station A, CA 10000, aucun resultat net par station',
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'stations'->0->>'stationId') =
      (SELECT id FROM p09_ids WHERE k='stA')::text AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'stations'->0->>'revenue') = '10000' AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'stations'->0->>'grossMargin') IS NULL AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'stations'->0->>'result') IS NULL AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'stations'->0->>'certified') = 'false',
    'classement par CA, jamais par benefice net'),
  ('analytics A : periode non certifiee, costsMissing=true',
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'period'->>'certified') = 'false' AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'period'->>'costsMissing') = 'true' AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'period'->>'grossMargin') IS NULL AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'period'->>'result') IS NULL,
    'aucun faux benefice net'),
  ('analytics A : comparaison mois precedent 0, delta 10000',
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'compare'->>'revenue') = '0' AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->>'compareDelta') = '10000' AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'compare'->'definitions'->>'partialBalance')
      LIKE '%Solde partiel%',
    'memes definitions metier'),
  ('analytics A : tendance quotidienne et regle de certification',
    jsonb_array_length((SELECT val FROM p09_board WHERE k='analyticsA')->'trend') =
      (current_date - (date_trunc('month', now()))::date + 1) AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'rules'->>'netResult')
      LIKE '%Aucun resultat net%',
    'points calendaires a zero, aucune donnee fabriquee'),
  ('analytics A : classement et aucun company_id dans la reponse',
    jsonb_array_length((SELECT val FROM p09_board WHERE k='analyticsA')->'rankings') = 1 AND
    ((SELECT val FROM p09_board WHERE k='analyticsA')->'rankings'->0->>'rank') = '1' AND
    NOT ((SELECT val FROM p09_board WHERE k='analyticsA')::text LIKE '%company_id%'),
    'projection camelCase sans tenant brut'),
  ('analytics B : CA 5000, station B, aucune donnee de A',
    ((SELECT val FROM p09_board WHERE k='analyticsB')->'period'->>'revenue') = '5000' AND
    ((SELECT val FROM p09_board WHERE k='analyticsB')->'stations'->0->>'stationId') =
      (SELECT id FROM p09_ids WHERE k='stB')::text AND
    NOT ((SELECT val FROM p09_board WHERE k='analyticsB')::text LIKE
      '%' || (SELECT id FROM p09_ids WHERE k='stA')::text || '%') AND
    NOT ((SELECT val FROM p09_board WHERE k='analyticsB')::text LIKE '%Client A%'),
    'isolation A/B du board analytics'),
  ('my_platform_board admin : 2 entreprises, 3 formules, 9 limites',
    jsonb_array_length((SELECT val FROM p09_board WHERE k='platform')->'companies') = 2 AND
    ((SELECT val FROM p09_board WHERE k='platform')->'stats'->>'plans') = '3' AND
    ((SELECT val FROM p09_board WHERE k='platform')->'stats'->>'planLimits') = '9',
    'back-office super admin'),
  ('my_platform_board admin : usage, audit, stats, aucun company_id',
    ((SELECT val FROM p09_board WHERE k='platform')->'stats'->>'usageRows')::integer >= 6 AND
    ((SELECT val FROM p09_board WHERE k='platform')->'stats'->>'auditLogs')::integer >= 4 AND
    ((SELECT val FROM p09_board WHERE k='platform')->'stats'->>'suspendedCompanies') = '1' AND
    ((SELECT val FROM p09_board WHERE k='platform')->'stats'->>'quotasExceeded') = '0' AND
    NOT ((SELECT val FROM p09_board WHERE k='platform')::text LIKE '%company_id%'),
    'journal hors tenant, limites respectees'),
  ('admin_set_company_subscription : coA passe a standard/active',
    (SELECT plan_id FROM public.subscriptions WHERE company_id=(SELECT id FROM p09_ids WHERE k='coA')) = 'standard' AND
    (SELECT status FROM public.subscriptions WHERE company_id=(SELECT id FROM p09_ids WHERE k='coA')) = 'active' AND
    EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT val FROM p09_board WHERE k='platform')->'companies') x
      WHERE x->>'companyId' = (SELECT id FROM p09_ids WHERE k='coA')::text
        AND x->>'planId' = 'standard'),
    'abonnement administrable'),
  ('admin_set_company_suspended : coA suspendue sans suppression',
    (SELECT suspended FROM public.companies WHERE id=(SELECT id FROM p09_ids WHERE k='coA')) = true AND
    EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT val FROM p09_board WHERE k='platform')->'companies') x
      WHERE x->>'companyId' = (SELECT id FROM p09_ids WHERE k='coA')::text
        AND x->>'suspended' = 'true') AND
    (SELECT count(*) FROM public.companies) = 2,
    'acces coupe, donnees conservees'),
  ('journal plateforme : 4 actions, acteur = super admin',
    (SELECT count(*) FROM public.platform_audit_logs) >= 4 AND
    (SELECT count(*) FROM public.platform_audit_logs WHERE action IN
      ('plan.saved','plan.limit','company.subscription','company.suspension')) = 4 AND
    (SELECT count(*) FROM public.platform_audit_logs
      WHERE actor_user_id=(SELECT id FROM p09_ids WHERE k='admin')) >= 4,
    'audit append-only hors tenant'),
  ('regles du back-office : tarifs hypotheses commerciales',
    ((SELECT val FROM p09_board WHERE k='platform')->'rules'->>'pricing')
      LIKE '%hypotheses commerciales%' AND
    ((SELECT val FROM p09_board WHERE k='platform')->'rules'->>'quotas')
      LIKE '%cote serveur%',
    '0 / 15000 / 35000 FCFA administrables');

SELECT label, ok, detail FROM p09_result ORDER BY ok, label;
ROLLBACK;
