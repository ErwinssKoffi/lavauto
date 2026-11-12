# P08 — CRM, fidélité, forfaits, promotions, flottes et file de notifications

**Date :** 11/11/2026 · **Projet Supabase :** `lavauto` (`cgxrqorwmmcyqescatzs`) · **Branche :** `arena/868cde36-lavauto` · **Validation :** `p08_complet` reçue avant exécution.

Ce document décrit la livraison réelle du **Prompt 08**. Il complète [`docs/database.md`](database.md), [`docs/finance.md`](finance.md) et [`docs/stock.md`](stock.md). Le Prompt 07 reste figé : aucune migration `021`–`033` n'a été réécrite ni réappliquée. Les migrations `034`–`038` sont strictement additives et ont été appliquées une seule fois.

---

## 1. Périmètre livré

| Domaine | Livré | Non livré, volontairement |
| --- | --- | --- |
| Fiches clients | `email`, type `individual` / `fleet`, `preferred_channel`, `loyalty_opt_in`, `fleet_id` ; véhicules rattachés ; historique des lavages | Aucun import de contacts, aucun compte Auth de test |
| Fidélité | programmes, cartes, transactions immuables et idempotentes, accrual sur lavage, solde jamais négatif | Aucun échange de points contre une remise automatique |
| Forfaits | plans avec fenêtre de validité, vente idempotente, consommation une seule fois par fiche, expiration côté serveur | Aucun paiement de forfait simulé |
| Promotions | codes, quota, dates, montant minimum, une seule promotion par fiche, refus après encaissement, `10 % de 5 000 = 500` | Aucune promotion cumulable |
| Flottes | flottes, contrats, rattachement véhicules, créances ouvertes, limite de crédit, numéro de contrat unique | Aucun lettrage / recouvrement automatique |
| Notifications | file `pending` / `cancelled` dans `notification_outbox`, canal préféré obligatoire, idempotence, annulation | **Aucun fournisseur, aucune clé API, aucun envoi réel ni simulé, aucune colonne `sent_at` / `provider` / `sent_by`** |

La règle métier affichée dans l'interface est explicite : *« Aucun fournisseur connecté : la file reste en attente, aucun envoi simulé. »*

---

## 2. Base de données : migrations 034 → 038

| Migration | Contenu |
| --- | --- |
| [`034_crm_foundation.sql`](../supabase/migrations/034_crm_foundation.sql) | 12 permissions P08, 30 liaisons `role_permissions`, 13 tables, extensions de `customers` / `vehicles` / `washes`, RLS, `REVOKE` des écritures directes, `GRANT` aux seuls `authenticated`. Aucune colonne `crm_idempotency_key` sur `washes`. |
| [`035_crm_commands.sql`](../supabase/migrations/035_crm_commands.sql) | `assert_crm_station()` + 15 RPC `SECURITY DEFINER` : profils/véhicules, fidélité, forfaits, promotions, flottes/contrats/créances. Tenant déduit du JWT, vérification de permission et de station activée. |
| [`036_crm_board.sql`](../supabase/migrations/036_crm_board.sql) | `my_crm_board()` en `STABLE SECURITY DEFINER` : 15 collections JSONB en camelCase, `stats` à 8 compteurs, `rules`, aucun `company_id` dans la réponse. |
| [`037_crm_notifications.sql`](../supabase/migrations/037_crm_notifications.sql) | `enqueue_notification()` / `cancel_pending_notification()` : file `pending` / `cancelled` uniquement, canal préféré obligatoire, clé d'idempotence, aucun fournisseur ni secret. |
| [`038_promotion_idempotency_order.sql`](../supabase/migrations/038_promotion_idempotency_order.sql) | Correctif additif de `apply_promotion_to_wash()` : clé explicite déjà vue → `duplicate` **avant** le quota ; clé dérivée `promo:{washId}:{promotionId}` par défaut ; `usage_count` incrémenté une seule fois. Aucune table, aucune donnée, aucun fournisseur. |

**État distant vérifié après application :** 38 migrations, **69 tables publiques**, 43 permissions, 102 liaisons `role_permissions`, 18 RPC P08, board `SECURITY DEFINER`, `anon_granted = 0`, **0** `auth.users`, client, lavage, `promotion_usages` ou `notification_outbox`. Les tables P08 sont :

