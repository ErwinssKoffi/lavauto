# LAVAUTO — Auth, multi-tenancy et RBAC (Prompt 04)

**Date :** 11/11/2026 · **Projet Supabase :** `lavauto` (`cgxrqorwmmcyqescatzs`, `eu-central-1`) · **Branche :** `arena/868cde36-lavauto` · **Statut :** livré (P04) ; P05 et P06 sont livrés, arrêt avant le Prompt 07.

> Ce document décrit le branchement réel de Supabase Auth, l'isolation multi-entreprises et les permissions serveur. Le projet `BarberShop` (`fpapxbfsiiwgpvsefsec`) reste intact. Aucun compte Auth de test, aucune invitation envoyée, aucun e-mail de test, aucun secret ni aucune clé `service_role` n'a été versionné.

---

## 1. Décisions validées

| Décision | Application |
| --- | --- |
| `reset_oui` | Le mot de passe oublié utilise un **vrai lien Supabase Auth** (`resetPasswordForEmail` → `/reinitialiser-mot-de-passe`). Les textes obsolètes de `SignIn`, `Landing`, `Employees` et `scripts/check.cjs` sont remplacés. |
| `confirm_keep` | `mailer_autoconfirm=false` conservé ; l'inscription demande une confirmation e-mail avant toute session. |
| `no_accounts` | `auth.users = 0`, `user_profiles = 0`, `user_invitations = 0`, `audit_logs = 0` à la livraison ; aucun compte ni e-mail de test. |
| `env_oui` | `.env.local` (ignoré par `.gitignore:13`) contient `VITE_DATA_SOURCE=supabase`, l'URL du projet et la clé **publishable** uniquement. Aucune valeur `service_role` / `sb_secret`. |

---

## 2. Configuration Supabase Auth

`get_auth_config` a été relu après le Prompt 04, puis `update_auth_config` a été rappelé le 12/11/2026 pour basculer `site_url` et l'allow-list sur le domaine de production Vercel, sans créer de compte ni modifier SMTP / fournisseurs / hooks :

| Champ | Valeur distante |
| --- | --- |
| `site_url` | `https://lavauto-five.vercel.app` |
| `uri_allow_list` | `http://localhost:5173/**`, `http://127.0.0.1:5173/**`, `https://5173-in4mdo7zgflqt72vpkywe.e2b.app/**`, `https://lavauto-five.vercel.app/**`, `https://lavauto-git-arena-868cde36-lavauto-durandobi634-8314s-projects.vercel.app/**` |
| `jwt_exp` | `3600` (1 heure) |
| `disable_signup` | `false` |
| `external_email_enabled` / `external_phone_enabled` | `true` / `false` |
| `mailer_autoconfirm` | `false` — confirmation e-mail requise |
| `refresh_token_rotation_enabled` | `true` |
| `security_refresh_token_reuse_interval` | `10` |
| SMTP personnalisé / hook e-mail | **non configurés** ; aucun e-mail n'a été envoyé |

Le premier `update_auth_config` du Prompt 04 avait normalisé en `null` plusieurs champs non transmis ; la relecture avait confirmé les valeurs par défaut restaurées. Le second update du 12/11/2026 ne change que `site_url` et `uri_allow_list` : sa réponse affiche temporairement `null` sur les champs non transmis, mais la relecture `get_auth_config` (`a199c5a2-883c-4336-9bbf-0a8bff881994`) confirme les valeurs effectives restaurées (`rate_limit_email_sent=2`, `security_captcha_provider=hcaptcha`, `sms_provider=twilio`, `sessions_inactivity_timeout=0`, `sessions_timebox=0`, `refresh_token_rotation_enabled=true`). `mailer_autoconfirm=false`, JWT 3 600 s, e-mail activé et téléphone désactivé sont conservés. Les origines CORS du projet restent à renseigner dans le tableau de bord Supabase (voir [`deployment.md`](deployment.md)).

---

