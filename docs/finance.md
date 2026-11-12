# Prompt 06 — Caisse, paiements, finance et rentabilité honnête

> **Reçu client local à cette branche :** aperçu, impression et PDF reprennent prix figés, remise totale, paiements actifs/annulés et solde enregistré, avec avertissement en cas d’incohérence. Il s’agit d’un instantané non fiscal, pas d’une pièce comptable certifiée. La remise de promotion n’est pas déduite deux fois. Voir [whatsapp-receipts.md](whatsapp-receipts.md).
>
> **Migration `052` appliquée sur `lavauto`, frontend de cette branche non déployé :** la nouvelle création connectée et son paiement initial passent par une transaction unique. Les moyens `wave`, `orange_money` et `mtn_momo` sont conservés séparément dans les paiements, dépenses et projections des tableaux de bord ; ils ne génèrent pas de mouvement de caisse espèces. Les migrations `054`–`055` restent locales : elles ajoutent le périmètre station, la certification figée, la validation et des protections pour les paiements et dépenses. Les tests SQL isolés vérifient les paiements, dépenses et rapprochements ; la recette métier distante reste à faire. Aucun fournisseur de paiement n’est connecté automatiquement.
>
> Dans l’écran Caisse connecté, avant validation, `channelExpected()` est une **estimation sur les fiches chargées** (200 maximum), filtrée par station et canal, avec remboursements datés dans la période. L’opérateur doit saisir un comptage entier : il n’est pas prérempli avec cette estimation. Lors du scellement, le serveur recalcule l’attendu à partir de ses paiements et remboursements ; l’écran relit ensuite le relevé figé et son écart. Un changement de période efface le comptage saisi. Voir [testing.md](testing.md). Les anciens paiements et rapprochements existants ne sont pas réécrits par `052`.
>
> Une réponse perdue pour un paiement **ultérieur** reste un risque distinct : vérifier la fiche et ses paiements avant de réessayer. Les règles de caisse et barèmes modifiés dans Paramètres restent locaux et ne configurent pas les RPC serveur.

Les sections suivantes décrivent les résultats historiques P06/P07 et ne prouvent pas le déploiement de `052`.

**Statut historique P06 : livré, puis étendu par le Prompt 07.** Le projet Supabase `cgxrqorwmmcyqescatzs` portait **29 migrations** (`001` → `029`) à la livraison P06 et en portait **33** après `030`–`033`. `024`–`033` ont été appliquées et vérifiées une seule fois ; elles ne doivent jamais être réappliquées. Aucun compte Auth, e-mail, invitation, secret, clé API, commit ou PR n'a été créé pour ces phases.

## 1. Ce que la base garantit

| Migration | Apport vérifié |
|---|---|
| `024_finance_foundation.sql` | `cash_closures`, liens `cash_movements.payment_id` / `expense_id`, `expenses.idempotency_key`, `ensure_payment_method`, remplacement des RPC de paiement / clôture / réouverture, backfill, `REVOKE` / `GRANT`. |
| `025_finance_commands.sql` | `open_cash_session`, `record_expense_by_key`, `cancel_expense`, `cancel_payment`, `create_commission_period`, `generate_commission_lines`, `record_commission_payout`, `reconcile_channel`, grants sur 9 noms. |
| `026_finance_profitability.sql` | `payment_method_ui_key(text)` et `my_profitability(date,date)` : `costsMissing=true`, `result=NULL`, `grossMargin=NULL`, `partialBalance` explicitement **« PAS un benefice net »**. |
| `027_finance_hardening.sql` | Commissions et rapprochements figés, trigger d'immuabilité, index uniques sur les mouvements de paiement/dépense, `my_finance_board()` en 10 collections, backfills et révocations d'écritures directes. |
| `028_finance_board_join.sql` | Correctif idempotent du join de clôture : `u2.id = cs.closed_by` au lieu de l'alias erroné `u.id`. Vérifié à `migrations=28`, `join_ok=true`, `join_typo=false`. |
| `029_finance_clock.sql` | `clock_timestamp()` dans 7 RPC ; `close_cash_session` ne compte que les mouvements `created_at >= COALESCE(reopened_at, opened_at)`. Vérifié à `migrations=29`. |

Les écritures directes des tables finance sont révoquées pour `authenticated`. Les RPC déduisent le tenant du JWT, vérifient la permission et l'accès à la station ; aucun `company_id` n'est envoyé par le navigateur. `channel_reconciliations.difference_minor`, `cash_closures.difference_minor` et les relevés validés ne sont pas recalculables.

## 2. Intégration distante — 32/32

[`supabase/tests/p06_rollback.sql`](../supabase/tests/p06_rollback.sql) exécute **32 contrôles** dans `BEGIN … ROLLBACK` : **32 `ok=true`**, 0 `ok=false`, 0 donnée résiduelle après rollback. Le test couvre :

