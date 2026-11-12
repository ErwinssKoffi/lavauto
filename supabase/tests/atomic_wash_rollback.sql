-- Tests de la migration 052, à exécuter après 001–052 dans une base de test.
-- Fixtures Auth et écritures métier annulées par ROLLBACK. Les cas de réponse
-- réseau perdue sont testés côté client ; ce fichier vérifie les règles SQL.
BEGIN;
CREATE TEMP TABLE aw_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE aw_payloads (k text PRIMARY KEY, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE aw_results (label text, ok boolean) ON COMMIT DROP;
GRANT ALL ON aw_ids, aw_payloads, aw_results TO authenticated, anon;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'atomic-owner-a@test.invalid',
    jsonb_build_object('company_name','Atomic A','station_name','Station A','owner_name','Owner A')),
  ('22222222-2222-4222-8222-222222222222', 'atomic-owner-b@test.invalid',
    jsonb_build_object('company_name','Atomic B','station_name','Station B','owner_name','Owner B')),
  ('33333333-3333-4333-8333-333333333333', 'atomic-no-pay@test.invalid', jsonb_build_object('invitation',true)),
  ('44444444-4444-4444-8444-444444444444', 'atomic-other@test.invalid', jsonb_build_object('invitation',true));
INSERT INTO aw_ids VALUES
  ('ownerA','11111111-1111-4111-8111-111111111111'),
  ('ownerB','22222222-2222-4222-8222-222222222222'),
  ('noPay','33333333-3333-4333-8333-333333333333'),
  ('other','44444444-4444-4444-8444-444444444444'),
  ('catA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('srvA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('catB','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  ('srvB','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  ('stA2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
INSERT INTO aw_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id=(SELECT id FROM aw_ids WHERE k='ownerA');
INSERT INTO aw_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id=(SELECT id FROM aw_ids WHERE k='ownerB');
INSERT INTO aw_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM aw_ids WHERE k='ownerA');
INSERT INTO aw_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id=(SELECT id FROM aw_ids WHERE k='ownerB');
UPDATE public.subscriptions SET plan_id='premium' WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA');
UPDATE public.stations SET activated=true WHERE id IN (SELECT id FROM aw_ids WHERE k IN ('stA','stB'));
INSERT INTO public.stations (id, company_id, name, activated)
VALUES ((SELECT id FROM aw_ids WHERE k='stA2'), (SELECT id FROM aw_ids WHERE k='coA'), 'Station A2', true);
INSERT INTO public.roles (company_id, key, label_fr)
VALUES ((SELECT id FROM aw_ids WHERE k='coA'), 'atomic_no_pay', 'Création sans paiement'),
       ((SELECT id FROM aw_ids WHERE k='coA'), 'atomic_other', 'Créateur avec paiement');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT id, 'washes.create' FROM public.roles WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA') AND key IN ('atomic_no_pay','atomic_other');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT id, p FROM public.roles CROSS JOIN (VALUES ('washes.assign'), ('payments.create')) AS perms(p)
WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA') AND key='atomic_other';
INSERT INTO public.user_profiles (id, company_id, full_name, email, role_id)
VALUES ((SELECT id FROM aw_ids WHERE k='noPay'), (SELECT id FROM aw_ids WHERE k='coA'), 'Sans paiement', 'atomic-no-pay@test.invalid',
        (SELECT id FROM public.roles WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA') AND key='atomic_no_pay')),
       ((SELECT id FROM aw_ids WHERE k='other'), (SELECT id FROM aw_ids WHERE k='coA'), 'Autre utilisateur', 'atomic-other@test.invalid',
        (SELECT id FROM public.roles WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA') AND key='atomic_other'));
INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
SELECT (SELECT id FROM aw_ids WHERE k='coA'), id, (SELECT id FROM aw_ids WHERE k='stA') FROM aw_ids WHERE k IN ('noPay','other');
INSERT INTO public.vehicle_categories (id, company_id, station_id, name) VALUES
  ((SELECT id FROM aw_ids WHERE k='catA'),(SELECT id FROM aw_ids WHERE k='coA'),(SELECT id FROM aw_ids WHERE k='stA'),'Berline A'),
  ((SELECT id FROM aw_ids WHERE k='catB'),(SELECT id FROM aw_ids WHERE k='coB'),(SELECT id FROM aw_ids WHERE k='stB'),'Berline B');
INSERT INTO public.services (id, company_id, station_id, name) VALUES
  ((SELECT id FROM aw_ids WHERE k='srvA'),(SELECT id FROM aw_ids WHERE k='coA'),(SELECT id FROM aw_ids WHERE k='stA'),'Lavage A'),
  ((SELECT id FROM aw_ids WHERE k='srvB'),(SELECT id FROM aw_ids WHERE k='coB'),(SELECT id FROM aw_ids WHERE k='stB'),'Lavage B');
INSERT INTO public.service_prices (company_id, station_id, service_id, vehicle_category_id, price_minor) VALUES
  ((SELECT id FROM aw_ids WHERE k='coA'),(SELECT id FROM aw_ids WHERE k='stA'),(SELECT id FROM aw_ids WHERE k='srvA'),(SELECT id FROM aw_ids WHERE k='catA'),3000),
  ((SELECT id FROM aw_ids WHERE k='coB'),(SELECT id FROM aw_ids WHERE k='stB'),(SELECT id FROM aw_ids WHERE k='srvB'),(SELECT id FROM aw_ids WHERE k='catB'),3000);
INSERT INTO aw_payloads VALUES ('baseA', jsonb_build_object(
  'station_id',(SELECT id FROM aw_ids WHERE k='stA'), 'category_id',(SELECT id FROM aw_ids WHERE k='catA'),
  'plate','1111 AA 01','customer_id',NULL,'customer_name','Client test','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId',(SELECT id FROM aw_ids WHERE k='srvA'),'qty',1)),
  'employee_ids',jsonb_build_array((SELECT id FROM aw_ids WHERE k='ownerA')), 'post_id',NULL,
  'idempotency_key','ui-atomic-cash-0001','initial_payment',jsonb_build_object('amount_minor',1000,'method_key','cash')));

INSERT INTO aw_results VALUES
  ('grants : RPC authenticated seulement',
    has_function_privilege('authenticated','public.create_wash_atomic(jsonb)','EXECUTE')
    AND NOT has_function_privilege('anon','public.create_wash_atomic(jsonb)','EXECUTE')),
  ('réservations : RLS et aucun accès direct',
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.wash_creation_requests'::regclass)
    AND NOT has_table_privilege('anon','public.wash_creation_requests','SELECT')
    AND NOT has_table_privilege('authenticated','public.wash_creation_requests','SELECT')
    AND NOT has_table_privilege('authenticated','public.wash_creation_requests','INSERT')),
  ('helper de moyen de paiement : non exposé directement',
    NOT has_function_privilege('anon','public.ensure_payment_method(uuid,uuid,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.ensure_payment_method(uuid,uuid,text)','EXECUTE'));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM aw_ids WHERE k='ownerA'),true);
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('caisse fermée : paiement refusé',false);
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO aw_results VALUES ('caisse fermée : paiement refusé',true);
  END;
END $$;
RESET ROLE;
INSERT INTO aw_results VALUES ('caisse fermée : rollback fiche, véhicule, affectation, journal et réservation',
  NOT EXISTS (SELECT 1 FROM public.washes WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.wash_assignments WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.payments WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.wash_creation_requests WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA') AND action='wash.created'));

SET LOCAL ROLE authenticated;
INSERT INTO aw_ids SELECT 'cash', public.open_cash_session((SELECT id FROM aw_ids WHERE k='stA'),10000,'C-ATOMIC');
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object(
      'idempotency_key','ui-atomic-overpay', 'initial_payment',jsonb_build_object('amount_minor',4000,'method_key','cash'))
      FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('surpaiement initial refusé',false);
  EXCEPTION WHEN SQLSTATE '23514' THEN INSERT INTO aw_results VALUES ('surpaiement initial refusé',true); END;
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object(
      'idempotency_key','ui-atomic-method', 'initial_payment',jsonb_build_object('amount_minor',1000,'method_key','invalide'))
      FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('moyen invalide refusé',false);
  EXCEPTION WHEN SQLSTATE '23514' THEN INSERT INTO aw_results VALUES ('moyen invalide refusé',true); END;
END $$;
RESET ROLE;
INSERT INTO aw_results VALUES ('surpaiement : aucune écriture partielle',
  NOT EXISTS (SELECT 1 FROM public.washes WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.wash_creation_requests WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
  AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE cash_session_id=(SELECT id FROM aw_ids WHERE k='cash')));

-- Rejouer la même clé après le refus initial est permis : aucun échec ne l'a réservée.
SET LOCAL ROLE authenticated;
INSERT INTO aw_ids SELECT 'washCash', public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
INSERT INTO aw_ids SELECT 'washCashRetry', public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
RESET ROLE;
INSERT INTO aw_results VALUES
  ('création espèces : fiche, affectation et prix figé',
    (SELECT status='assigned' AND total_minor=3000 AND paid_minor=1000 AND vehicle_id IS NOT NULL FROM public.washes WHERE id=(SELECT id FROM aw_ids WHERE k='washCash'))
    AND (SELECT count(*)=1 AND min(unit_price_minor)=3000 FROM public.wash_items WHERE wash_id=(SELECT id FROM aw_ids WHERE k='washCash'))
    AND (SELECT count(*)=1 FROM public.wash_assignments WHERE wash_id=(SELECT id FROM aw_ids WHERE k='washCash'))),
  ('création espèces : un paiement et un mouvement liés',
    (SELECT count(*)=1 FROM public.payments WHERE wash_id=(SELECT id FROM aw_ids WHERE k='washCash') AND amount_minor=1000)
    AND (SELECT count(*)=1 FROM public.cash_movements m JOIN public.payments p ON p.id=m.payment_id
      WHERE p.wash_id=(SELECT id FROM aw_ids WHERE k='washCash') AND m.cash_session_id=(SELECT id FROM aw_ids WHERE k='cash') AND m.amount_minor=1000)),
  ('rejeu identique : même fiche, une réservation et un paiement',
    (SELECT id FROM aw_ids WHERE k='washCash')=(SELECT id FROM aw_ids WHERE k='washCashRetry')
    AND (SELECT count(*)=1 FROM public.wash_creation_requests WHERE company_id=(SELECT id FROM aw_ids WHERE k='coA'))
    AND (SELECT count(*)=1 FROM public.payments WHERE wash_id=(SELECT id FROM aw_ids WHERE k='washCash')));

UPDATE public.service_prices SET price_minor=9999 WHERE service_id=(SELECT id FROM aw_ids WHERE k='srvA');
SET LOCAL ROLE authenticated;
INSERT INTO aw_ids SELECT 'washAfterPrice', public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object('initial_payment',jsonb_build_object('amount_minor',2000,'method_key','cash')) FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('même clé, autre montant : refus',false);
  EXCEPTION WHEN SQLSTATE '23505' THEN INSERT INTO aw_results VALUES ('même clé, autre montant : refus',true); END;
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object('station_id',(SELECT id FROM aw_ids WHERE k='stA2')) FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('même clé, autre station du tenant : refus',false);
  EXCEPTION WHEN SQLSTATE '23505' THEN INSERT INTO aw_results VALUES ('même clé, autre station du tenant : refus',true); END;
END $$;
RESET ROLE;
INSERT INTO aw_results VALUES ('rejeu après changement de grille : même fiche et prix historique',
  (SELECT id FROM aw_ids WHERE k='washAfterPrice')=(SELECT id FROM aw_ids WHERE k='washCash')
  AND (SELECT total_minor=3000 AND paid_minor=1000 FROM public.washes WHERE id=(SELECT id FROM aw_ids WHERE k='washCash')));

-- Un autre utilisateur autorisé de la même station ne peut pas récupérer la clé.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM aw_ids WHERE k='other'),true);
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('même clé, autre utilisateur : refus',false);
  EXCEPTION WHEN SQLSTATE '23505' THEN INSERT INTO aw_results VALUES ('même clé, autre utilisateur : refus',true); END;
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object('idempotency_key','ui-other-station','station_id',(SELECT id FROM aw_ids WHERE k='stA2')) FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('station non affectée : refus',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO aw_results VALUES ('station non affectée : refus',true); END;
END $$;

SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM aw_ids WHERE k='noPay'),true);
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object('idempotency_key','ui-no-payment-permission','employee_ids','[]'::jsonb) FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('paiement sans permission : refus',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO aw_results VALUES ('paiement sans permission : refus',true); END;
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object('idempotency_key','ui-no-assign-permission','initial_payment',NULL) FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('affectation sans permission : refus',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO aw_results VALUES ('affectation sans permission : refus',true); END;
END $$;
INSERT INTO aw_ids SELECT 'washNoPay', public.create_wash_atomic((SELECT payload || jsonb_build_object(
  'idempotency_key','ui-without-payment','initial_payment',NULL,'employee_ids','[]'::jsonb,'plate','2222 BB 01') FROM aw_payloads WHERE k='baseA'));
RESET ROLE;
INSERT INTO aw_results VALUES ('fiche sans paiement possible sans permission payments.create',
  (SELECT paid_minor=0 AND total_minor=9999 FROM public.washes WHERE id=(SELECT id FROM aw_ids WHERE k='washNoPay'))
  AND NOT EXISTS (SELECT 1 FROM public.payments WHERE wash_id=(SELECT id FROM aw_ids WHERE k='washNoPay')));

-- Même clé dans un autre tenant : données séparées ; accès à A impossible.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM aw_ids WHERE k='ownerB'),true);
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('station autre tenant : refus',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO aw_results VALUES ('station autre tenant : refus',true); END;
END $$;
INSERT INTO aw_ids SELECT 'washB', public.create_wash_atomic((SELECT payload || jsonb_build_object(
  'station_id',(SELECT id FROM aw_ids WHERE k='stB'),'category_id',(SELECT id FROM aw_ids WHERE k='catB'),
  'items',jsonb_build_array(jsonb_build_object('serviceId',(SELECT id FROM aw_ids WHERE k='srvB'),'qty',1)),
  'employee_ids',jsonb_build_array((SELECT id FROM aw_ids WHERE k='ownerB')),'initial_payment',NULL,'plate','3333 CC 01') FROM aw_payloads WHERE k='baseA'));
RESET ROLE;
INSERT INTO aw_results VALUES ('clés identiques isolées entre entreprises',
  (SELECT id FROM aw_ids WHERE k='washB')<>(SELECT id FROM aw_ids WHERE k='washCash')
  AND (SELECT count(*)=2 FROM public.wash_creation_requests WHERE idempotency_key='ui-atomic-cash-0001'));

-- Les canaux mobiles ne créent pas de mouvement espèces et restent distincts.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM aw_ids WHERE k='ownerA'),true);
INSERT INTO aw_ids SELECT 'wave', public.create_wash_atomic((SELECT payload || jsonb_build_object(
  'idempotency_key','ui-atomic-wave','plate','4000 WW 01','initial_payment',jsonb_build_object('amount_minor',1000,'method_key','wave')) FROM aw_payloads WHERE k='baseA'));