## 3. Chaîne d'authentification frontend

```
formulaires existants
   → AuthPort (signIn / signUp / signOut / reset / invitations)
   → SupabaseAuthAdapter.onAuthStateChange
   → auth.getUser()  (JWT vérifié côté serveur)
   → rpc('my_context') + rpc('my_company_users') + rpc('my_company_invitations')
   → StoreProvider.authReady / identity / invitations / state.session
   → usePermissions() → navigation, RoleRoute, Employés, Plateforme
```

- `fetchMeOnce()` est supprimé. Il n'existe plus de promesse `/auth/me` mémorisée à vie, ni de boucle 401.
- `getSession()` n'est **jamais** utilisé pour décider d'un accès. La session UI n'est pas lue depuis `localStorage` : `load()` et `persist()` retirent systématiquement `state.session`.
- `SupabaseAuthAdapter.sync()` est à vol unique (`pending`) et déduplique `INITIAL_SESSION`, `SIGNED_IN` et `TOKEN_REFRESHED` par clé `userId + token + confirmation`.
- Un token forgé, expiré, non confirmé ou rattaché à un profil désactivé conduit à `SIGNED_OUT` avec motif contrôlé ; aucun état local ne le remplace.
- `VITE_WG_TEST_AUTH` est une constante de **compilation** réservée au harnais JSDOM ; elle est absente de la build Vite. Le pont de test injecte une session en mémoire, jamais via `washguard.state.v1`.

### Formulaires conservés, câblage remplacé

- `SignIn` : mêmes champs e-mail / mot de passe, appel asynchrone, lien « Mot de passe oublié », messages de confirmation / reset, plus aucun bouton de session support forgée.
- `SignUp` : mêmes deux sections et mêmes validations ; `signUp()` envoie les métadonnées `company_name`, `station_name`, `owner_name`, `city`, `phone`, `invitation:false`. Aucun `company_id`.
- `ForgotPassword` / `ResetPassword` : nouveaux écrans minimalistes, lien signé Supabase Auth, mot de passe jamais communiqué à l'entreprise.
- `Employees` : même table et mêmes composants, mais invitation par e-mail, sélection **multi-stations**, rôles `gerant` / `caissier` / `laveur`, activation / désactivation, révocation et lien de réinitialisation. Aucun « mot de passe provisoire ».
- `Settings.resetAll()` : efface l'état métier et les empreintes de démo, déconnecte en mode Supabase, puis navigue sans rechargement brutal.

### Mode local

`LocalAuthAdapter` garde la démonstration hors ligne. `AppState.passwords` est supprimé de `src/types.ts` et `src/lib/store.tsx` ; les empreintes non réversibles sont isolées dans `src/lib/demoPasswords.ts`. Le mode local n'envoie aucun e-mail et refuse explicitement le reset réel : « disponible avec Supabase Auth ».

---

## 4. Sécurité serveur

