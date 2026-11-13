# LAVAUTO — Prompt 09 : analytics, quotas et administration SaaS

> **Préparation locale ultérieure :** `057`, non déployée, ajoute les droits de formule, la lecture seule et les quotas UTC incluant les réservations. Les coûts avancés sont masqués en Standard, y compris dans les projections privilégiées. Le tableau plateforme signale l’échéance et les limites manquantes. Le reste de ce document décrit la livraison historique P09 ; voir [subscriptions.md](subscriptions.md) pour le contrat actuel de la branche.

**Date :** 12/11/2026 · **Branche :** `arena/868cde36-lavauto` · **Projet :** `lavauto` (`cgxrqorwmmcyqescatzs`) · **Statut :** P09 livré ; P10 livré ensuite sur `p10_complet` + `levee_totale` (voir [deployment.md](deployment.md)).

Ce document décrit la livraison réelle du **Prompt 09** (phase 8 de [`migration-roadmap.md`](migration-roadmap.md)). Les migrations `001`–`038` restent figées : aucune n'a été réécrite ni réappliquée. Les six migrations `039`–`044` sont strictement additives, sans nouvelle table métier, sans fixture persistante, sans compte Auth, sans e-mail, sans secret, sans bucket Storage, sans fournisseur ni envoi.

---

## 1. Périmètre livré

| Exigence | Livraison |
| --- | --- |
| Vues / fonctions analytiques | `v_station_daily_activity`, `v_company_quota_usage`, `my_analytics_board()`, `my_subscription_usage()` |
| Limites et plans administrables côté serveur | `current_plan_limit()`, `assert_subscription_limit()`, 3 triggers `BEFORE INSERT`, `admin_save_plan()`, `admin_set_plan_limit()` |
| Dashboard station | `Dashboard.tsx` : tendance Recharts du mois et lien vers la consolidation |
| Dashboard consolidé | `Consolidation.tsx` : comparaison de périodes, définitions partagées, courbes, classement, détail par station |
| Graphiques | `recharts@2.15.4` (paire React 16–19), dimensions fixes pour un rendu déterministe, aucune animation |
| Comparaison de périodes | `my_profitability()` appelé avec les MÊMES définitions sur la période courante et la période comparée ; `compareDelta = revenue courante − revenue comparée` |
| Classement des stations | Par chiffre d'affaires, jamais par bénéfice net ; `grossMargin` et `result` restent `NULL` par station |
| Back-office super admin | `my_platform_board()` + 4 commandes : entreprises, abonnements, suspension, quotas/formules, journaux |
| Tests SQL | [`supabase/tests/p09_rollback.sql`](../supabase/tests/p09_rollback.sql), `BEGIN … ROLLBACK`, **30/30 `ok=true`** |
| Frontend / scripts / docs | `src/lib/analytics.ts`, `SupabaseAnalyticsCommands.ts`, `Consolidation.tsx`, `Platform.tsx`, `Subscription.tsx`, `check.cjs` `[13]`, `lint.cjs` 24 règles, ce document, README et CHANGELOG |

Les tarifs **0 / 15 000 / 35 000 FCFA** restent des **hypothèses commerciales** : ils sont stockés dans `plans`, administrables depuis le back-office et doivent être validés sur le terrain ivoirien avant facturation. Le frontend ne contient aucun prix caché en repli serveur.

---

## 2. Base de données : migrations 039 → 044