INSERT INTO aw_ids SELECT 'orange', public.create_wash_atomic((SELECT payload || jsonb_build_object(
  'idempotency_key','ui-atomic-orange','plate','4000 OO 01','initial_payment',jsonb_build_object('amount_minor',1000,'method_key','orange_money')) FROM aw_payloads WHERE k='baseA'));
INSERT INTO aw_ids SELECT 'mtn', public.create_wash_atomic((SELECT payload || jsonb_build_object(
  'idempotency_key','ui-atomic-mtn','plate','4000 MM 01','initial_payment',jsonb_build_object('amount_minor',1000,'method_key','mtn_momo')) FROM aw_payloads WHERE k='baseA'));
RESET ROLE;
INSERT INTO aw_results VALUES ('trois canaux mobiles distincts, sans mouvement espèces',
  (SELECT count(DISTINCT pm.key)=3 FROM public.payments p JOIN public.payment_methods pm ON pm.id=p.payment_method_id
    WHERE p.wash_id IN (SELECT id FROM aw_ids WHERE k IN ('wave','orange','mtn'))
      AND pm.key IN ('wave','orange_money','mtn_momo') AND pm.affects_cash=false)
  AND (SELECT count(*)=1 FROM public.cash_movements WHERE cash_session_id=(SELECT id FROM aw_ids WHERE k='cash')));