`loyalty_programs`, `loyalty_cards`, `loyalty_transactions`, `package_plans`, `customer_packages`, `package_usages`, `promotions`, `promotion_usages`, `fleets`, `fleet_contracts`, `fleet_vehicles`, `fleet_receivables`, `notification_outbox`.

Les permissions ajoutées sont `crm.view/manage`, `loyalty.view/manage`, `packages.view/manage`, `promotions.view/manage`, `fleets.view/manage` et `notifications.view/enqueue`. Le caissier reçoit la lecture CRM, pas la gestion.

---

## 3. Règles d'intégrité

- **Fidélité** : `loyalty_transactions` est append-only ; une clé d'idempotence déjà vue renvoie la transaction existante ; le solde ne peut pas devenir négatif ; l'accrual lit le montant avant remise.
- **Forfaits** : `price_minor >= 0`, `wash_count > 0`, `validity_days > 0`, `starts_at <= ends_at` ; la vente est refusée hors fenêtre ; `customer_packages.expires_at` est calculée côté serveur ; une fiche ne consomme qu'un seul forfait actif non expiré.
- **Promotions** : une seule par fiche (`UNIQUE(company_id, wash_id)` sur `promotion_usages`), jamais après encaissement, jamais hors validité ni après quota ; l'unicité et l'idempotence sont contrôlées **avant** l'incrément de quota. Le doublon renvoie `duplicate`, pas une erreur de quota.
- **Flottes** : le numéro de contrat est unique pour une flotte donnée ; une créance exige un contrat actif et respecte la limite de crédit ; la clé d'idempotence renvoie la créance existante.
- **Notifications** : une seule cible (`customer_id` XOR `fleet_id`), canal `none` refusé, ligne `pending` ou `cancelled` uniquement, aucune sortie réseau.
- **Isolation** : chaque RPC vérifie `auth.uid()`, la station et la permission ; `my_crm_board()` ne renvoie que les lignes du tenant ; une écriture directe est refusée (`42501`).

---

## 4. Frontend et routes

Deux routes réelles remplacent l'ancienne entrée « Étape 08 à venir » :

| Route | Page | Contenu |
| --- | --- | --- |
| `/app/fidelisation` | [`src/pages/Fidelisation.tsx`](../src/pages/Fidelisation.tsx) | 4 onglets : fidélité, forfaits, promotions, notifications ; 4 `StatCard` ; formulaires et listes ; règle « aucun fournisseur connecté ». |
| `/app/flottes` | [`src/pages/Flottes.tsx`](../src/pages/Flottes.tsx) | Flottes, contrats, rattachement de véhicules, créances, notifications en attente, limite de crédit. |

La fiche [`src/pages/Clients.tsx`](../src/pages/Clients.tsx) est enrichie : e-mail, canal préféré, opt-in fidélité, flotte, véhicule, cartes, forfaits, notifications et historique des lavages.

Architecture :

- [`src/types.ts`](../src/types.ts) : champs CRM optionnels sur `Client` / `Wash`, 15 collections, `CrmStats`, `CrmRules`.
- [`src/lib/crm.ts`](../src/lib/crm.ts) : `CRM_CHANNELS`, `CRM_RULES`, `emptyCrmCollections()`, `withCrmDefaults()`, `crmBoardFromState()`, `mapCrmBoard()`. Aucune donnée fabriquée.
- [`src/lib/crmState.ts`](../src/lib/crmState.ts) : 17 transformateurs locaux, miroir honnête des RPC, `finalize()` recalcule les stats.
- [`src/services/adapters/DataAdapter.ts`](../src/services/adapters/DataAdapter.ts) : contrat `CrmCommands` (17 méthodes) et `listCrmBoard()`.
- [`src/services/adapters/SupabaseCrmCommands.ts`](../src/services/adapters/SupabaseCrmCommands.ts) : 17 RPC, aucun `company_id`, defaults de dates, réponses JSONB normalisées.
- `LocalDataAdapter` : `crmCommands = null`, board projeté depuis l'état local ; `SupabaseDataAdapter` : `rpc('my_crm_board')`.
- [`src/lib/store.tsx`](../src/lib/store.tsx) : `serverCrm`, `refreshCrm()`, `crmRpc()` / `crmLocal()`, 17 actions ; `refreshWashes()` n'écrase plus `clients` quand le board serveur est actif.
- [`src/lib/permissionCatalog.ts`](../src/lib/permissionCatalog.ts) : 12 permissions, 2 gardes de route ; [`src/components/navigation.tsx`](../src/components/navigation.tsx) et [`src/App.tsx`](../src/App.tsx) : 2 liens actifs, **17 URL `/app` à la livraison P08** (18 après P09).

