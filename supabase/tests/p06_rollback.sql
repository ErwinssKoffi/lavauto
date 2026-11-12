-- Test d'intégration Prompt 06 — À EXÉCUTER DANS UNE TRANSACTION AVEC ROLLBACK.
-- Aucune donnée persistée : 3 comptes Auth temporaires, 2 entreprises, 2 stations,
-- 1 fiche, 1 employé, 1 caisse, 3 paiements, 1 dépense, 1 remboursement,
-- 2 rapprochements de canal, 1 période de commission et 1 paiement de paie.
-- Le connecteur Supabase exécute ce script via `execute_query` (BEGIN … ROLLBACK).
BEGIN;
CREATE TEMP TABLE p06_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE p06_result (label text, ok boolean, detail text) ON COMMIT DROP;
GRANT ALL ON p06_ids, p06_result TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'p06-a@test.invalid',
   jsonb_build_object('company_name','Tenant P06 A','station_name','Station P06 A','owner_name','Owner P06 A')),
  ('22222222-2222-4222-8222-222222222222', 'p06-b@test.invalid',
   jsonb_build_object('company_name','Tenant P06 B','station_name','Station P06 B','owner_name','Owner P06 B')),
  ('33333333-3333-4333-8333-333333333333', 'p06-emp@test.invalid',
   jsonb_build_object('invitation', true));