-- La projection du board ne doit pas regrouper les trois canaux en un seul.
SET LOCAL ROLE authenticated;
INSERT INTO aw_results VALUES
  ('boards lavage et finance : les trois canaux restent distincts',
    (SELECT count(DISTINCT p->>'method')=3
      FROM jsonb_array_elements(public.my_wash_board()) w
      CROSS JOIN LATERAL jsonb_array_elements(w->'payments') p
      WHERE (w->>'id')::uuid IN (SELECT id FROM aw_ids WHERE k IN ('wave','orange','mtn'))
        AND p->>'method' IN ('wave','orange_money','mtn_momo'))
    AND (SELECT count(DISTINCT p->>'uiMethod')=3
      FROM jsonb_array_elements(public.my_finance_board()->'paymentMethods') p
      WHERE p->>'key' IN ('wave','orange_money','mtn_momo') AND p->>'uiMethod'=p->>'key'));

-- Les encaissements ultérieurs et dépenses utilisent les mêmes canaux, sans
-- mouvement espèces. Le rapprochement serveur calcule chaque montant séparément.
INSERT INTO aw_ids SELECT 'wavePayLater', public.record_wash_payment_by_key((SELECT id FROM aw_ids WHERE k='wave'),500,'wave','','ui-wave-later');
INSERT INTO aw_ids SELECT 'wavePayRetry', public.record_wash_payment_by_key((SELECT id FROM aw_ids WHERE k='wave'),500,'wave','','ui-wave-later');
INSERT INTO aw_ids SELECT 'orangePayLater', public.record_wash_payment_by_key((SELECT id FROM aw_ids WHERE k='orange'),500,'orange_money','','ui-orange-later');
INSERT INTO aw_ids SELECT 'mtnPayLater', public.record_wash_payment_by_key((SELECT id FROM aw_ids WHERE k='mtn'),500,'mtn_momo','','ui-mtn-later');
INSERT INTO aw_ids SELECT 'waveExpense', public.record_expense_by_key((SELECT id FROM aw_ids WHERE k='stA'),100,'Fournitures','Test Wave','',current_date,'wave','ui-wave-expense');
INSERT INTO aw_ids SELECT 'orangeExpense', public.record_expense_by_key((SELECT id FROM aw_ids WHERE k='stA'),100,'Fournitures','Test Orange','',current_date,'orange_money','ui-orange-expense');
INSERT INTO aw_ids SELECT 'mtnExpense', public.record_expense_by_key((SELECT id FROM aw_ids WHERE k='stA'),100,'Fournitures','Test MTN','',current_date,'mtn_momo','ui-mtn-expense');
SELECT public.reconcile_channel(pm.id,current_date,current_date,1500)
  FROM public.payment_methods pm WHERE pm.station_id=(SELECT id FROM aw_ids WHERE k='stA')
    AND pm.key IN ('wave','orange_money','mtn_momo');