| Principe | Mise en œuvre |
| --- | --- |
| Tenant non falsifiable | `company_id` dérivé de `auth.uid()` par `current_company_id()` ; zéro occurrence de la chaîne `company_id` dans `src/`. Les triggers `enforce_company_id()` imposent la valeur sur 43 tables. |
| RBAC | 31 permissions, 72 liaisons `role_permissions`. Rôles système : `owner`, `manager`, `cashier`, `washer`, `super_admin` (hors tenant via `platform_admins`). |
| UI = reflet | `usePermissions()` lit `identity.permissions` issue de `my_context()` ; `RoleRoute` et `groupsForRole()` sont des garde-fous de confort. La sécurité réelle est RLS + fonctions `SECURITY DEFINER`. |
| Portée station | `can_access_station()` et `user_station_assignments` ; `my_context()` ne renvoie que les stations autorisées. |
| Invitations | Edge Function `invite-user` (`verify_jwt=true`) : vérifie le JWT, `current_company_id()`, `has_permission('employees.invite')`, le périmètre des stations, puis appelle `auth.admin.inviteUserByEmail`. Le secret vient de l'environnement de la fonction, jamais du bundle. |
| Mutations sensibles | `admin_update_user()` et `revoke_invitation()` revérifient `employees.manage`, `employees.disable`, `employees.assign_stations`, `employees.invite`, le propriétaire protégé et le périmètre des stations. |
| Audit | Triggers sur `user_profiles`, `user_station_assignments`, `user_invitations` ; acteur `auth.uid()` quand disponible ; `audit_logs` append-only (triggers d'immuabilité P03 + `REVOKE UPDATE/DELETE`). |
| Super admin | `my_context()` donne toutes les permissions ; `my_company_users()` / `my_company_invitations()` lisent tous les tenants, sans faux `company_id`. |

---

## 5. Migrations appliquées

Les 10 migrations P03 restent en place. Le Prompt 04 ajoute **10 migrations** (20 au total) :

| Migration | Contenu |
| --- | --- |
| `011_auth_bootstrap` | Trigger `AFTER INSERT ON auth.users`, création idempotente entreprise + station + propriétaire + affectation + essai + audit ; colonnes `accepted_user_id` / `revoked_at` ; 5 permissions ; `my_context()`, `accept_my_invitations()`. |
| `012_rbac_policies` | Remplace les politiques génériques d'identité par des politiques SELECT / INSERT / UPDATE explicites avec `has_permission()`. |
| `013_audit_triggers` | Journal des créations / modifications de profils, affectations et invitations. |
| `014_user_admin_functions` | `admin_update_user()` et `revoke_invitation()` avec contrôles serveur. |
| `015_company_read_views` | `my_company_users()` et `my_company_invitations()`, sans filtre de tenant côté client. |
| `016_owner_guard` | Retire `subscription.manage` au gérant et protège le propriétaire contre un gérant. |
| `017_granular_user_permissions` | Vérifie chaque permission granulaire dans `admin_update_user()`. |
| `018_platform_admin_reads` | Le super admin lit tous les profils et toutes les invitations, hors tenant. |
| `019_platform_admin_profile` | Exception contrôlée à `enforce_company_id()` : le profil du super admin peut rester hors tenant. |
| `020_platform_admin_audit` | Le journal d'audit du super admin peut également rester hors tenant, acteur contrôlé par `auth.uid()`. |

**État distant vérifié à la livraison P04 :** 20 migrations, 51 tables, 51 RLS activées, 70 politiques, 30 fonctions, 85 triggers, 31 permissions, 72 `role_permissions`, `0 auth.users`, `0 profils`, `0 platform_admins`, `0 invitations`, `0 audit_logs`. Après P05 : **23 migrations**, 10 RPC exposées et 4 triggers sur `washes`. Après P06 : **29 migrations**, finance P06 vérifiée, toujours `0` donnée de test persistée ; voir [finance.md](finance.md).

---

## 6. Tests

- `npm ci` → 185 paquets ; `npm run typecheck` → 0 erreur ; `npm run lint` → 11 règles OK ; `npm run build` → 110 modules, CSS 31,25 kB / gzip 7,40 kB, JS 663,46 kB / gzip 176,94 kB (avertissement de taille de chunk, non bloquant) ; `npm audit` → 5 modérées, 0 haute, 0 critique. Chiffres relancés après la refonte de `/`.
- `npm run check` → **140 OK / 0 KO · local** ; `WG_DATA_SOURCE=supabase npm run check` → **141 OK / 0 KO · supabase** après les 4 contrôles de la nouvelle vitrine. Les assertions P01–P03 sont conservées ; les assertions obsolètes sur `fetchMeOnce` et l'ancien texte « aucun e-mail » sont remplacées.
- Section `[8]` : 20 migrations, bootstrap Auth, RLS explicite, audit, `SECURITY DEFINER` + `has_permission`, Edge Function, absence de mots de passe dans `AppState`, `RoleRoute` confort, mappings RBAC, projection serveur.
- Harnais `SupabaseAuthAdapter` : `INITIAL_SESSION` + `SIGNED_IN` → **1** `getUser`, **1** `my_context`, **1** changement ; session expirée → `SIGNED_OUT`; profil désactivé → déconnexion; inscription → `confirmationRequired`; reset → `/reinitialiser-mot-de-passe`; invitation et mutation sans `company_id`.
- Harnais local : inscription sans `passwords`, empreinte de mot de passe séparée, élévation de privilèges refusée, aucun e-mail simulé, déconnexion.
- Base distante, en transaction `BEGIN … ROLLBACK` : A → 2 profils, 30 permissions, 1 station, 0 fuite B ; B → 1 profil, 0 fuite A ; super admin → `isPlatformAdmin=true`, `companyId=null`, 31 permissions, 4 profils ; propriétaire désactivé → `active=false`, `current_company_id()=null` ; JWT sans profil → `profileReady=false`, 0 utilisateur ; insertion cross-tenant → `42501` ; élévation gérant → propriétaire → `42501` ; `UPDATE audit_logs` → `55000` ; 11 lignes d'audit temporaires. Après rollback : `0 auth.users`, `0 profils`, `0 invitations`, `0 audit_logs`, `0 fixture`.
- `list_edge_functions` : `invite-user` `ACTIVE`, version 1, `verify_jwt=true`, corps conforme. `get_project_health` : `auth` GoTrue `v2.197.0`, `db`, `rest` → `ACTIVE_HEALTHY`.
- Preview Vite redémarrée après `.env.local` : `/`, `/connexion`, `/inscription`, `/mot-de-passe-oublie`, `/reinitialiser-mot-de-passe`, `/app/employes`, `/app/tableau-de-bord` → 200 ; hôte arbitraire → 403.

---

## 7. Limites assumées

- Aucun compte Auth, aucune invitation et aucun e-mail de test créés conformément à `no_accounts`. L'Edge Function est déployée mais **non invoquée**.
- Aucun SMTP personnalisé ni hook mail configuré ; la délivrabilité réelle dépend du mailer Supabase du projet. Aucun envoi n'a été effectué.
- Les écritures du **cycle lavages** passent par les RPC `021`/`022`/`023` et celles de la **finance** par `024`–`029` (voir [washes.md](washes.md) et [finance.md](finance.md)). `DataAdapter` expose aussi `listFinanceBoard()`, `listProfitability()` et `financeCommands`. Le catalogue et l'abonnement restent des écritures locales.
- `npm run lint` est un lint statique ciblé, pas ESLint/Prettier ; CI GitHub Actions et 15 specs Playwright sont livrés au Prompt 10 (exécution Chromium en CI).
- Aucun Storage, aucun bucket, aucune notification applicative.
- **Les Prompt 05 et 06 sont livrés ; arrêt avant le Prompt 07.**

---

## 8. Fichiers principaux

- `src/services/auth/` : `AuthPort`, `authTypes`, `LocalAuthAdapter`, `SupabaseAuthAdapter`, `getAuthPort`.
- `src/lib/` : `store.tsx`, `usePermissions.ts`, `permissionCatalog.ts`, `demoPasswords.ts`, `supabase.ts`.
- `src/App.tsx`, `src/components/navigation.tsx`, `src/components/AppShell.tsx`, `src/components/CommandPalette.tsx`.
- `src/pages/auth/` : `SignIn`, `SignUp`, `ForgotPassword`, `ResetPassword`.
- `src/pages/Employees.tsx`, `src/pages/Settings.tsx`, `src/pages/Platform.tsx`, `src/pages/Commissions.tsx`, `src/pages/Landing.tsx`.
- `supabase/migrations/011…020`, `supabase/functions/invite-user/index.ts`.
- `scripts/check.cjs`, `scripts/lint.cjs`, `.env.example`, `src/vite-env.d.ts`, `package.json`, `docs/landing.md`.
