# Prompt 05 — Cœur métier lavages

> **Ajout non déployé en production :** la fiche de lavage propose un reçu imprimable et téléchargeable en PDF, y compris en mode local. La migration `053` et les fonctions Meta locales préparent un avis WhatsApp à `ready` et une demande manuelle avec consentement distinct ; aucun message réel n’a été envoyé. Voir [whatsapp-receipts.md](whatsapp-receipts.md).
>
> **Migration `052` appliquée sur `lavauto`, frontend de cette branche non déployé en production :** `052_atomic_wash_creation.sql` ajoute `create_wash_atomic`, appelée par le nouveau frontend pour créer ensemble une fiche et son paiement initial éventuel. Elle réserve une clé par entreprise et compare utilisateur, station et condensat de la commande ; un rejeu identique retrouve la fiche, une collision est refusée. Un refus du paiement annule aussi la fiche et ses écritures associées. Les anciennes RPC restent accessibles et ne deviennent pas atomiques. La recette métier distante reste à faire ; les tests SQL isolés et la reprise après réponse incertaine sont détaillés dans [testing.md](testing.md).
>
> En cas d’incertitude, reprendre la même commande dans le même onglet, compte et station. Si le stockage a disparu, est illisible ou si la clé entre en collision avec une ancienne fiche, vérifier manuellement avant toute nouvelle saisie. Cette branche conserve aussi la clé d’un paiement ultérieur jusqu’à confirmation par relecture ; une fiche hors des 200 dernières peut empêcher cette confirmation. Le plafond de remise caissier reste un contrôle local, non garanti par la base connectée.

Les sections suivantes décrivent la livraison historique P05 et ses résultats, antérieurs à `052`.

**Date :** 11/11/2026 · **Projet Supabase :** `lavauto` (`cgxrqorwmmcyqescatzs`, `eu-central-1`, PostgreSQL 17.11) · **Branche :** `arena/868cde36-lavauto` · **Statut :** livré (P05) ; la finance P06 est livrée séparément dans [finance.md](finance.md). **Arrêt avant le Prompt 07.**

