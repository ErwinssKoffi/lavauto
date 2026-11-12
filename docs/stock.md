# Prompt 07 — Stock, fournisseurs, achats, consommations et coûts certifiés

**Statut : livré sur la branche de travail.** Le projet Supabase `cgxrqorwmmcyqescatzs` porte **33 migrations** (`001` → `033`). Les migrations `030`–`033` sont additives : elles n'ont pas réécrit `021`–`029`, n'ont créé aucun compte Auth, e-mail, secret, clé API, commit ni PR. Aucune donnée de démonstration n'est insérée.

## 1. Ce que la base garantit

| Migration | Apport |
|---|---|
| `030_stock_foundation.sql` | 4 tables (`product_categories`, `stock_receipt_events`, `stock_consumption_runs`, `finance_cost_periods`), colonnes `category_id`, `average_cost_minor`, `idempotency_key`, `note`, `reason`, `purchase_order_id`, `is_stock_purchase`, index d'unicité, triggers d'immuabilité / d'inventaire / de catégorie d'achat, backfill du coût moyen, politiques SELECT, `REVOKE INSERT/UPDATE/DELETE` sur les tables de stock. |
| `031_stock_commands.sql` | `assert_stock_station()` + 11 RPC : catégories, fournisseurs, produits, commandes, réceptions partielles idempotentes, wrapper historique, inventaires, normes de consommation et consommation agrégée / valorisée. |
| `032_stock_board.sql` | `my_stock_board()` en `STABLE SECURITY DEFINER` : 16 collections camelCase, valorisation, alertes et règles, sans `company_id` exposé. |
| `033_finance_cost_certification.sql` | `link_expense_to_purchase_order()`, `certify_profitability_period()` et `my_profitability()` : `grossMargin` / `result` ne sont publiés qu'après attestation immuable de la période. |

Vérifications distantes après `033` : `migrations=33`, `p07_finance_rpc=4`, `certified_label_present=true`, `costs_missing_present=true`, `anon_granted=0`. Les vérifications après `030`, `031`, `032` ont également confirmé `p07_tables=4`, `avg_cost=1`, `p07_triggers=6`, `no_direct_insert=true`, `stock_rpc=11`, `granted=4`, `receipt_args='p_order_id uuid, p_lines jsonb, p_receipt_key text'`, `board_rpc=1`, `security_definer=1`. Après le test en `ROLLBACK` : `migrations=33`, `auth_users=0`, `profiles=0`, `companies=0`, `stations=0`, `products=0`, `purchase_orders=0`, `stock_movements=0`, `inventory_sessions=0`, `certifications=0`, `expenses=0`, `washes=0`.

## 2. Règles métier

- **Une commande n'incrémente jamais le stock.** Seule une réception validée crée un mouvement `purchase_receipt`.
- **Coût moyen pondéré** : `nouveau_cout = (stock_avant × cout_avant + quantité_reçue × cout_réel) / (stock_avant + quantité_reçue)`. Le coût est figé sur chaque mouvement de consommation.
- **Réception partielle idempotente** : `receipt_key` + contenu exact. Une clé réutilisée avec un autre contenu est refusée (`23514`) ; la même clé avec le même contenu ne crée aucun doublon.
- **Consommation théorique** : les normes `service × produit` sont agrégées par produit, arrondies à l'unité supérieure, puis générées au plus une fois par fiche `ready` / `delivered`.
- **Mouvements immuables** : aucune modification ni suppression ; un écart d'inventaire crée une nouvelle écriture valorisée au coût moyen.
- **Achats ≠ charges** : une dépense d'achat de stock rattachée à sa commande est exclue des charges d'exploitation pour éviter un double comptage avec la réception.
- **Pas de faux bénéfice net** : sans attestation, `costsMissing=true`, `grossMargin=NULL`, `result=NULL`, et le solde partiel reste explicitement « PAS un bénéfice net ».

## 3. Certification du résultat net

`certify_profitability_period(p_start, p_end, p_attestation)` refuse la publication si :

1. une dépense d'achat de stock n'est pas rattachée à une commande ;
2. un mouvement de réception, de consommation ou un ajustement positif d'inventaire n'est pas valorisé ;
3. une période de commission `draft` chevauche la période.

Après contrôle, un relevé `finance_cost_periods` immuable fige CA, consommations, charges d'exploitation, commissions, charges fixes, marge brute et résultat net. `my_profitability()` lit cette attestation ; une seconde certification de la même période est refusée (`55000`).

