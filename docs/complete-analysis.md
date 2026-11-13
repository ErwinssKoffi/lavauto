# WashGuard / LAVAUTO — analyse complète

**Date :** 13/11/2026 · **Branche :** `arena/75df6d44-lavauto` · **Base :** `3a405bc` (`feat: implement PWA support and offline capabilities`)
**Méthode :** tout ce qui suit a été **exécuté** dans le sandbox (`npm ci`, `npm run typecheck|lint|check|test:unit|build`, démarrage réel du serveur Express, appels HTTP réels sur un parcours complet). Les constats sont reproductibles ; les commandes exactes sont données au §7.

---

## 0. Verdict en une page

| Axe | Note | Commentaire |
| --- | --- | --- |
| Ambition et couverture fonctionnelle | ★★★★☆ | 28 routes, 51 endpoints, 59 migrations SQL, 270 tests unitaires. Périmètre métier réellement impressionnant (caisse, stock, CRM, commissions, abonnements, multi-stations). |
| Qualité du code frontend | ★★★★☆ | TypeScript strict, 0 `any`, 0 TODO, découpage propre (`lib/` pur, `services/adapters/`, `pages/`), garde-fous statiques maison. |
| Qualité du backend | ★★☆☆☆ | Le backend « `api` » (Express + PGlite, ~2 800 lignes) est une **couche parallèle non testée** qui ne partage ni le schéma ni les règles du backend Supabase. |
| Sécurité | ★☆☆☆☆ | **Faille critique d'usurpation de compte** reproductible en 3 requêtes (§3.1), aucun rate limiting, aucun en-tête de sécurité côté app. |
| Intégrité des données | ★★☆☆☆ | Le métier vit dans un unique blob `JSONB` réécrit en entier à chaque mutation, sans verrou (perte d'écritures concurrentes), sans audit. |
| CI/CD | ★☆☆☆☆ | Le pipeline est **rouge sur `main`** et le serait sur cette branche : `npm ci` échoue, `npm run check` échoue, `npm run test:unit` échoue. |
| Documentation | ★★★☆☆ | Volume énorme (3 200 lignes) et rarement malhonnête, mais **décrit un système qui n'est pas celui du code** (le mode `api` n'est documenté nulle part). |

