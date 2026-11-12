# LAVAUTO — Architecture

**Date :** 12/11/2026 · P10 historique : **49 migrations / 70 tables / 2 vues / 19 URL `/app`**. Depuis, `051` (logo) et `052` (création atomique) ont été appliquées sur `lavauto` via le connecteur : 51 migrations enregistrées et 71 tables sous RLS vérifiées à distance. Le reçu, `053`–`055` et les fonctions Meta ne sont pas déployés en production ; un aperçu Vercel est créé automatiquement pour la PR, sans envoi réel. La recette Auth/Storage et métier réelle reste à faire.

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
  ├── Reçu : instantané local + impression isolée / PDF dans le navigateur
  ├── WhatsApp : RPC consentement, demande et journal sans secret fournisseur
  └── React.lazy / Suspense (P10)
        └── écrans lourds chargés à la demande

Supabase
  ├── Auth + RBAC (user_profiles, roles, permissions, role_permissions)
  ├── PostgreSQL 17 : RLS sur 100 % des tables métier
  ├── RPC P05–P10 : lavages, finance, stock, CRM, analytics, QA
  ├── Storage : bucket privé station-assets + policies RLS
  ├── 053 locale : consentement, file et journal WhatsApp séparés de la file CRM
  ├── 054/055 locales : périmètre station, agrégats, validation et finance
  ├── Edge non déployées : dispatch authentifié + webhook Meta HMAC
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
| Tests P10 historiques | 15 specs Playwright, 15 parcours JSDOM, 16 tests Vitest, `supabase/tests/p10_rollback.sql`, 3 `EXPLAIN ANALYZE`. Voir [testing.md](testing.md) pour la branche actuelle. |
| Déploiement | `vercel.json`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, 7 documents. |

## 4. Chaîne de données P10

1. `Quality.tsx` appelle `fetchQaBoard()` → `my_qa_board()` lit les compteurs du schéma.
2. `fetchWashesPage(limit, offset)` → `my_washes_page()` applique `LIMIT/OFFSET` côté serveur, 100 lignes maximum.
3. `uploadStationLogo(file)` valide format et taille, génère une clé, appelle `claim_rpc_idempotency()`, optimise en WebP jusqu’à 512 px si possible et plus léger, demande un chemin unique à `station_asset_path()` puis envoie l’objet privé. En cas d’échec du codec ou de compression non avantageuse, le fichier d’origine est conservé. Cette fonction ne retourne pas d’URL.
4. `withRetry()` ne rejoue que les pannes réseau / 5xx / 429, jamais les erreurs métier `23514` ou `42501`.

## 5. Association et aperçu du logo (migration 051)

- `StationLogoEditor` est partagé par Paramètres et Mise en route. Après l’envoi, `save_station_logo(stationId, path)` vérifie `settings.manage`, l’accès à la station et l’existence de l’objet dans le dossier de l’entreprise, puis persiste `stations.logo_path`. Une contrainte et un trigger couvrent aussi les écritures directes ; trois policies Storage restrictives protègent les écritures du bucket.
- `my_context()` restitue le chemin de chaque station accessible. L’état navigateur n’enregistre jamais l’URL signée. `useStationLogoUrl()` demande une URL valide une heure à l’affichage, la renouvelle avant expiration et propose une nouvelle tentative en cas d’erreur.
- L’association n’est modifiée qu’après confirmation du serveur. L’ancien objet reste dans le bucket lors d’un remplacement ou d’un retrait ; un envoi suivi d’un échec d’association peut également laisser un objet non associé. Les anciennes colonnes `logo_url` restent intactes en base, mais les URL ne sont plus affichées ni réutilisées par le frontend.
- `051` a été appliquée sur `lavauto` et ses objets principaux ont été vérifiés à distance. Les tests PostgreSQL isolés utilisent une simulation d’Auth et Storage ; la recette sur les véritables API et le déploiement du frontend de cette branche restent à effectuer.

## 6. Création de fiche et paiement initial (migration 052)

`SupabaseWashCommands.createWash()` envoie une seule RPC `create_wash_atomic` : la réservation d’idempotence, la fiche, les affectations et le paiement initial éventuel sont dans la même transaction. La clé est unique par entreprise et le serveur vérifie aussi utilisateur, station et condensat SHA-256 de la commande. Un rejeu identique renvoie la même fiche ; un contenu différent ou une collision historique est refusé. Les prix et règles de paiement sont relus côté serveur. Les anciennes RPC restent disponibles pour les anciens clients, sans atomicité entre elles.

Avant envoi, le frontend conserve la commande exacte et sa clé dans `sessionStorage`. Un refus explicite dès le premier essai l’efface ; une réponse incertaine, ou un refus après une incertitude, la conserve et bloque une nouvelle création dans ce contexte. La reprise exige le même onglet, compte et station ; un stockage effacé ou illisible nécessite une vérification manuelle. La conservation temporaire comprend les données saisies sur la fiche : protéger le poste et ne pas partager la session.

La migration `052` conserve aussi Wave, Orange Money et MTN comme canaux distincts. Le rapprochement du nouveau frontend indique un aperçu limité aux fiches chargées et utilise l’attendu serveur figé après saisie du comptage. La recette distante de ces parcours reste à effectuer. Tests et limites : [testing.md](testing.md), [finance.md](finance.md).

## 7. Limites conservées

La remise maximale du caissier et les règles/modifications de barèmes dans Paramètres restent locales ; la base connectée ne contrôle pas ce plafond et ne reçoit pas ces réglages. Les notes de changement d’abonnement ne sont pas transmises au serveur. La gestion des paiements ultérieurs après réponse perdue demeure distincte et non sécurisée par la reprise de création.

Aucun compte Auth persistant, e-mail, secret, clé API, bucket public, fournisseur d’envoi ni secret versionné. Les 15 specs Playwright ont été exécutées dans un Chromium headless empaqueté récupéré depuis npm, sans versionner le binaire ; la PR #3 a été fusionnée dans `main` (`f6f6301`) avec `quality`, `Vercel` et `Vercel Preview Comments` **pass**, et `site_url` / allow-list Auth pointent désormais sur `https://lavauto-five.vercel.app`. Le déploiement de production effectif reste conditionné aux secrets GitHub/Vercel et aux origines CORS Supabase ; `deploy.yml` a été corrigé et validé. `npm audit fix --force` reste reporté. Les grants Storage historiques de `supabase_storage_admin` ne sont pas révoquables depuis le rôle de migration : la garde `050` est donc une RLS restrictive qui filtre 100 % des lignes pour `anon`. Le module « Prévisions & alertes » n’est pas livré : le libellé historique a été remplacé par l’écran réel « Qualité & déploiement ».

Voir [database.md](database.md), [security.md](security.md) et [deployment.md](deployment.md).
