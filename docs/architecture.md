# LAVAUTO — Architecture

**Date :** 12/11/2026 · **Statut :** P10 livré · **49 migrations / 70 tables / 2 vues / 19 URL `/app`**.

## 1. Vue d’ensemble

```text
Navigateur React 19 + Vite 8
  ├── StoreProvider (src/lib/store.tsx)
  │     ├── état métier persisté SANS session
  │     ├── Auth : onAuthStateChange → auth.getUser() → my_context()
  │     └── boards P05–P10 : wash, finance, stock, CRM, analytics, QA
  ├── DataAdapter (local | supabase)
  │     ├── LocalDataAdapter : calculs sur l’état réel
  │     └── SupabaseDataAdapter : RPC SECURITY DEFINER, aucun company_id
  └── React.lazy / Suspense (P10)
        └── écrans lourds chargés à la demande

Supabase
  ├── Auth + RBAC (user_profiles, roles, permissions, role_permissions)
  ├── PostgreSQL 17 : RLS sur 100 % des tables métier
  ├── RPC P05–P10 : lavages, finance, stock, CRM, analytics, QA
  ├── Storage : bucket privé station-assets + policies RLS
  └── platform_audit_logs / rpc_idempotency_keys

CI/CD
  ├── GitHub Actions : typecheck, lint, check ×2, Vitest, build, Playwright
  └── Vercel : build, rewrites SPA, en-têtes de sécurité, secrets
```

## 2. Principes invariants

- **Aucun identifiant brut de tenant côté navigateur** : `company_id` est toujours dérivé de `auth.uid()` par `current_company_id()`.
- **Aucune écriture directe** sur les tables sensibles : les commandes passent par des RPC `SECURITY DEFINER` avec `search_path` figé.
- **Définitions métier uniques** : `my_profitability()` reste la source de `partialBalance`, `grossMargin` et `result` ; les classements P09 se font par chiffre d’affaires, jamais par bénéfice net.
- **Isolation A/B** vérifiée en `BEGIN … ROLLBACK` à chaque phase, sans fixture persistante.
- **Aucune donnée fabriquée** : les tendances, compteurs et classements sont dérivés des lignes réellement enregistrées.

## 3. Apports du Prompt 10

| Couche | Livraison |
| --- | --- |
| DB | 5 index `ix_p10_*`, `my_washes_page()`, `station_asset_path()`, `claim_rpc_idempotency()`, `my_qa_board()`, table `rpc_idempotency_keys`, bucket privé, 5 policies objets + 5 policies buckets dont 5 gardes `RESTRICTIVE`. |
| Frontend | `src/lib/network.ts` (retry exponentiel, `NetworkError`, clé d’idempotence), `src/lib/qa.ts`, `src/pages/Quality.tsx`, lazy loading, 19e route `/app/qualite`. |
| Tests | 15 specs Playwright, 15 parcours JSDOM, 16 tests Vitest, `supabase/tests/p10_rollback.sql`, 3 `EXPLAIN ANALYZE`. |
| Déploiement | `vercel.json`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, 7 documents. |

## 4. Chaîne de données P10

1. `Quality.tsx` appelle `fetchQaBoard()` → `my_qa_board()` lit les compteurs du schéma.
2. `fetchWashesPage(limit, offset)` → `my_washes_page()` applique `LIMIT/OFFSET` côté serveur, 100 lignes maximum.
3. `uploadStationLogo(file)` génère une clé, appelle `claim_rpc_idempotency()`, redimensionne/recompresse le logo en WebP 512 px via `optimizeStationLogo()`, demande le chemin à `station_asset_path()`, puis `upsert` dans le bucket privé et obtient une URL signée.
4. `withRetry()` ne rejoue que les pannes réseau / 5xx / 429, jamais les erreurs métier `23514` ou `42501`.

## 5. Limites conservées

Aucun compte Auth persistant, e-mail, secret, clé API, bucket public, fournisseur d’envoi ni secret versionné. Les 15 specs Playwright ont été exécutées dans un Chromium headless empaqueté récupéré depuis npm, sans versionner le binaire ; la PR #3 a été fusionnée dans `main` (`f6f6301`) avec `quality`, `Vercel` et `Vercel Preview Comments` **pass**, et `site_url` / allow-list Auth pointent désormais sur `https://lavauto-five.vercel.app`. Le déploiement de production effectif reste conditionné aux secrets GitHub/Vercel et aux origines CORS Supabase ; `deploy.yml` a été corrigé et validé. `npm audit fix --force` reste reporté. Les grants Storage historiques de `supabase_storage_admin` ne sont pas révoquables depuis le rôle de migration : la garde `050` est donc une RLS restrictive qui filtre 100 % des lignes pour `anon`. Le module « Prévisions & alertes » n’est pas livré : le libellé historique a été remplacé par l’écran réel « Qualité & déploiement ».

Voir [database.md](database.md), [security.md](security.md) et [deployment.md](deployment.md).