| Migration | Contenu |
| --- | --- |
| [`039_analytics_foundation.sql`](../supabase/migrations/039_analytics_foundation.sql) | 5 permissions (`analytics.view`, `analytics.compare`, `platform.plans.manage`, `platform.companies.manage`, `platform.quotas.manage`), 10 liaisons RBAC, 4 index de période, 2 vues `security_invoker=true`, `REVOKE anon`, `GRANT SELECT authenticated`. |
| [`040_quota_guard.sql`](../supabase/migrations/040_quota_guard.sql) | `current_plan_limit()`, `subscription_usage_snapshot()`, `assert_subscription_limit()`, `enforce_subscription_limit()`, `refresh_subscription_usage()` et 3 triggers sur `stations`, `user_profiles`, `washes`. |
| [`041_analytics_board.sql`](../supabase/migrations/041_analytics_board.sql) | `my_analytics_board()` et `my_subscription_usage()` ; `my_profitability()` comme unique source des définitions ; tendances quotidiennes ; classement par CA ; aucun résultat net par station. |
| [`042_platform_commands.sql`](../supabase/migrations/042_platform_commands.sql) | `my_platform_board()` et 4 commandes administratives : formule, quota, abonnement, suspension. Chaque opération écrit une ligne dans `platform_audit_logs`. |
| [`043_analytics_hardening.sql`](../supabase/migrations/043_analytics_hardening.sql) | 8 RPC utilisateur exposées à `authenticated`, 4 helpers internes révoqués, 0 grant `anon`, écritures directes révoquées sur `plans`, `plan_limits`, `subscriptions`, `subscription_usage`, `companies`, `platform_audit_logs`. |
| [`044_quota_snapshot_fix.sql`](../supabase/migrations/044_quota_snapshot_fix.sql) | Correctif additif du snapshot d'usage : le comptage des employés référence sans ambiguïté l'entreprise de la ligne, sans réappliquer `039`–`043`. |

**État distant final** (introspection complète `6d84ccd1-073d-4a12-abf9-3169044b561b`, après `0af4224c-ae80-4476-8b5d-0196bbced962`) : **44 migrations**, **69 tables publiques**, **2 vues analytics**, **48 permissions**, **112 liaisons `role_permissions`**, **12 RPC P09**, **3 triggers de quota**, `anon_granted = 0`, **0** compte Auth, entreprise, client, lavage, ligne d'usage ou journal après rollback. La formule `essai` conserve son nom et sa limite d'origine (`100 lavages/mois`) : le test qui la modifie est annulé.

---

## 3. Contrat serveur

`my_analytics_board(p_start, p_end, p_compare_start, p_compare_end)` refuse :

- une période inversée ou supérieure à **92 jours** (`23514`) ;
- une comparaison incomplète ou inversée (`23514`) ;
- un appel sans `analytics.view` **et** `reports.view` (`42501`).

Le board expose `period`, `compare`, `compareDelta`, `stations`, `rankings`, `trend`, `definitions`, `stats` et `rules`, en camelCase, sans identifiant brut de tenant. `partialBalance = collected − expenses` reste un **solde partiel**, PAS un bénéfice net. `grossMargin` et `result` ne sont publiés que par `my_profitability()` lorsque la période est certifiée ; le détail par station garde ces deux champs à `NULL`.

`my_subscription_usage()` relit les limites côté serveur : aucune limite n'est acceptée depuis le navigateur. `refresh_subscription_usage()` dérive les compteurs des données réelles et n'écrit aucune donnée fabriquée.

`my_platform_board()` est réservé à `is_platform_admin()` : un tenant reçoit `42501`. Les commandes `admin_*` vérifient en plus la permission métier correspondante et journalisent l'acteur, l'action, l'entité et le détail.

---

## 4. Frontend

- [`src/lib/analytics.ts`](../src/lib/analytics.ts) : types, projections serveur, board local, comparaison de même durée, `emptyAnalyticsBoard()`, `platformBoardFromState()`, `subscriptionUsageFromState()`.
- [`src/services/adapters/DataAdapter.ts`](../src/services/adapters/DataAdapter.ts) : 3 lectures de board et 5 commandes du back-office.
- [`SupabaseAnalyticsCommands.ts`](../src/services/adapters/SupabaseAnalyticsCommands.ts) : 5 RPC avec arguments `p_*`, aucun `company_id` dans le code frontend.
- [`LocalDataAdapter.ts`](../src/services/adapters/LocalDataAdapter.ts) : `analyticsCommands = null`, calcul local sur l'état réellement enregistré.
- [`SupabaseDataAdapter.ts`](../src/services/adapters/SupabaseDataAdapter.ts) : `my_analytics_board`, `my_subscription_usage`, `my_platform_board`.
- [`src/lib/store.tsx`](../src/lib/store.tsx) : `serverAnalytics`, `analyticsBoard`, `subscriptionUsage`, `platformBoard`, `refreshAnalytics()`, `refreshSubscriptionUsage()`, `refreshUsageCounters()`, `refreshPlatform()`, `savePlan()`, `setPlanLimit()`, `setCompanySubscription()`, `setCompanySuspended()`.
- [`Dashboard.tsx`](../src/pages/Dashboard.tsx) : graphique de tendance station.
- [`Consolidation.tsx`](../src/pages/Consolidation.tsx) : nouvelle route `/app/consolidation`, 4 champs de dates, actualisation, courbes `LineChart`, classement `BarChart`, comparaison, définitions et détail par station.
- [`Platform.tsx`](../src/pages/Platform.tsx) : entreprises, abonnement, suspension, édition des formules, édition des quotas, compteurs d'usage et journal plateforme.
- [`Subscription.tsx`](../src/pages/Subscription.tsx) : usage et limites relus depuis le board serveur, mention explicite des hypothèses commerciales.
- [`permissionCatalog.ts`](../src/lib/permissionCatalog.ts) : 48 permissions, `/app/consolidation` protégée par `analytics.view`, 3 permissions SaaS réservées au super admin.
- [`navigation.tsx`](../src/components/navigation.tsx) : 18 URL `/app` à la livraison P09, entrée « Consolidation multi-stations » active, entrée désactivée « Prévisions & alertes » remplacée en P10 par la 19e route active « Qualité & déploiement ».