Validation explicite reçue via `p05_complet` : exécuter uniquement le Prompt 05 (DB/RPC, file d'attente, postes, affectations multiples, 7 statuts, contrôle qualité, historique véhicule, frontend, mapping FR→EN, tests et documentation). Aucun compte Auth, e-mail de test, secret/API key, commit ou PR créé.

---

## 1. Cycle à 7 statuts

| Statut | Libellé UI | Successeur(s) | Note |
| --- | --- | --- | --- |
| `pending` | En attente | `assigned`, `cancelled` | fiche créée sans affectation |
| `assigned` | Affecté | `in_progress`, `cancelled` | un ou plusieurs employés + poste |
| `in_progress` | En cours | `quality_check`, `cancelled` | lavage en cours |
| `quality_check` | Contrôle qualité | `in_progress` (reprise) | validation **obligatoire** avant `ready` |
| `ready` | Prêt / terminé | `delivered`, `cancelled` | **le lavage terminé n'est PAS livré** |
| `delivered` | Livré | — | restitution au client, `delivered_at` horodaté |
| `cancelled` | Annulé | — | motif obligatoire, `cancelled_at` + `cancelled_reason` |

La garde d'état est imposée **côté serveur** par `assert_wash_status_transition()` (trigger `BEFORE UPDATE`, migration `021`) et par le verrou `ready` de la migration `023` ; elle est reflétée côté UI par `WASH_STATUS_FLOW` / `src/lib/washLifecycle.ts`. `finished_at` est posé à `ready`, `delivered_at` uniquement à `delivered`.

### Mapping des 4 statuts historiques

| Ancien | Nouveau | Règle |
| --- | --- | --- |
| `en_attente` | `pending` | file d'attente |
| `en_cours` | `in_progress` | — |
| `termine` | **`ready`** | surtout pas `delivered` : la restitution reste à faire |
| `annule` | `cancelled` | motif conservé |

`normalizeWashes()` applique cette table à la lecture de `washguard.state.v1` et crée **un événement `wash_status_history` initial par fiche importée** (`fromStatus: null`, motif « Import du statut historique »). La normalisation est idempotente.

---

## 2. Base de données — migrations 021, 022 et 023

Le schéma du Prompt 03 (`004_washes.sql`) possédait déjà les tables, les 7 statuts, les prix figés et `create_wash_with_items()`. P05 ajoute l'autorité serveur :

| Migration | Contenu |
| --- | --- |
| `021_wash_lifecycle.sql` | trigger d'état machine, trigger d'audit `wash.*`, `transition_wash_status`, `create_wash_full`, `assign_wash`, `record_wash_quality_check`, `create_wash_post`, `record_wash_payment_by_key`, **REVOKE** des écritures directes |
| `022_wash_board.sql` | `my_wash_posts`, `my_wash_board`, `my_vehicle_history` (projection JSONB directement dans les clés du domaine UI) |
| `023_wash_quality_guard.sql` | `ready` interdit sans approbation, motif de reprise obligatoire, `create_wash_post(p_station_id)`, `stationId` sur les postes, `my_company_clients()` |

**Sécurité :** toutes les fonctions sont `SECURITY DEFINER` avec `search_path = public, pg_temp`, dérivent le tenant de `auth.uid()` via `current_company_id()`, vérifient `has_permission(...)`, `can_access_station(...)` et l'idempotence. `REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated` verrouille `washes`, `wash_items`, `wash_status_history`, `wash_assignments`, `wash_quality_checks`, `wash_posts`, `vehicles`, `payment_methods` : **seules les RPC peuvent écrire**. `GRANT EXECUTE … TO authenticated`, `REVOKE … FROM PUBLIC, anon`. Aucun argument ne contient d'identifiant d'entreprise.

**Prix figé :** `create_wash_full()` délègue à `create_wash_with_items()` qui relit `service_prices` côté serveur et écrit `wash_items.unit_price_minor`. `wash_items` reste append-only. Modifier la grille ne change jamais une fiche enregistrée (testé en base : grille 9 999, fiche 3 000).

**Idempotence :** `idempotency_key` sur `washes` et `payments` ; un double appel renvoie la même fiche / le même paiement.

**Véhicule :** une plaque non vide crée ou réutilise `vehicles` (unicité `(company_id, upper(plate))`), renseigne `washes.vehicle_id` et alimente `my_vehicle_history(plate)`.

**État distant à la livraison P05 :** 23 migrations, 10 RPC exposées aux seuls `authenticated`, 4 triggers sur `washes`, `0` privilège d'écriture directe. P06 porte le schéma à **29 migrations** ; `0` donnée de test persistée. `BarberShop` inchangé.

---

## 3. Frontend

- `src/types.ts` : `WashStatus` 7 valeurs EN, `WASH_STATUS_LABELS`, `LEGACY_WASH_STATUS`, `WASH_STATUS_FLOW`, `WashPost`, `WashStatusEvent`, champs `assignedUserIds`, `postId`, `deliveredAt`, `history`, `qualityResult`, `qualityNotes`, `AppState.washPosts`.
- `src/lib/washLifecycle.ts` : règles pures (transitions, normalisation, déduplication, `finishedWashes`, tons de badge).
- `src/services/adapters/DataAdapter.ts` : `listWashBoard()`, `listCatalog()`, `listClients()` + port `WashCommands` (`washCommands`), **aucun `company_id`** dans `src/`.
- `src/services/adapters/SupabaseDataAdapter.ts` : `mapWashBoard()` (`stationId` inclus), `SupabaseWashCommands` (7 méthodes de commande), `listClients()` / `my_company_clients()`, `my_vehicle_history`.
- `src/lib/store.tsx` : mode local = mutations synchrones inchangées + nouvel historique ; mode Supabase avec vraie session Auth = commandes RPC puis relecture du board. `refreshWashes()` projette aussi le catalogue et les clients serveur (UUID réels, jamais `uid('cat')` / `uid('cli')` locaux) et n'est appelé qu'une fois par session, sans boucle. `serverWash` distingue le harnais de test (port Auth local) d'une session réelle.
- `src/pages/Washes.tsx` : file d'attente par statut, postes filtrés par station, création multi-employés, fiche détaillée avec historique horodaté, affectation/réaffectation, contrôle qualité approuvé/refusé, livraison distincte, annulation motivée, encaissement idempotent, historique véhicule. `useSafeAction()` renvoie une Promise et toutes les actions asynchrones sont attendues.
- `Dashboard`, `Clients`, `Employees`, `metrics.ts` : statuts EN ; commissions = lavages `ready` **ou** `delivered`, chacun compté **une seule fois**.

Aucune fonctionnalité de la liste §3.1 de l'audit n'a disparu : prix figés, encaissement partiel, reste à payer, annulation tracée, rapports/CSV, commissions, caisse et dépenses restent opérationnels.

---

## 4. Tests

| Niveau | Résultat |
| --- | --- |
| `npm run check` (local, à la livraison P05) | **154 OK / 0 KO** · **167 OK / 0 KO après P06** |
| `WG_DATA_SOURCE=supabase npm run check` | **155 OK / 0 KO à la livraison P05** · **168 OK / 0 KO après P06** |
| Intégration distante `supabase/tests/p05_rollback.sql` | **17/17 vrai**, `BEGIN … ROLLBACK` |
| Après rollback | `0` compte Auth, `0` fiche, `0` entreprise de test ; 23 migrations à la livraison P05, 29 après P06 |

La section `[9]` de `scripts/check.cjs` couvre 14 contrôles : mapping FR→EN + historique initial, `ready ≠ delivered`, état machine, absence de double comptage, migrations 021/022/023, catalogue/clients serveur, Promises attendues, `DataAdapter` étendu, projection du board, commandes RPC sans tenant ni secret, et le parcours local complet avec **contrôle qualité obligatoire** (création → prix figé → qualité → prêt → livré → annulation motivée).

Le script distant couvre en plus : création avec affectation + véhicule + 2 événements d'historique, prix inchangé après modification de grille, idempotence de fiche et de paiement, **contrôle qualité obligatoire** (`ready` direct `23514`) puis approbation, postes `stationId` et création sur station explicite, clients A/B 0 fuite, `delivered_at`, transition interdite, **isolation A/B 0 fuite** (`my_wash_board` et RPC), `P0002` inter-tenant, historique véhicule et écriture directe refusée (`42501`).

---

## 5. Limites et prochaine étape

- La **caisse, les dépenses et les commissions** sont désormais branchées sur RPC en P06 ([finance.md](finance.md)) ; le catalogue, l'abonnement et les paramètres restent des écritures locales. `metrics.result` a été supprimé au profit de `partialBalance` + `costsMissing`.
- `wash_number_seq` reste globale avec `UNIQUE (station_id, number)` ; raffinement reporté.
- Le contrôle qualité est obligatoire **des deux côtés** : `WASH_STATUS_FLOW` interdit `quality_check → ready` à l'UI, `recordQualityCheck()` est l'unique exception locale, et la migration `023` fait refuser tout `ready` direct par `transition_wash_status` (`23514`). Seule `record_wash_quality_check()` pose le GUC transactionnel `washguard.quality_approved` qui autorise l'approbation.
- Aucun navigateur réel/Playwright à la livraison P05 : smoke HTTP de preview uniquement ; 15 specs Playwright et CI livrées au Prompt 10.
- **Le Prompt 06 est livré ; arrêt avant le Prompt 07 : une validation explicite est requise avant toute action P07+.**