INSERT INTO p06_ids VALUES
  ('userA','11111111-1111-4111-8111-111111111111'),
  ('userB','22222222-2222-4222-8222-222222222222'),
  ('empA','33333333-3333-4333-8333-333333333333'),
  ('catA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('srvA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),
  ('postA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  ('cliA','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4');
INSERT INTO p06_ids SELECT 'coA', company_id FROM public.user_profiles WHERE id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p06_ids SELECT 'coB', company_id FROM public.user_profiles WHERE id = '22222222-2222-4222-8222-222222222222';
INSERT INTO p06_ids SELECT 'stA', station_id FROM public.user_station_assignments WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO p06_ids SELECT 'stB', station_id FROM public.user_station_assignments WHERE user_id = '22222222-2222-4222-8222-222222222222';

INSERT INTO public.user_profiles (id, company_id, full_name, email, role_id, active)
SELECT '33333333-3333-4333-8333-333333333333', (SELECT v FROM p06_ids WHERE k='coA'),
  'Employe P06', 'p06-emp@test.invalid',
  (SELECT id FROM public.roles WHERE company_id IS NULL AND key = 'washer'), true;
INSERT INTO public.user_station_assignments (company_id, user_id, station_id)
SELECT (SELECT v FROM p06_ids WHERE k='coA'), '33333333-3333-4333-8333-333333333333',
  (SELECT v FROM p06_ids WHERE k='stA');

UPDATE public.stations
SET activated = true, settings = jsonb_build_object('commission_rate', 10)
WHERE id IN (SELECT v FROM p06_ids WHERE k IN ('stA','stB'));

INSERT INTO public.vehicle_categories (id, company_id, station_id, name)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(SELECT v FROM p06_ids WHERE k='coA'),(SELECT v FROM p06_ids WHERE k='stA'),'Berline P06');
INSERT INTO public.services (id, company_id, station_id, name)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',(SELECT v FROM p06_ids WHERE k='coA'),(SELECT v FROM p06_ids WHERE k='stA'),'Lavage P06');
INSERT INTO public.service_prices (company_id, station_id, service_id, vehicle_category_id, price_minor)
VALUES ((SELECT v FROM p06_ids WHERE k='coA'),(SELECT v FROM p06_ids WHERE k='stA'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',3000);
INSERT INTO public.wash_posts (id, company_id, station_id, name, capacity)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',(SELECT v FROM p06_ids WHERE k='coA'),(SELECT v FROM p06_ids WHERE k='stA'),'Piste P06',2);
INSERT INTO public.customers (id, company_id, station_id, name)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',(SELECT v FROM p06_ids WHERE k='coA'),(SELECT v FROM p06_ids WHERE k='stA'),'Client P06');

-- Session propriétaire A.
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO p06_ids SELECT 'washA', public.create_wash_full(jsonb_build_object(
  'station_id',(SELECT v FROM p06_ids WHERE k='stA'),
  'category_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'plate','P06 AB 01','customer_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  'customer_name','Client P06','discount_minor',0,
  'items',jsonb_build_array(jsonb_build_object('serviceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','qty',1)),
  'employee_ids',jsonb_build_array('33333333-3333-4333-8333-333333333333'),
  'post_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','idempotency_key','p06-wash-a'));
SELECT set_config('p06.washA',(SELECT v::text FROM p06_ids WHERE k='washA'),true);

SELECT public.transition_wash_status((SELECT v FROM p06_ids WHERE k='washA'),'in_progress');
SELECT public.transition_wash_status((SELECT v FROM p06_ids WHERE k='washA'),'quality_check');
SELECT public.record_wash_quality_check((SELECT v FROM p06_ids WHERE k='washA'),'approved','RAS');
SELECT public.transition_wash_status((SELECT v FROM p06_ids WHERE k='washA'),'delivered');

INSERT INTO p06_ids SELECT 'sessionA', public.open_cash_session(
  (SELECT v FROM p06_ids WHERE k='stA'), 10000, 'C-P06-A');
SELECT set_config('p06.sessionA',(SELECT v::text FROM p06_ids WHERE k='sessionA'),true);

-- Paiement partiel espèces, idempotent, puis complément Mobile Money.
INSERT INTO p06_ids SELECT 'cashPay', public.record_wash_payment_by_key(
  (SELECT v FROM p06_ids WHERE k='washA'),1000,'cash','','p06-cash-1');
INSERT INTO p06_ids SELECT 'cashPayDup', public.record_wash_payment_by_key(
  (SELECT v FROM p06_ids WHERE k='washA'),1000,'cash','','p06-cash-1');
INSERT INTO p06_ids SELECT 'mmPay', public.record_wash_payment_by_key(
  (SELECT v FROM p06_ids WHERE k='washA'),1000,'mobile_money','','p06-mm-1');
INSERT INTO p06_ids SELECT 'cashMethod', id FROM public.payment_methods
  WHERE station_id=(SELECT v FROM p06_ids WHERE k='stA') AND key='cash';
INSERT INTO p06_ids SELECT 'mmMethod', id FROM public.payment_methods
  WHERE station_id=(SELECT v FROM p06_ids WHERE k='stA') AND key='mobile_money';

INSERT INTO p06_result VALUES
  ('paiements partiels : especes + Mobile Money, aucun doublon',
   (SELECT count(*)=2 FROM public.payments WHERE wash_id=(SELECT v FROM p06_ids WHERE k='washA'))
   AND (SELECT v FROM p06_ids WHERE k='cashPay')=(SELECT v FROM p06_ids WHERE k='cashPayDup')
   AND (SELECT paid_minor=2000 AND total_minor=3000 FROM public.washes WHERE id=(SELECT v FROM p06_ids WHERE k='washA'))
   AND (SELECT count(*)=1 FROM public.cash_movements WHERE payment_id=(SELECT v FROM p06_ids WHERE k='cashPay') AND kind='payment_in'),
   '2 paiements pour 3 appels, 2000/3000, cle p06-cash-1 unique'),
  ('Mobile Money : aucun mouvement de caisse especes',
   (SELECT count(*)=0 FROM public.cash_movements WHERE payment_id=(SELECT v FROM p06_ids WHERE k='mmPay'))
   AND (SELECT affects_cash=false FROM public.payment_methods WHERE id=(SELECT v FROM p06_ids WHERE k='mmMethod')),
   'canal distinct, caisse intacte');

-- Dépense espèces idempotente.
INSERT INTO p06_ids SELECT 'expenseA', public.record_expense_by_key(
  (SELECT v FROM p06_ids WHERE k='stA'),500,'Fournitures','Shampoing P06','Fournisseur P06',
  current_date,'cash','p06-exp-1');
INSERT INTO p06_ids SELECT 'expenseDup', public.record_expense_by_key(
  (SELECT v FROM p06_ids WHERE k='stA'),500,'Fournitures','Shampoing P06','Fournisseur P06',
  current_date,'cash','p06-exp-1');
INSERT INTO p06_result VALUES
  ('depense idempotente : un seul decaissement',
   (SELECT v FROM p06_ids WHERE k='expenseA')=(SELECT v FROM p06_ids WHERE k='expenseDup')
   AND (SELECT count(*)=1 FROM public.expenses WHERE idempotency_key='p06-exp-1')
   AND (SELECT count(*)=1 FROM public.cash_movements WHERE expense_id=(SELECT v FROM p06_ids WHERE k='expenseA') AND kind='expense_out'),
   '500 FCFA, 1 mouvement expense_out');
INSERT INTO p06_result VALUES
  ('solde theorique = fond + encaissements especes - decaissements especes',
   (SELECT 10000 + COALESCE(SUM(amount_minor),0) FROM public.cash_movements
     WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA')
       AND kind IN ('payment_in','expense_out','adjustment')) = 10500,
   '10000 + 1000 - 500 = 10500');

-- Première clôture avec écart : comptage converti en mouvement « closing ».
SELECT public.close_cash_session((SELECT v FROM p06_ids WHERE k='sessionA'),10600);
INSERT INTO p06_result VALUES
  ('cloture : mouvement closing + releve immuable',
   (SELECT count(*)=1 FROM public.cash_closures WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA'))
   AND (SELECT theoretical_minor=10500 AND difference_minor=100 AND counted_minor=10600
        FROM public.cash_closures WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA'))
   AND (SELECT count(*)=1 FROM public.cash_movements
        WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA') AND kind='closing' AND amount_minor=100)
   AND (SELECT status='closed' AND counted_minor=10600 FROM public.cash_sessions WHERE id=(SELECT v FROM p06_ids WHERE k='sessionA')),
   'theorique 10500, compte 10600, ecart +100');

DO $$ BEGIN
  BEGIN
    PERFORM public.close_cash_session(current_setting('p06.sessionA')::uuid, 10600);
    INSERT INTO p06_result VALUES ('seconde cloture sans reouverture refusee',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p06_result VALUES ('seconde cloture sans reouverture refusee',true,'23514');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.cancel_payment((SELECT v FROM p06_ids WHERE k='cashPay'),'Remboursement client');
    INSERT INTO p06_result VALUES ('remboursement sur caisse cloturee refuse',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p06_result VALUES ('remboursement sur caisse cloturee refuse',true,'23514 : reouverture requise');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.cancel_expense((SELECT v FROM p06_ids WHERE k='expenseA'),'Erreur fournisseur');
    INSERT INTO p06_result VALUES ('annulation depense sur caisse cloturee refusee',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p06_result VALUES ('annulation depense sur caisse cloturee refusee',true,'23514');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.reopen_cash_session(current_setting('p06.sessionA')::uuid,'xx');
    INSERT INTO p06_result VALUES ('reouverture exige un motif',false,'motif court accepte');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p06_result VALUES ('reouverture exige un motif',true,'23514');
  END;
END $$;
SELECT public.reopen_cash_session((SELECT v FROM p06_ids WHERE k='sessionA'),'Comptage a reverifier');
INSERT INTO p06_result VALUES
  ('reouverture motivee : dernier comptage = nouveau fond',
   (SELECT status='open' AND opening_float_minor=10600 AND reopen_reason='Comptage a reverifier'
      AND reopened_at IS NOT NULL FROM public.cash_sessions WHERE id=(SELECT v FROM p06_ids WHERE k='sessionA')),
   'fond 10600, motif trace, anciens mouvements exclus');

-- Remboursement du paiement espèces : jamais supprimé, jamais dupliqué.
SELECT public.cancel_payment((SELECT v FROM p06_ids WHERE k='cashPay'),'Remboursement client');
DO $$ BEGIN
  BEGIN
    PERFORM public.cancel_payment((SELECT v FROM p06_ids WHERE k='cashPay'),'Remboursement client');
    INSERT INTO p06_result VALUES ('remboursement non duplique',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p06_result VALUES ('remboursement non duplique',true,'23514');
  END;
END $$;
INSERT INTO p06_result VALUES
  ('remboursement : paiement conserve, ajustement caisse, creance recalculee',
   (SELECT count(*)=1 FROM public.payment_cancellations WHERE payment_id=(SELECT v FROM p06_ids WHERE k='cashPay'))
   AND (SELECT count(*)=1 FROM public.cash_movements WHERE payment_id=(SELECT v FROM p06_ids WHERE k='cashPay') AND kind='adjustment' AND amount_minor=-1000)
   AND (SELECT paid_minor=1000 FROM public.washes WHERE id=(SELECT v FROM p06_ids WHERE k='washA'))
   AND (SELECT bool_or((p->>'id')=(SELECT v::text FROM p06_ids WHERE k='cashPay')
        AND (p->>'cancelledAt') IS NOT NULL AND (p->>'cancelReason')='Remboursement client')
      FROM jsonb_array_elements(public.my_wash_board()) t(w)
      CROSS JOIN LATERAL jsonb_array_elements(t.w->'payments') p
      WHERE (t.w->>'id')=current_setting('p06.washA')),
   '1 annulation, -1000, paid=1000, board expose le motif');

-- Nouveau paiement partiel espèces après réouverture, puis seconde clôture.
SELECT public.record_wash_payment_by_key((SELECT v FROM p06_ids WHERE k='washA'),500,'cash','','p06-cash-2');
SELECT public.close_cash_session((SELECT v FROM p06_ids WHERE k='sessionA'),10100);
INSERT INTO p06_result VALUES
  ('clotures immuables : 2 releves, premier ecart conserve',
   (SELECT count(*)=2 FROM public.cash_closures WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA'))
   AND (SELECT count(*)=1 FROM public.cash_closures
        WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA') AND difference_minor=100)
   AND (SELECT count(*)=1 FROM public.cash_closures
        WHERE cash_session_id=(SELECT v FROM p06_ids WHERE k='sessionA') AND theoretical_minor=10100 AND difference_minor=0)
   AND (SELECT status='closed' AND counted_minor=10100 FROM public.cash_sessions WHERE id=(SELECT v FROM p06_ids WHERE k='sessionA')),
   '10600 - 1000 + 500 = 10100');
DO $$ BEGIN
  BEGIN
    UPDATE public.cash_closures SET counted_minor = 1 WHERE cash_session_id = current_setting('p06.sessionA')::uuid;
    INSERT INTO p06_result VALUES ('releve de cloture non modifiable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('releve de cloture non modifiable',true,'55000 trigger immuable');
  END;
END $$;

-- Rapprochement PAR CANAL : espèces 500, Mobile Money 1000.
SELECT public.reconcile_channel((SELECT v FROM p06_ids WHERE k='cashMethod'),current_date,current_date,500);
SELECT public.reconcile_channel((SELECT v FROM p06_ids WHERE k='mmMethod'),current_date,current_date,1000);
INSERT INTO p06_result VALUES
  ('rapprochement par canal : especes different de Mobile Money',
   (SELECT expected_minor=500 AND counted_minor=500 AND difference_minor=0 AND frozen
      FROM public.channel_reconciliations WHERE payment_method_id=(SELECT v FROM p06_ids WHERE k='cashMethod'))
   AND (SELECT expected_minor=1000 AND counted_minor=1000 AND difference_minor=0 AND frozen
      FROM public.channel_reconciliations WHERE payment_method_id=(SELECT v FROM p06_ids WHERE k='mmMethod'))
   AND (SELECT count(*)=2 FROM public.channel_reconciliations),
   'especes 500, Mobile Money 1000, jamais confondus');
DO $$ BEGIN
  BEGIN
    PERFORM public.reconcile_channel((SELECT v FROM p06_ids WHERE k='cashMethod'),current_date,current_date,700);
    INSERT INTO p06_result VALUES ('rapprochement fige non recalculable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('rapprochement fige non recalculable',true,'55000');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    UPDATE public.channel_reconciliations SET expected_minor=9999
      WHERE payment_method_id=(SELECT v FROM p06_ids WHERE k='cashMethod');
    INSERT INTO p06_result VALUES ('rapprochement fige non modifiable en SQL direct',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('rapprochement fige non modifiable en SQL direct',true,'55000 trigger');
  END;
END $$;

-- Commissions : brouillon recalculable, relevé validé figé, paie tracée.
INSERT INTO p06_ids SELECT 'periodA', public.create_commission_period(
  (SELECT v FROM p06_ids WHERE k='stA'),current_date,current_date);
SELECT public.generate_commission_lines((SELECT v FROM p06_ids WHERE k='periodA'));
INSERT INTO p06_result VALUES
  ('commission brouillon : barème 10 % sur lavage terminé',
   (SELECT count(*)=1 AND min(amount_minor)=300 FROM public.employee_commissions
      WHERE period_id=(SELECT v FROM p06_ids WHERE k='periodA'))
   AND (SELECT status='draft' FROM public.commission_periods WHERE id=(SELECT v FROM p06_ids WHERE k='periodA')),
   '3000 x 10 % = 300');
SELECT public.validate_commission_period((SELECT v FROM p06_ids WHERE k='periodA'));
DO $$ BEGIN
  BEGIN
    PERFORM public.generate_commission_lines((SELECT v FROM p06_ids WHERE k='periodA'));
    INSERT INTO p06_result VALUES ('periode validee : non recalculable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('periode validee : non recalculable',true,'55000');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    UPDATE public.employee_commissions SET amount_minor=9999
      WHERE period_id=(SELECT v FROM p06_ids WHERE k='periodA');
    INSERT INTO p06_result VALUES ('ligne de commission figee',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('ligne de commission figee',true,'55000 trigger');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    UPDATE public.commission_periods SET status='draft'
      WHERE id=(SELECT v FROM p06_ids WHERE k='periodA');
    INSERT INTO p06_result VALUES ('retour periode validée vers brouillon refuse',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('retour periode validée vers brouillon refuse',true,'55000');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_commission_period((SELECT v FROM p06_ids WHERE k='stA'),current_date,current_date);
    INSERT INTO p06_result VALUES ('periode figee non recreable',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '55000' THEN
    INSERT INTO p06_result VALUES ('periode figee non recreable',true,'55000');
  END;
END $$;
SELECT public.record_commission_payout((SELECT v FROM p06_ids WHERE k='periodA'),
  (SELECT v FROM p06_ids WHERE k='empA'),300,'PAIE-P06');
DO $$ BEGIN
  BEGIN
    PERFORM public.record_commission_payout((SELECT v FROM p06_ids WHERE k='periodA'),
      (SELECT v FROM p06_ids WHERE k='empA'),300,'PAIE-P06-BIS');
    INSERT INTO p06_result VALUES ('paie de commission non dupliquee',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    INSERT INTO p06_result VALUES ('paie de commission non dupliquee',true,'23514');
  END;
END $$;
INSERT INTO p06_result VALUES
  ('periode payee : statut figé, montant conserve',
   (SELECT status='paid' FROM public.commission_periods WHERE id=(SELECT v FROM p06_ids WHERE k='periodA'))
   AND (SELECT count(*)=1 AND min(amount_minor)=300 FROM public.employee_commissions
        WHERE period_id=(SELECT v FROM p06_ids WHERE k='periodA'))
   AND (SELECT count(*)=1 FROM public.commission_payouts WHERE period_id=(SELECT v FROM p06_ids WHERE k='periodA')),
   'paid, 300 FCFA, 1 paiement');

-- Rapport de rentabilité : solde partiel explicite, jamais « bénéfice net ».
SELECT set_config('p06.profit', public.my_profitability(current_date,current_date)::text, true);
INSERT INTO p06_result VALUES
  ('rapport : CA, encaisse, creances, achats, consommations, commissions, charges fixes distingues',
   (current_setting('p06.profit')::jsonb->>'revenue')::bigint=3000
   AND (current_setting('p06.profit')::jsonb->>'collected')::bigint=1500
   AND (current_setting('p06.profit')::jsonb->>'receivables')::bigint=1500
   AND (current_setting('p06.profit')::jsonb->>'expenses')::bigint=500
   AND (current_setting('p06.profit')::jsonb->>'purchases')::bigint=0
   AND (current_setting('p06.profit')::jsonb->>'consumptions')::bigint=0
   AND (current_setting('p06.profit')::jsonb->>'commissions')::bigint=300
   AND (current_setting('p06.profit')::jsonb->>'fixedCosts')::bigint=0,
   'revenue 3000, collected 1500, receivables 1500, commissions 300');
INSERT INTO p06_result VALUES
  ('couts manquants : ni marge brute ni resultat net calcules',
   (current_setting('p06.profit')::jsonb->>'costsMissing')::boolean
   AND (current_setting('p06.profit')::jsonb->>'result') IS NULL
   AND (current_setting('p06.profit')::jsonb->>'grossMargin') IS NULL
   AND (current_setting('p06.profit')::jsonb->>'label') LIKE 'Couts manquants%'
   AND jsonb_array_length(current_setting('p06.profit')::jsonb->'missing')=4
   AND (current_setting('p06.profit')::jsonb->'definitions'->>'partialBalance') LIKE '%PAS un benefice net%',
   'costsMissing=true, result/grossMargin NULL, libelle explicite');
INSERT INTO p06_result VALUES
  ('solde partiel : encaisse moins depenses, pas un benefice net',
   (current_setting('p06.profit')::jsonb->>'partialBalance')::bigint=1000
   AND (current_setting('p06.profit')::jsonb->>'partialBalance')::bigint
     = (current_setting('p06.profit')::jsonb->>'collected')::bigint
       - (current_setting('p06.profit')::jsonb->>'expenses')::bigint,
   '1500 - 500 = 1000');

-- Projection finance agrégée et garde des écritures directes.
INSERT INTO p06_result VALUES
  ('my_finance_board : 10 collections finance, aucun canal melange',
   jsonb_array_length(public.my_finance_board()->'paymentMethods')=2
   AND jsonb_array_length(public.my_finance_board()->'cashSessions')=1
   AND jsonb_array_length(public.my_finance_board()->'cashMovements')=5
   AND jsonb_array_length(public.my_finance_board()->'cashClosures')=2
   AND jsonb_array_length(public.my_finance_board()->'expenses')=1
   AND jsonb_array_length(public.my_finance_board()->'reconciliations')=2
   AND jsonb_array_length(public.my_finance_board()->'commissionPeriods')=1
   AND jsonb_array_length(public.my_finance_board()->'commissionLines')=1
   AND jsonb_array_length(public.my_finance_board()->'commissionPayouts')=1
   AND jsonb_array_length(public.my_finance_board()->'paymentCancellations')=1,
   '10 collections, 5 mouvements, 2 clotures, 2 rapprochements');

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.cash_sessions SET status='open' WHERE id=current_setting('p06.sessionA')::uuid;
    INSERT INTO p06_result VALUES ('ecriture directe finance refusee',false,'aucune exception');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO p06_result VALUES ('ecriture directe finance refusee',true,'42501 REVOKE');
  END;
END $$;
RESET ROLE;

-- Session propriétaire B : 0 fuite, aucune commande sur la station A.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
INSERT INTO p06_result VALUES
  ('isolation A/B : board finance de B sans caisse de A',
   NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.my_finance_board()->'cashSessions') t(s)
     WHERE (t.s->>'id')=current_setting('p06.sessionA'))
   AND (public.my_profitability(current_date,current_date)->>'revenue')::bigint=0,
   'B : 0 caisse A, 0 CA A');
DO $$ BEGIN
  BEGIN
    PERFORM public.close_cash_session(current_setting('p06.sessionA')::uuid, 0);
    INSERT INTO p06_result VALUES ('B ne cloture pas la caisse de A',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    INSERT INTO p06_result VALUES ('B ne cloture pas la caisse de A',true,'P0002');
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.record_expense_by_key((SELECT v FROM p06_ids WHERE k='stA'),100,'Fournitures','Fuite B','',current_date,'cash','p06-b-1');
    INSERT INTO p06_result VALUES ('B ne depense pas sur la station de A',false,'aucune exception');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO p06_result VALUES ('B ne depense pas sur la station de A',true,'42501');
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

SELECT label, ok, detail FROM p06_result ORDER BY ok, label;
ROLLBACK;