- idempotence des paiements et dépenses ; 3 appels avec la même clé d'espèces produisent **2 paiements uniques** au total avec Mobile Money ;
- aucun mouvement de caisse pour Mobile Money ; solde théorique `10000 + 1000 − 500 = 10500` ;
- clôture `10600 / +100`, réouverture motivée, remboursement `-1000`, deuxième clôture `10100 / écart 0`, premier relevé `+100` conservé ;
- immuabilité des clôtures, commissions et rapprochements ; refus des écritures SQL directes ;
- rapprochement **par canal** : espèces `500` ≠ Mobile Money `1000` ;
- commission `300` → `validated` → `paid`, sans recalcul ni doublon de paie ;
- `my_profitability()` : `revenue 3000`, `collected 1500`, `receivables 1500`, `expenses 500`, `commissions 300`, `partialBalance 1000`, `costsMissing=true`, `result/grossMargin NULL` ;
- `my_finance_board()` : 10 collections, 5 mouvements, 2 clôtures, 2 rapprochements ;
- isolation A/B : aucun board ni CA de A visible depuis B, clôture et dépense inter-stations refusées.

État distant après rollback à la livraison P06 : **29 migrations**, `0 auth.users`, `0 user_profiles`, `0 companies`, `0 stations`, `0 washes`, `0 payments`, `0 cash_sessions`, `0 cash_closures`, `0 expenses`, `0 commission_periods`, `0 channel_reconciliations`. Le projet en porte désormais **33** après P07.

## 3. Frontend branché

- `src/types.ts` : 10 collections finance, mouvements signés, clôtures, canaux, relevés de commission, annulations, `ProfitabilityReport`.
- `src/lib/finance.ts` : projections pures `my_finance_board()` → UI, `my_profitability()` → UI, rapport local avec `costsMissing`, `channelExpected()` par canal.
- `src/lib/financeState.ts` : transformations locales pures qui reproduisent la sémantique des RPC (idempotence, mouvements signés, relevés immuables, ajustements, périodes figées, paie tracée).
- `src/lib/metrics.ts` : suppression de « Résultat simplifié » ; CA / encaissé / créances / achats / consommations / commissions / charges fixes / solde partiel sont distincts. `netResult` et `grossMargin` restent `NULL`.
- `DataAdapter` : `listFinanceBoard()`, `listProfitability()`, `financeCommands`. `LocalDataAdapter` garde le calcul local ; `SupabaseDataAdapter` et `SupabaseFinanceCommands` utilisent uniquement les RPC.
- `src/lib/store.tsx` : `serverFinance` uniquement avec source Supabase + Auth vérifiée ; `refreshFinance()` recharge board + rapport ; les mutations passent par `financeRpc()` puis rafraîchissent lavages et finance.
- Pages : caisse avec relevés immuables, rapprochement par canal et journal des mouvements ; lavages avec annulation motivée d'un encaissement ; dépenses avec clé d'idempotence ; commissions avec brouillon indicatif et relevés figés servant à la paie ; rapports et tableau de bord avec l'état « coûts manquants ».

## 4. Règle de vérité comptable

`partialBalance = collected − expenses` est un **solde partiel**, jamais un bénéfice net. En P06, la marge brute et le résultat net restaient `NULL` : les achats valorisés, consommations produits et charges complètes arrivent avec le **Prompt 07**. Les valeurs `NULL` ne sont jamais remplacées par un faux zéro dans l'interface ; l'export CSV sans relevé validé est explicitement nommé `BROUILLON`. Depuis P07, `grossMargin` et `result` ne deviennent calculables qu'après l'attestation immuable `finance_cost_periods` ; le solde partiel ne change jamais de nature.

## 5. Validations

- Distant : `migrations=29`, `finance_rpc=7`, `clock_defs=7`, `granted_authenticated=true`, `close_period_filter=true`, `board_join_ok=true`, `costs_missing=true`, `result_null=true`, `anon_can_execute_finance=false`, `public_execute=false` ; test P06 **32/32** en `ROLLBACK`.
- Local à la livraison P06 : `typecheck` exit 0 ; `lint` **14/14** ; `check` **167/0 · local** et **168/0 · `WG_DATA_SOURCE=supabase`** (section `[10]`, 12 contrôles) ; build **115 modules**, `index-DJR5X9wg.js` **717,03 kB** / gzip **190,69 kB** ; `git diff --check` propre. Après P07 : `lint` **18/18**, `check` **179/0 · local** et **180/0 · supabase**, build **120 modules**.
- Preview : `/`, `/connexion`, `/inscription`, `/app/tableau-de-bord`, `/app/caisse`, `/app/rapports`, `/app/commissions` → `200` ; hôte `evil.example.com` → `403`. Aucun navigateur réel / Playwright.
- Audit : `npm audit --omit=dev` 2 modérées, `npm audit` 5 modérées, 0 haute / 0 critique ; aucun `npm audit fix --force` (React Router v7 resté reporté après P10).
- Aucun compte, e-mail, secret, clé API, commit ou PR P06. Aucune migration `021`–`029` réappliquée. Aucune donnée de test persistée.

## 6. Limite volontaire

Le **Prompt 07 est livré** : [`docs/stock.md`](stock.md) décrit les réceptions valorisées, les consommations, le rattachement des achats et la certification des coûts. Toute affirmation de bénéfice net sans attestation de période reste interdite. Le **Prompt 08 est livré** : [`docs/crm.md`](crm.md) décrit CRM, fidélité, forfaits, promotions, flottes et la file de notifications sans fournisseur.