RESET ROLE;
INSERT INTO aw_results VALUES
  ('paiements ultérieurs mobiles : rejeu unique et pas de mouvement espèces',
    (SELECT id FROM aw_ids WHERE k='wavePayLater')=(SELECT id FROM aw_ids WHERE k='wavePayRetry')
    AND (SELECT count(*)=6 FROM public.payments WHERE wash_id IN (SELECT id FROM aw_ids WHERE k IN ('wave','orange','mtn')))
    AND (SELECT count(*)=3 FROM public.washes WHERE id IN (SELECT id FROM aw_ids WHERE k IN ('wave','orange','mtn')) AND paid_minor=1500)
    AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE payment_id IN (SELECT id FROM aw_ids WHERE k IN ('wavePayLater','orangePayLater','mtnPayLater')))),
  ('dépenses mobiles : trois canaux et aucun mouvement espèces',
    (SELECT count(DISTINCT pm.key)=3 FROM public.expenses e JOIN public.payment_methods pm ON pm.id=e.payment_method_id
      WHERE e.id IN (SELECT id FROM aw_ids WHERE k IN ('waveExpense','orangeExpense','mtnExpense'))
        AND pm.key IN ('wave','orange_money','mtn_momo') AND e.cash_session_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.cash_movements WHERE expense_id IN (SELECT id FROM aw_ids WHERE k IN ('waveExpense','orangeExpense','mtnExpense')))),
  ('rapprochements mobiles : trois relevés séparés à 1500',
    (SELECT count(*)=3 FROM public.channel_reconciliations r JOIN public.payment_methods pm ON pm.id=r.payment_method_id
      WHERE pm.station_id=(SELECT id FROM aw_ids WHERE k='stA') AND pm.key IN ('wave','orange_money','mtn_momo')
        AND r.expected_minor=1500 AND r.counted_minor=1500 AND r.difference_minor=0 AND r.frozen));