`recharts@2.15.4` est la seule dépendance runtime ajoutée (6 dépendances, 10 devDependencies). Aucune migration vers Recharts v3, aucun `react-is`, aucun `npm audit fix --force`, aucun React Router v7.

---

## 5. Test distant

[`supabase/tests/p09_rollback.sql`](../supabase/tests/p09_rollback.sql) s'exécute tel quel en `BEGIN … ROLLBACK` via `execute_query` `49e35fab-f4c7-4711-bce3-870ff5ada718` : **30/30 `ok=true`**. Il couvre :

1. 44 migrations, 0 fixture, 48 permissions, 112 liaisons, 2 vues, 69 tables ;
2. 12 RPC `SECURITY DEFINER`, 8 exposées à `authenticated`, 0 grant `anon`, 3 triggers ;
3. écritures directes révoquées et vues `security_invoker` sans `SELECT anon` ;
4. formule `essai` administrable, quota fixé à 2 lavages/mois, journal `plan.saved` / `plan.limit` ;
5. 2 lavages du tenant A autorisés, 3e refusé `23514`, 1 lavage du tenant B autorisé ;
6. isolation A/B des fiches, de la vue de quota, du board analytics et du back-office ;
7. comparaison `0 → 10 000`, delta `10 000`, mêmes définitions, tendance calendaire ;
8. aucun résultat net par station, `costsMissing=true`, `grossMargin`/`result` `NULL` ;
9. comparaison incomplète et période de 100 jours refusées `23514` ;
10. back-office refusé au tenant `42501`, puis 2 entreprises, 3 formules, 9 limites, 6 lignes d'usage, 4 journaux, 1 suspension, 0 quota dépassé pour le super admin ;
11. abonnement `standard/active`, suspension sans suppression, 4 actions journalisées par le super admin.

Après rollback, l'introspection finale confirme 0 donnée résiduelle et la limite d'origine de la formule `essai`.

---

## 6. Vérifications locales et limites

Vérifications finales : `npm run typecheck` **0 erreur** ; `npm run lint` **24 / 24** ; `npm run check` **212 OK / 0 KO · local** ; `WG_DATA_SOURCE=supabase npm run check` **213 OK / 0 KO · supabase** ; `npm run build` **504 modules transformés**, `index-DzILDpb9.js` **1 275,79 kB** / gzip **329,51 kB**, CSS **31,93 kB** / gzip **7,49 kB** ; preview `0.0.0.0:5173` : 21 URL `200` (dont les 18 `/app`), hôte `evil.example.com` `403`, hôte `.e2b.app` `200` ; `git diff --check` propre. Vite signale un chunk supérieur à 500 kB du fait de Recharts : l'optimisation par découpe dynamique est reportée au Prompt 10.

**Limites à la livraison P09, levées en P10 :** aucun compte Auth, e-mail, secret, clé API, bucket Storage, fournisseur de communication, envoi réel ou simulé, navigateur réel / Playwright, commit ou PR. Aucune migration `001`–`038` réappliquée. Le Prompt 10 a ensuite été engagé sur validation explicite : voir [deployment.md](deployment.md) et [testing.md](testing.md).