---

## 5. Tests distants et locaux

[`supabase/tests/p08_rollback.sql`](../supabase/tests/p08_rollback.sql) s'exécute en `BEGIN … ROLLBACK` et passe **35/35 `ok=true`** à distance (`execute_query` `4e266d79-438b-4762-b601-31df7f490d22`). Il couvre :

1. 38 migrations, 0 fixture, 13 tables, 18 RPC, board `SECURITY DEFINER`, aucun grant `anon`.
2. 43 permissions, 102 liaisons, `REVOKE` des écritures directes (`42501`).
3. Fiches enrichies et préférence de canal.
4. Fidélité idempotente : solde `7` puis `17`, sans double transaction.
5. Forfaits : fenêtre/expiration, consommation `2 → 1 → 0/exhausted`, refus hors validité.
6. Promotion : `10 % de 5000 = 500`, **jamais appliquée deux fois**, quota, validité, une seule par fiche, refus après encaissement.
7. Flotte crédit/contrat/créance idempotente.
8. Notifications : 1 annulée + 1 `pending`, aucun fournisseur, aucun envoi simulé, aucune colonne `sent_at|provider|sent_by`.
9. `my_crm_board()` camelCase, `stats`, `rules`, sans `company_id`, isolation A/B.

Après rollback, l'introspection finale (`d78ccfc3-756f-42eb-b058-551ec552ca38`, après `4933afa7-9ab4-45ed-96f0-7d1eb9b8b2cc`) confirme : 38 migrations, 69 tables, 43 permissions, 102 liaisons, 18 RPC P08, **0** compte / client / lavage / usage de promotion / notification.

`scripts/check.cjs` ajoute la section `[12]` (14 contrôles) : projection du board, 15 collections vides, fiches enrichies, idempotence loyalty/package/promo, promotion `500`, notification sans envoi, crédit flotte, 17 commandes RPC, migrations `034`–`038`, 2 routes et test distant. `scripts/lint.cjs` passe à **23 règles**.

---

## 6. Vérifications de non-régression

- `npm run typecheck` : 0 erreur.
- `npm run lint` : **23 / 23** ; `npm run check` : **196 OK / 0 KO · local** ; `WG_DATA_SOURCE=supabase npm run check` : **197 OK / 0 KO · supabase**.
- `npm run build` : **125 modules**, `index-CiHaUd3f.js` **849,85 kB** / gzip **216,39 kB**, CSS `31,73 kB` / gzip `7,47 kB`; aucune dépendance ajoutée en P08 (Recharts 2.15.4 arrive en P09).
- Preview HTTP : **11 URL `200`**, hôte arbitraire `evil.example.com` **`403`**, hôte proxy `.e2b.app` `200` ; routes P08 incluses, aucune erreur console sur les routes rendues.
- P05 (17/17), P06 (32/32), P07 (22/22) restent livrés ; aucune migration `021`–`038` réappliquée.

---

## 7. Limites conservées

À la livraison P08 : aucun compte Auth, e-mail, secret, clé API, bucket Storage, fournisseur SMS/e-mail/WhatsApp, envoi réel ou simulé, navigateur réel / Playwright, commit ou PR P03–P08. Catalogue, abonnement et paramètres restaient alors des écritures locales. `npm audit` conservait 5 vulnérabilités modérées (2 en production) ; `npm audit fix --force` imposerait React Router v7 et reste reporté au Prompt 10. P09 a ensuite livré, sur validation explicite `p09_complet`, les vues analytiques, les quotas serveur et le back-office administrable : voir [analytics.md](analytics.md).

Le **Prompt 10 a ensuite été livré** sur `p10_complet` + `levee_totale` : Storage privé, QA, CI/CD, 15 specs Playwright et 7 documents ; voir [deployment.md](deployment.md).