-- Collision avec une ancienne fiche : ne pas l'encaisser ni en créer une autre.
SET LOCAL ROLE authenticated;
INSERT INTO aw_ids SELECT 'legacy', public.create_wash_full((SELECT payload || jsonb_build_object(
  'idempotency_key','ui-legacy-collision','plate','5555 LL 01') FROM aw_payloads WHERE k='baseA'));
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload || jsonb_build_object(
      'idempotency_key','ui-legacy-collision','plate','5555 LL 01') FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('clé ancienne : refus sans adoption',false);
  EXCEPTION WHEN SQLSTATE '23505' THEN INSERT INTO aw_results VALUES ('clé ancienne : refus sans adoption',true); END;
END $$;
RESET ROLE;
INSERT INTO aw_results VALUES ('clé ancienne : aucune nouvelle fiche ni paiement',
  (SELECT paid_minor=0 FROM public.washes WHERE id=(SELECT id FROM aw_ids WHERE k='legacy'))
  AND (SELECT count(*)=1 FROM public.washes WHERE plate='5555 LL 01')
  AND NOT EXISTS (SELECT 1 FROM public.wash_creation_requests WHERE idempotency_key='ui-legacy-collision'));

-- Annuler un paiement ne doit pas être réparé/rejoué par une ancienne requête.
SET LOCAL ROLE authenticated;
SELECT public.cancel_payment((SELECT p.id FROM public.payments p WHERE p.wash_id=(SELECT id FROM aw_ids WHERE k='washCash') LIMIT 1),'Remboursement test');
INSERT INTO aw_ids SELECT 'washAfterCancel', public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
RESET ROLE;
INSERT INTO aw_results VALUES ('rejeu après annulation : pas de nouvel encaissement',
  (SELECT id FROM aw_ids WHERE k='washAfterCancel')=(SELECT id FROM aw_ids WHERE k='washCash')
  AND (SELECT paid_minor=0 FROM public.washes WHERE id=(SELECT id FROM aw_ids WHERE k='washCash'))
  AND (SELECT count(*)=1 FROM public.payments WHERE wash_id=(SELECT id FROM aw_ids WHERE k='washCash')));

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_wash_atomic((SELECT payload FROM aw_payloads WHERE k='baseA'));
    INSERT INTO aw_results VALUES ('anon ne peut pas exécuter la RPC',false);
  EXCEPTION WHEN SQLSTATE '42501' THEN INSERT INTO aw_results VALUES ('anon ne peut pas exécuter la RPC',true); END;
END $$;
RESET ROLE;
SELECT label, ok FROM aw_results ORDER BY label;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM aw_results WHERE ok IS NOT TRUE) THEN
    RAISE EXCEPTION 'Au moins un contrôle de création atomique a échoué';
  END IF;
END $$;
ROLLBACK;