**Conclusion.** Ce dépôt n'est pas un prototype : c'est un produit déjà très travaillé côté interface et modèle métier. Le problème n'est pas le volume de fonctionnalités, c'est que **trois backends coexistent** (local/navigateur, `api`/PGlite, `supabase`) et que le mode réellement actif par défaut (l'IA API) est le moins sûr, le moins testé et le seul qui n'est pas documenté. La priorité absolue n'est pas d'ajouter des écrans, c'est de **choisir un backend, le sécuriser, et faire repasser la CI au vert**.

---

## 1. Ce qu'est réellement le produit

### 1.1 Trois sources de données, pas deux

`src/services/adapters/DataAdapter.ts` expose `resolveDataSource()` avec **trois** valeurs : `local`, `api`, `supabase`.

| Source | Implémentation | Persistance | Utilisée par |
| --- | --- | --- | --- |
| `local` | `LocalDataAdapter` (enveloppe `store.tsx`, 3 249 lignes) | `localStorage` | Tests Playwright, démos |
| **`api`** | `ApiDataAdapter` → `server/routes.ts` (2 807 lignes) + `server/db.ts` | PGlite (Postgres 18 WASM) sur disque | **Défaut réel** (`vite.config.ts` définit `VITE_DATA_SOURCE='api'`) |
| `supabase` | `SupabaseDataAdapter` + 59 migrations SQL | PostgreSQL Supabase + RLS | `deploy.yml` (production) |

Or **aucun document ne mentionne le mode `api`** : `grep -rl "ApiDataAdapter" docs/ README.md CHANGELOG.md` → 0 résultat. La consigne documentaire est d'attendre des migrations Supabase appliquées, alors que le code vire au serveur Express par défaut ; `README.md` affirme même « `local` par défaut ». Un développeur qui reprend le dépôt sera désorienté.

### 1.2 Le mode `api` n'est pas le schéma Supabase

- `server/db.ts` crée **15 tables**, la plupart des **objets métier n'existent pas** (`clients`, `washes`, `cash_sessions`, `products`…).
- Tout le métier (`washes`, `cashSessions`, `expenses`, `stockLevels`, `auditLogs`…) est stocké dans **une seule colonne** `tenant_states.state_json` (`JSONB`).
- Colonnes réellement en base : seulement **6 tables communes** avec Supabase (`companies`, `stations`, `users`, `subscriptions`, `plans`, `plan_limits`).
- **Conséquence :** un tenant créé en mode `api` ne peut pas être repris en mode `supabase`, et les deux backends ne garantissent ni les mêmes règles ni les mêmes contraintes. Le « contrat `DataAdapter` » masque une divergence de modèle complète.

---

## 2. Constats vérifiés par exécution

### 2.1 La CI est cassée (bloquant)

```
npm ci                 → FAIL  (package-lock.json désynchronisé avec package.json)
npm run typecheck      → OK
npm run lint           → OK (26 règles)
npm run check          → FAIL  (exit 1)
npm run test:unit      → FAIL  (1 test / 270)
npm run build          → OK
```

1. **`npm ci` échoue** : `express@5.3.0`, `tsx@4.23.15`, `vite-plugin-pwa@2.0.0`, `@types/express@5.0.6`… absents du lock. C'est exactement l'étape qui échoue dans le run CI sur `main` (`X Install`, job `quality`, 13 s).
2. **`npm run check` échoue** : `scripts/check.cjs` compile `src/main.tsx` avec esbuild, qui ne sait pas résoudre `virtual:pwa-register` (importé par `main.tsx`). Seul le test DOM est touché ; les familles logique et gardes passent. **Aucune assertion n'a été adaptée à l'ajout du PWA.**
3. **`npm run test:unit` échoue** : `tests/unit/dashboard-sparklines-pwa.test.ts` monte `ResponsiveContainer` (Recharts) dans JSDOM, où **`ResizeObserver` n'existe pas**. `tests/setup.ts` fournit un polyfill pour `navigator.locks` mais pas pour `ResizeObserver`.

Aucun de ces trois points n'est très coûteux à corriger, mais ensemble ils expliquent pourquoi `main` est rouge et rendent la règle de non-régression du dépôt (« laisser `npm ci && …` vert ») inopérante.

### 2.2 Faille critique : usurpation de n'importe quel compte (mode `api`)

`POST /api/auth/forgot-password` **renvoie le lien de réinitialisation dans le corps de la réponse**, à un appelant non authentifié :

```http
POST /api/auth/forgot-password  {"email":"awa2@example.ci"}
→ 200 {"ok":true,"resetUrl":"/reinitialiser-mot-de-passe?token=2934fe8f…"}
```

`src/pages/auth/ForgotPassword.tsx` affiche même ce lien dans un `<a>` (« Ouvrir le lien de réinitialisation »), et `Employees.tsx` fait de même pour les autres comptes. J'ai exécuté la chaîne complète : récupérer le jeton → `POST /api/auth/reset-password` → se connecter avec le mot de passe choisi par l'attaquant. **Succès en 3 requêtes, sans accès à la boîte mail de la victime.** Prendre le contrôle du propriétaire donne accès à toutes les données de l'entreprise.

C'est un choix acceptable pour une démo locale explicitement signalée, mais ici :
- rien n'indique à l'utilisateur que le lien est une **simulation** (contrairement au mode `local`, qui affiche « Aucun e-mail de récupération n'est envoyé sans serveur connecté ») ;
- le mode `api` est le mode par défaut ;
- `deploy.yml` pousse le frontend en production, donc si un jour `api` est déployé, la faille part avec.

Correctif minimal : ne renvoyer `resetUrl` **que si** `NODE_ENV !== 'production'` **et** un drapeau explicite (`WASHGUARD_DEMO_RESET=1`), sinon répondre `{ok:true}` sec, logger rien, et prévoir l'envoi d'e-mail hors périmètre.

### 2.3 Le mode `local` contourne encore des règles serveur — par conception

- `POST /api/washes/create` exige une caisse ouverte pour les espèces (`cash_closed`) → **bien**.
- Le mode `local` simule la même règle dans `store.tsx` (`assertCashRule`), mais **le navigateur est seul juge** : effacer `localStorage`, ou appeler les fonctions directement, suffit à « encaisser » sans caisse. C'est documenté honnêtement (`docs/security.md`), mais cela reste un piège si un opérateur utilise le mode `local` en station.

### 2.4 Intégrité des données du mode `api`

- **Réécriture intégrale** : chaque mutation fait `loadTenantDoc()` → mutation en mémoire → `saveTenantDoc()` (14 `saveTenantDoc`, 5 `loadTenantDoc`). Deux caissiers qui encaissent au même moment sur la même station écrasent mutuellement leurs fiches. Le verrou `withCompanyLock` existe pour certaines opérations seulement.
- **Aucune contrainte de base** sur les montants, statuts ou agrégats : tout est validé par du code applicatif dans `server/routes.ts`.
- **Journal d'audit quasi inexistant** : `logAudit` est appelé **6 fois**, toutes réservées au back-office plateforme. Aucune des 14 écritures métier (lavage, paiement, dépense, caisse) n'est journalisée côté `api`, alors que `57` migrations Supabase construisent un `audit_logs` append-only. `/api/qa/board` et `/api/platform/board` exposent donc des compteurs d'audit vides, affichés dans l'écran « Qualité & déploiement ».

### 2.5 Fichiers générés versionnés

`.washguard/pgdata` est **suivi par Git** (131 fichiers, dont `global/pg_control`, `base/*`, et un `postmaster.pid` fantôme pointant `/pglite/data`).

Conséquence démontrée : sur un clone neuf, `PGlite.create('.washguard/pgdata')` échoue avec

```
FATAL: could not open directory "pg_notify": No such file or directory
→ [WashGuard DB] Fallback memory:// PGlite
```

`server/db.ts` avale l'erreur et bascule **silencieusement en mémoire**. J'ai donc : créé un compte (`201`), constaté la disparition du compte au redémarrage (`/auth/me` → `null`, `signin` → `401`). Le démarrage affiche un simple `console.warn`, jamais remonté dans `/api/health`. **Toute donnée saisie dans un clone neuf est perdue au premier redémarrage, sans message dans l'UI.** `.gitignore` ignore `node_modules`, `dist`, `.env`, mais pas `.washguard/`.

### 2.6 Autres points de sécurité (mode `api`)

| Gravité | Constat |
| --- | --- |
| 🔴 | `forgot-password` renvoie le jeton (§2.2) |
| 🟠 | **Aucun rate limiting** sur `/auth/signin`, `/auth/signup`, `/auth/reset-password` (aucune dépendance `express-rate-limit`, aucun compteur d'échecs). Brute-force trivial. |
| 🟠 | **Aucun en-tête de sécurité** sur les réponses de l'app (`helmet` absent) ; `vercel.json` pose `X-Frame-Options`/`nosniff` mais uniquement côté Vercel. |
| 🟠 | **Aucune révocation de session** après changement/réinitialisation de mot de passe : j'ai réinitialisé le mot de passe et l'ancienne session `wg_session` répondait encore `200` sur `/auth/me`. |
| 🟡 | Cookie de session : `HttpOnly; SameSite=Lax`, `Secure` en production — correct, mais pas de préfixe `__Host-`, et le jeton transite aussi en `Authorization: Bearer`. |
| 🟡 | `express.json({limit:'2mb'})` + `express.raw({limit:'6mb'})` sur l'upload logo, sans contrôle du type réel (magic bytes) ; le MIME du client est stocké et renvoyé tel quel. |
| 🟡 | `WASHGUARD_SESSION_SECRET` est déclaré dans `.env.example` mais **utilisé nulle part** (`grep` → 0). Le secret de signature n'existe pas : les sessions sont des jetons aléatoires en base, ce qui est acceptable, mais la variable est trompeuse. |
| ✅ | Isolation inter-entreprises : `?stationId=<inconnu>` → `403 station_forbidden`. Le `company_id` est bien dérivé de la session, jamais du client. C'est le gros point fort du backend. |
| ✅ | Rôles : invitation forcée à `gérant/caissier/laveur` (`invalid_role` sinon) ; pas d'escalade possible vers `super_admin`. |

---

## 3. Tests : 270 tests verts, et pourtant

| Suite | Volume | Couverture réelle |
| --- | --- | --- |
| Vitest | 270 tests / 31 fichiers | **Frontend et logique pure uniquement.** |
| `scripts/check.cjs` | 136 `check()` | Rendu DOM, gardes locales, assertions statiques sur les migrations. |
| Playwright | 19 specs | `local` + « Supabase simulé ». |

**Le trou majeur : `tests/` ne teste jamais `server/`.** `grep -rln "server/routes\|server/db" tests/ e2e/` → **0 fichier**. Le backend `api` — celui qui est actif par défaut et qui détient l'authentification, les quotas, la caisse et l'idempotence — n'a **aucun test automatisé**. Les 51 endpoints que j'ai parcourus à la main (signup → setup → activation → caisse → lavage → analytics) ne sont exercés par aucune CI.

Second trou : `npm run check` est **sensible aux caractères exacts** du code (`scripts/check.cjs` vérifie des chaînes SQL, des nombres de migrations « 56 », etc.). C'est un garde-fou utile contre les régressions, mais il se casse dès qu'on refactorise, et il **ne teste pas le comportement** : il compare des textes.

---

## 4. Dette technique — état réel vis-à-vis de `docs/technical-debt.md`

Le registre est de bonne qualité mais **vieilli**. Écarts constatés :

| ID | Registre | Réalité |
| --- | --- | --- |
| TD-04 « aucune table » | ouvert | **Obsolète** : 59 migrations, 80 tables Supabase + 15 tables PGlite. |
| TD-06 « `company_id` depuis le client » | ouvert | **Résolu** côté serveur (`403` vérifié). |
| TD-23 pagination | ouverte | Toujours vraie, et **pire** en mode `api` : le blob entier est renvoyé. |
| TD-29 ESLint/Prettier | ouverte | Toujours vraie : `scripts/lint.cjs` maison, pas d'ESLint. |
| TD-31 `noUnusedLocals:false` | ouverte | Toujours vraie (`tsconfig.json`). |
| TD-36 validation env Zod | ouverte | Toujours vraie ; en plus, `WASHGUARD_SESSION_SECRET` est une variable morte. |
| **TD-39 (nouveau)** | — | **Deux backends divergents** (`api` PGlite vs `supabase`), dont un non documenté et non testé. C'est la dette n°1. |
| **TD-40 (nouveau)** | — | **CI rouge** : lockfile, `virtual:pwa-register`, `ResizeObserver`. |
| **TD-41 (nouveau)** | — | Jeton de reset renvoyé au client + absence de rate limiting + sessions non révoquées. |
| **TD-42 (nouveau)** | — | `tenant_states` JSONB réécrit sans verrou → écritures perdues. |
| **TD-43 (nouveau)** | — | `.washguard/pgdata` versionné → démarrage dégradé silencieux, données volatiles. |

---

## 5. Qualité du frontend (points forts à conserver)

- **TypeScript strict, zéro `any`** (`grep ": any"` → 1), zéro `TODO/FIXME`. C'est rare à ce niveau de volume.
- **Séparation saine** : `lib/` contient des fonctions pures testables (`metrics.ts`, `format.ts`, `financeState.ts`), `services/adapters/` isole les E/S, `pages/` reste déclaratif.
- **Préoccupations métier réelles et bien traitées** : `result`/`grossMargin` à `null` tant que les coûts ne sont pas certifiés (`label: "Coûts manquants : résultat net non calculable"`) — vérifié en direct sur `/api/analytics/board`. Neutralisation de l'injection de formule CSV. Date `aaaa-mm-jj` construite en local pour éviter le décalage UTC.
- **PWA soignée** : manifest complet, `navigateFallbackDenylist: [/^\/api\//]`, NetworkFirst avec `networkTimeoutSeconds`, purge du cache API.
- **Ergonomie de secours** : `ErrorBoundary`, `ConfirmDialog` accessible, `CommandPalette`, breadcrumbs, thème sans flash.

Faiblesses frontend :

- **Bundle principal de 333 ko gzip** : `recharts` est importé par `Dashboard` (route non lazy) et atterrit dans le chunk d'entrée. Seules 7 pages sur 28 sont en `React.lazy`. `jspdf`/`html2canvas` (600 ko) sont bien différés, mais le premier écran reste lourd pour des stations en 3G.
- **`store.tsx` fait 3 249 lignes** (TD-19 toujours valide, et empiré) : état, règles, persistance, toasts, thème et orchestration des 3 backends dans un seul fichier.
- **Tarifs d'abonnement codés en dur** dans `plans.ts` en mode `local`.
- **Textes français en dur** partout (TD-28) : pas de préparation i18n, alors que le produit viserait le multi-pays.

---

## 6. Plan d'action priorisé

### P0 — cette semaine (bloquant production et CI)

1. **Régénérer `package-lock.json`** (`npm install` puis commit du lock) → `npm ci` doit passer. *Sans ça, aucune CI ne peut être verte.*
2. **Réparer `npm run check`** : soit ajouter un alias esbuild `virtual:pwa-register` dans `scripts/check.cjs`, soit isoler l'enregistrement du SW dans un module mockable. Le test DOM doit pouvoir monter `main.tsx`.
3. **Réparer le test Vitest** : ajouter un polyfill `ResizeObserver` dans `tests/setup.ts` (le même endroit où `navigator.locks` est déjà simulé).
4. **Supprimer le jeton de reset de la réponse HTTP** hors mode démo explicite (`WASHGUARD_DEMO_RESET=1` + `NODE_ENV!=='production'`). Retirer le bouton « Ouvrir le lien » de `ForgotPassword.tsx` et `Employees.tsx` quand le mode démo est inactif.
5. **Détracker `.washguard/`** (`git rm -r --cached .washguard`, ajouter au `.gitignore`) et **faire échouer le démarrage bruyamment** si PGlite ne peut pas ouvrir le répertoire configuré, au lieu du `fallback memory://` silencieux. Afficher l'état dans `/api/health` et dans l'UI.

### P1 — 2 à 3 semaines (sécurité et intégrité)

6. **Rate limiting** sur `/auth/*` (par IP + par e-mail, compteur d'échecs, backoff), plus un `helmet` + CSP côté Express.
7. **Révoquer les sessions** (`DELETE FROM sessions WHERE user_id = …`) à chaque reset/changement de mot de passe ; invalider aussi les `action_tokens` en cours.
8. **Décider d'un seul backend.** Recommandation : **`supabase` pour la production, `local` pour la démo et les tests**, et **supprimer (ou rétrograder en outil de développement explicite) le mode `api`**. Aujourd'hui il duplique 51 endpoints pour un modèle de données incompatible. S'il doit rester, il faut au minimum : un verrou par entreprise sur **toutes** les mutations, `logAudit` sur les 14 écritures métier, des tests d'intégration HTTP.
9. **Tests du backend choisi** : au moins 1 parcours `signup → activation → caisse → lavage → paiement` exécuté en CI contre le serveur réel (Vitest + `supertest`-like), et 1 test d'isolation à deux entreprises.

### P2 — ensuite (produit)

10. **Découper `store.tsx`** (TD-19) : la taille du fichier est devenue le premier frein à toute évolution.
11. **Sortir `recharts` du bundle d'entrée** : passer `Dashboard` en `lazy` ou déplacer les graphiques derrière un composant chargé à la demande ; viser < 200 ko gzip.
12. **Mettre la documentation en phase** : ajouter le mode `api` (ou le retirer), corriger « `local` par défaut » dans `README.md`, actualiser `docs/technical-debt.md` (TD-04 et TD-06 sont résolus), et ajouter les IDs TD-39 à TD-43.
13. **Pagination serveur** (TD-23) : le blob `tenant_states` et les réponses `/api/washes/board` renvoient tout.

---

## 7. Comment rejouer cette analyse

```bash
npm install                 # npm ci échoue à la date de l'analyse
npm run typecheck           # OK
npm run lint                # OK
npm run check               # FAIL (virtual:pwa-register)
npm run test:unit           # FAIL (ResizeObserver, 1/270)
npm run build               # OK

# Reproduire la faille d'usurpation (serveur local, mode api)
npm run dev &
curl -s -X POST localhost:3000/api/auth/signup -H 'content-type: application/json' \
  -d '{"companyName":"X","stationName":"Y","phone":"1","city":"Abidjan","ownerName":"A B","email":"v@example.ci","password":"motdepasse1"}'
curl -s -X POST localhost:3000/api/auth/forgot-password -H 'content-type: application/json' -d '{"email":"v@example.ci"}'
# → {"ok":true,"resetUrl":"...?token=..."}   puis reset-password + signin = compte pris

# Reproduire la perte de données au redémarrage
git stash && rm -rf .washguard            # ou cloner à neuf
# démarrer, créer un compte, redémarrer → /api/auth/signin → 401
```

---

## 8. Ce que je recommande de ne pas faire

- **Ne pas ajouter d'écrans** avant que la CI soit verte et que le backend soit unique : chaque nouvelle fonctionnalité creuse l'écart entre les trois backends.
- **Ne pas déployer le mode `api` en production** : sans rate limiting, sans audit, sans verrou d'écriture, c'est un risque supérieur au bénéfice.
- **Ne pas traiter `docs/audit.md` comme un état des lieux** : il décrit un frontend seul à 16 routes et 66 assertions ; le dépôt en est très loin aujourd'hui.