## 4. Frontend branché

- `src/types.ts` : 16 collections P07 et `ProfitabilityReport.certified` / `operatingExpenses` / `certifiedAt` / `attestation`.
- `src/lib/stock.ts` : projections pures `my_stock_board()` → domaine, état vide, alertes, valorisation et `withStockDefaults()`.
- `src/lib/stockState.ts` : transformations locales pures, miroir des RPC (réception, coût moyen, inventaire, consommation, rattachement, certification).
- `src/lib/finance.ts` : rapport local et serveur avec coûts P07 ; NULL préservé hors attestation.
- `DataAdapter` : `listStockBoard()` + `stockCommands`. `LocalDataAdapter` garde les transformations locales ; `SupabaseDataAdapter` / `SupabaseStockCommands` n'utilisent que les RPC, sans identifiant de tenant.
- `src/lib/store.tsx` : `serverStock`, `refreshStock()`, `stockRpc()` et 11 actions métier ; le mode local reste synchrone.
- Pages : `/app/stock` (produits, fournisseurs, commandes, réceptions, inventaires, mouvements, rattachements, attestations) et `/app/consommations` (normes, fiches à consommer, exécutions valorisées, sorties). `Rapports` affiche l'état certifié et propose l'attestation.
- Navigation : les deux entrées `step 07` sont devenues de vrais liens, filtrés par `inventory.view` / `inventory.consume`.

## 5. Test distant

[`supabase/tests/p07_rollback.sql`](../supabase/tests/p07_rollback.sql) exécute des contrôles dans `BEGIN … ROLLBACK` : 33 migrations et 0 fixture, grants et révocations, création par RPC, commande sans mouvement, deux réceptions partielles et coût moyen `1500`, idempotence, consommation `2 × 1500 = 3000`, inventaire `+2`, refus de certification avant rattachement, publication après attestation, immuabilité, board camelCase, écriture directe `42501` et isolation A/B.

Résultat : **22 lignes, 22 `ok=true`, 0 `ok=false`**. Invariants vérifiés : commande sans mouvement, coût moyen pondéré `1500`, réception idempotente et clé détournée refusée `23514`, consommation `2 × 1500 = 3000`, inventaire `+2` et session close immuable, `my_profitability()` à `NULL` avant attestation, certification refusée sur achat ambigu `23514`, publication `grossMargin=0` / `result=0` après rattachement, relevé immuable `55000`, board camelCase sans `company_id`, écriture directe `42501` et isolation A/B. Après `ROLLBACK`, la base ne conserve aucune donnée de test.

## 6. Validations

- Distant : 33 migrations ; 030 / 031 / 032 / 033 vérifiées sans réapplication ; test P07 **22/22** en `BEGIN … ROLLBACK` ; 0 fixture après rollback.
- Local : `typecheck` 0 erreur ; `lint` **18/18** ; `npm run check` **179/0 · local** ; `WG_DATA_SOURCE=supabase npm run check` **180/0 · supabase** ; `scripts/check.cjs` section `[11]` (10 contrôles) ; `scripts/lint.cjs` 4 règles P07.
- Build : **120 modules**, `index-NrXHDwfq.js` **782,70 kB** / gzip **203,51 kB**, CSS **31,68 kB** / gzip **7,45 kB** ; `git diff --check` propre.
- Preview `Stock et rentabilité` sur `0.0.0.0:5173` : `/`, `/connexion`, `/inscription`, `/app/tableau-de-bord`, `/app/stock`, `/app/consommations`, `/app/rapports`, `/app/caisse`, `/app/commissions` → `200` ; hôte `evil.example.com` → `403`.
- Audit : `npm audit --omit=dev` 2 modérées, `npm audit` 5 modérées, 0 haute / 0 critique ; aucun `npm audit fix --force` (React Router v7 resté reporté après P10).
- Aucun compte Auth, e-mail, secret, clé API, commit ou PR P07 ; aucune migration `021`–`033` réappliquée.

## 7. Limite volontaire

Le **Prompt 08 est livré** : CRM, fidélité, forfaits, promotions, flottes et file de notifications sans fournisseur ; voir [`docs/crm.md`](crm.md). À la livraison P08 : aucun navigateur réel / Playwright, aucun bucket Storage, aucun envoi et aucune donnée client persistante. P10 a ensuite livré Storage privé, 15 specs Playwright et la CI ; les 2 vulnérabilités modérées de production restent ouvertes et `npm audit fix --force` n'est pas appliqué car il imposerait React Router v7.

