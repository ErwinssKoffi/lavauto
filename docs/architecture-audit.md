# 01 — Audit d'architecture (Foundation & Audit)

**Date :** 11/11/2026 · **Branche :** `arena/868cde36-lavauto` · **Base :** `b119692` (`main`)
**Périmètre historique :** diagnostic initial uniquement. **Aucun fichier de code n'a été modifié au titre de ce prompt.** Les soldés P02–P04 sont annotés plus bas ; l'état courant est décrit dans [database.md](database.md) et [auth-rbac.md](auth-rbac.md).
**Méthode :** lecture intégrale de `package.json`, `src/**`, `docs/**`, `scripts/check.cjs`, des configurations, interrogation en **lecture seule** du connecteur Supabase, puis exécution de la suite de vérification existante.

---

## 1. Synthèse

Le dépôt n'est pas un squelette : c'est un **frontend fonctionnel et vérifié** (`washguard` 1.0.1), 48 fichiers suivis, ~4 400 lignes de TS/TSX/CSS, 28 fichiers source, 16 routes couvertes par 66 contrôles automatisés. Il compile, passe les types et le build.

Trois constats structurants :

1. **Toute la persistance est locale.** `src/lib/store.tsx` (759 lignes, ~40 actions) est un unique `StoreProvider` qui sérialise l'intégralité de l'état métier dans `localStorage` (`washguard.state.v1`). Il n'existe ni table, ni requête, ni fonction serveur.
2. **L'infrastructure Supabase existe déjà, mais elle est vide.** Le connecteur expose un projet `lavauto` actif (`cgxrqorwmmcyqescatzs`, `eu-central-1`, PostgreSQL 17.11) avec **0 migration et 0 table dans `public`**. Le client `src/lib/supabase.ts` est prêt mais inerte : `.env.example` contient des variables vides et aucun `.env` n'est présent.
3. **Les règles métier existent, mais ne sont appliquées que côté navigateur.** Le garde `409 onboarding_incomplete`, les rôles, l'activation de la station et les quotas sont contournables en modifiant le `localStorage`. C'est acceptable pour une démonstration, **pas pour un SaaS**.

La bonne nouvelle : le code est propre, typé, testé et déjà découpé par écran. **Il ne faut rien réécrire** ; `src/lib/store.tsx` est le point de bascule idéal vers une architecture à adaptateurs.

### État de santé au moment de l'audit

| Contrôle | Résultat |
| --- | --- |
| `npm ci` | ✅ reproductible (lock cohérent, versions pinnées pour les outils de test) |
| `npm run typecheck` | ✅ 0 erreur |
| `npm run build` | ✅ 92 modules, ~408 ko JS / 29 ko CSS |
| `npm run check` | ✅ **66 OK / 0 KO** (logique, gardes, 16 routes, inscription, cahier des charges) |
| `npm run lint` | ✅ **Prompt 04** : lint statique `scripts/lint.cjs` (TD-29 partielle). Aucun ESLint/Prettier ni CI `.github/` à ce stade. |
| `npm audit` | ⚠️ 5 modérées, 0 haute, 0 critique |
| Serveur Vite | ✅ preview `*.e2b.app` 200, hôte arbitraire 403 |

---

## 2. Cartographie de l'architecture actuelle

```
index.html                    entrée Vite, thème appliqué avant le rendu
src/main.tsx                  providers : BrowserRouter > StoreProvider > App
src/App.tsx                  18 déclarations de routes, SessionGate / AuthRoute /
                             AppRoute / LandingRoute / RoleRoute
src/components/
  ui.tsx                    briques : Card, Input, Select, Badge, StatCard,
                             Progress, Modal, Tabs, ToastHost, LockedPanel…
  AppShell.tsx               sidebar par rôle, topbar, menu utilisateur, thème
src/pages/                   16 écrans (Landing, auth ×3, 13 modules)
src/lib/
  types.ts  → types.ts       20 interfaces / types métier (AppState inclus)
  store.tsx                  ÉTAT + RÈGLES MÉTIER + PERSISTANCE (tout-en-un)
  metrics.ts                 rapports, commissions, théorique de caisse
  format.ts                  FCFA, jj/mm/aaaa, export CSV
  plans.ts                   constante `PLANS` (rôle de table `plans`)
  supabase.ts                createClient conditionnel, jamais appelé
src/index.css                 règles globales (fond, focus, mouvement réduit, reçu imprimable)
scripts/check.cjs             harnais JSDOM + esbuild, 66 assertions
docs/audit.md                 audit de conformité 1.0.1 (précédent)
docs/onboarding.md            parcours 13 étapes / 8 obligatoires
```

### Couches et dépendances

| Couche | Contenu | Couplage |
| --- | --- | --- |
| Présentation | `pages/*`, `components/*` | appellent toutes `useStore()` directement |
| État | `StoreProvider` (`useState` + `useRef` + `useEffect`) | `setState` + sérialisation `localStorage` |
| Domaine | `computeOnboarding`, `missingRequired`, `buildReport`, `buildCommissions`, `theoreticalCash`, `assertActivated`, `assertCashRule` | fonctions pures pour la lecture, règles imbriquées dans le provider pour l'écriture |
| Persistance | `localStorage` (`washguard.state.v1`, `washguard.theme`) | aucune abstraction, aucun adaptateur |
| Infrastructure | `supabase.ts` (inerte), `.env.example` | non connecté |

**Couplage critique :** les 16 pages consomment le contexte `Ctx` directement. Toute migration doit donc conserver la **forme du contrat `Ctx`** pour éviter de toucher aux écrans. C'est le levier de la stratégie progressive (voir `docs/migration-roadmap.md`).

### Routes

| Groupe | Routes |
| --- | --- |
| Publiques | `/`, `/connexion`, `/inscription`, `/auth/*` → redirection |
| Espace station | `/app/tableau-de-bord`, `mise-en-route`, `lavages`, `prestations`, `clients`, `employes`, `caisse`, `depenses`, `rapports`, `commissions`, `parametres`, `abonnement` |
| Plateforme | `/app/plateforme` |
| Gardes | `SessionGate` (un seul `/auth/me`), `AuthRoute`, `AppRoute`, `RoleRoute` (rôles au niveau route) |

---

## 3. Inventaire fonctionnel

### 3.1 Opérationnel et validé (à conserver tel quel)

Vitrine avec aperçus rendus en direct et **aucun témoignage inventé** ; `AuthLayout` (photo + dégradé, masqué sur mobile) ; inscription en deux temps avec création **idempotente** entreprise + station + propriétaire + essai ; mise en route 13 étapes / 8 obligatoires dont l'état est **constaté sur les données** ; tableau de bord ; lavages (fiche, prix figés, encaissement partiel, reste à payer, annulation motivée) ; prestations + grille tarifaire par catégorie ; clients ; employés (rôles, activation, reset de mot de passe, exception de commission) ; caisse (fond, comptage, écart, réouverture motivée) ; dépenses (annulation tracée, jamais supprimée) ; rapports jour/semaine/mois + CSV ; commissions (lavages terminés, barème ou exception, CSV paie) ; paramètres ; abonnement ; espace plateforme ; thème sombre/clair ; français / FCFA / jj/mm/aaaa.

Règles déjà durcies en 1.0.1 : `409 onboarding_incomplete` avec liste des manques, espèces conditionnées à une caisse ouverte (Mobile Money libre), fiche annulée non encaissable, réouverture unique et sans double comptage, anti-injection CSV, garde de rôle par URL, un seul appel `/auth/me`.

### 3.2 Simulé (localStorage, aucune autorité serveur)

| Domaine | Mécanisme réel actuel |
| --- | --- |
| Authentification | `passwords: Record<email, string>` **en clair** dans le navigateur, comparaison côté client |
| Session | `session` sérialisé ; aucune expiration, aucun refresh, aucun JWT |
| Isolation multi-entreprises | `AppState.company` **unique**, `station` **unique** ; `platformCompanies` est une liste locale de démonstration |
| Permissions | `RoleRoute` + gardes internes → **masquage côté client uniquement** |
| `409 onboarding_incomplete` | `assertActivated()` dans le provider ; contournable en éditant `station.activated` |
| Journal sensible | `auditLogs` local, plafonné à 200 entrées, modifiable par l'utilisateur |
| Abonnements / quotas | `Subscription` + `PLANS` constants ; **aucun contrôle de limite** à la création |
| Caisse / paiements / dépenses | objets en mémoire, aucun mouvement immuable, aucune transaction |
| Commissions | recalculées à la volée ; **aucun relevé figé**, aucune validation, aucun paiement |
| Support plateforme | `signInSupportDemo()` crée une session locale sans serveur |

### 3.3 Partiellement implémenté

| Sujet | État actuel | Écart à la cible ERP |
| --- | --- | --- |
| Multi-stations | `plans.limits.stations` peut valoir 5, mais l'état n'a qu'une `station` | plusieurs stations par entreprise, consolidation, affectation utilisateur ↔ stations |
| Rôles | 4 : propriétaire, gérant, caissier, support | ajouter **laveur**, **super admin SaaS**, équipes, RBAC granulaire (`washes.create`, `cash.close`…) |
| Statuts de lavage | 4 valeurs FR `en_attente / en_cours / termine / annule` | 7 valeurs `pending / assigned / in_progress / quality_check / ready / delivered / cancelled` + historique horodaté |
| Moyens de paiement | 4 valeurs génériques | Orange Money, MTN MoMo, Wave, carte, virement, **configurables par station**, référence de transaction |
| Devise | `currency: 'FCFA'` (type littéral), `formatFCFA` suffixe codé en dur | XOF par défaut mais **configurable**, formatage `Intl.NumberFormat` par devise |
| Clients | nom, téléphone, plaque, notes | véhicules, email, préférences, historique, flottes, fidélité, promotions |
| Caisse | un seul `countedAmount` par session | `cash_movements`, clôtures immuables, rapprochement par canal (espèces ≠ Mobile Money) |
| Rapports | tableaux + CSV, « résultat simplifié » | graphiques, comparaison de périodes, **rentabilité réelle** |
| Commissions | calcul + export | `commission_periods` figés, validation, `commission_payouts` |
| Formulaires | champs contrôlés à la main, validation minimale | Zod + React Hook Form, erreurs serveur, états de chargement |

### 3.4 Absent

Véhicules (entité), postes de lavage, file d'attente, affectations multiples, historique de statuts, contrôle qualité, présences/équipes, **stock / produits / fournisseurs / commandes / réceptions / mouvements / inventaires**, consommation théorique de produits, achats, fiducialité/points/cartes/forfaits/promotions/flottes, notifications (WhatsApp/SMS/e-mail — à ne pas simuler), graphiques, comparaison multi-stations, back-office SaaS réel, invitations collaborateurs, Supabase Storage (justificatifs), migrations SQL, RLS, fonctions SQL, tests d'isolation, lint, CI/CD, error boundaries, skeletons, pagination, recherche globale.

---

## 4. Dépendances

**Installées et utilisées :** React 19.0.0, React DOM 19.0.0, react-router-dom 6.30.6, react-icons 4.12.0, Vite 8.3.8, TypeScript 7.0.2, Tailwind 3.4.17, PostCSS, Autoprefixer, @vitejs/plugin-react, jsdom 31.0.0 + esbuild 0.28.2 (`npm run check`).

**Installée mais inerte :** `@supabase/supabase-js` 2.119.0 — `createClient` n'est exécuté que si `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont renseignées ; aucun appel réseau n'est effectué.

**Code mort détecté :** `formatNumber()` et `isToday()` (`src/lib/format.ts`), `METHOD_LABEL` (`src/lib/metrics.ts`) — exports sans aucun appel. Faible priorité, mais à supprimer ou à utiliser lors du passage à `Intl.NumberFormat`.

**Manquantes, à introduire uniquement quand elles apportent une valeur :**

| Besoin | Librairie | Étape |
| --- | --- | --- |
| État serveur, cache, invalidation | TanStack Query | 03/04 |
| Validation des données | Zod | 01/03 (schémas) |
| Formulaires complexes | React Hook Form | 02/05 |
| Graphiques | Recharts | 09 |
| Dates / périodes / comparaisons | date-fns | 06/09 |
| Tests unitaires | Vitest | 03+ |
| Tests E2E | Playwright | 10 |
| Lint | ESLint + config TS | 01 (fondations) |

`npm audit` : 5 modérées, 0 haute / 0 critique. `react-router` 6.30.6 (open redirect via backslash + `deserializeErrors()` SSR) n'est corrigeable qu'en **v7 (breaking)** ; `glob` / `minimatch` / `sucrase` sont des outils de build sans exposition navigateur. Aucune dépendance inutile à retirer d'urgence.

**Configurations absentes :** aucun `.github/` (CI), aucun ESLint/Prettier, aucun `vitest.config`, aucun `.env` local, `tsconfig.json` en `strict: true` mais `noUnusedLocals: false`, `noUnusedParameters: false`, `skipLibCheck: true`, sans `noUncheckedIndexedAccess` ni `exactOptionalPropertyTypes`.

---

## 5. Problèmes de sécurité

| ID | Gravité | Constat | Localisation | Correction cible |
| --- | --- | --- | --- | --- |
| S-01 | **Critique** | Mots de passe en clair dans le navigateur | `passwords` (`types.ts`, `store.tsx`) | Supabase Auth ; suppression totale du champ ; reset imposé à la migration |
| S-02 | **Critique** | Règles métier contournables : `station.activated`, `session.role`, montants modifiables dans `localStorage` | `store.tsx` | autorité serveur : RPC `SECURITY DEFINER` + contraintes + RLS |
| S-03 | **Critique** | Aucune isolation multi-entreprises : une seule `company` dans l'état | `AppState` | `company_id` dérivé de `auth.uid()` côté serveur, jamais transmis librement par le frontend |
| S-04 | **Élevée** | Aucune RLS, aucune table, aucun contrôle serveur | projet Supabase vide | migrations + politiques sur **toutes** les tables (étape 03) |
| S-05 | **Élevée** | Permissions = masquage UI uniquement ; pas de RBAC granulaire | `App.tsx`, `AppShell.tsx` | table `permissions` + vérification serveur ; l'UI ne fait que refléter |
| S-06 | **Élevée** | Journal d'audit local, éditable, plafonné à 200 | `logAction()` | `audit_logs` en base, append-only, écrit par trigger/fonction |
| S-07 | Moyenne | `fetchMeOnce` mémorise la promesse pour toute la durée du module (changement de compte sans rechargement) | `store.tsx` | **Soldé P04** : `onAuthStateChange` + `auth.getUser()` + `my_context()`, déduplication |
| S-08 | Moyenne | Aucune expiration de session réelle (« 30 jours » n'est qu'un texte) | `Session` | JWT + refresh Supabase Auth |
| S-09 | Moyenne | Pas de validation de schéma des entrées (montants négatifs, chaînes, dates) | formulaires | Zod côté client **et** contraintes SQL côté serveur |
| S-10 | Faible | `logoUrl` accepté sans validation de schéma | `Onboarding`, `Settings` | validation `https:` / `data:image` + Supabase Storage |
| S-11 | Faible | `uid()` = `Math.random()` (identifiants prévisibles) | `format.ts` | UUID `gen_random_uuid()` côté base |
| S-12 | Faible | `window.confirm` pour une action destructive | `Settings` | dialogue de confirmation du design system |

**Déjà traité en 1.0.1 (ne pas refaire) :** injection de formule CSV, `allowedHosts` Vite explicite, garde de rôle par URL, fiche annulée non encaissable, réouverture de caisse sécurisée, thème sans flash.

**Soldés au Prompt 04 :** S-01 (plus de mots de passe en clair ni de `passwords` dans `AppState`), S-05 (`permissions` + `has_permission()` serveur, UI simple reflet), S-07 (`onAuthStateChange` remplace `fetchMeOnce`), S-08 (JWT 1 h + rotation Supabase Auth). S-02/S-03/S-04/S-06 restent partiellement couverts par le schéma P03 ; le cycle lavages P05 passe par les RPC serveur `021`/`022`/`023`, la finance P06 passe par `024`–`029` ; seuls P07+ restent à brancher.

---

## 6. Exactitude financière — point de vigilance majeur

**Soldé au Prompt 06 :** `src/lib/metrics.ts` ne calcule plus de `result`. CA, encaissé, créances, achats, consommations, commissions, charges fixes et `partialBalance` sont distincts ; `costsMissing=true`, `grossMargin`/`result` restent `NULL`. Le solde partiel est explicitement **« PAS un benefice net »** ; P07 fournira les coûts de stock nécessaires à un résultat net honnête.

Le playbook interdit explicitement de présenter « encaissements − dépenses » comme un résultat net. L'étape 06 devra donc :

- séparer **CA facturé**, **encaissé**, **créances**, **dépenses**, **achats**, **consommations**, **commissions**, **charges fixes**, **marge brute**, **résultat d'exploitation**, **résultat net estimé** ;
- afficher un état **« coûts non renseignés »** plutôt qu'un faux bénéfice tant que les données manquent ;
- figer les relevés de commission validés (`commission_periods`) pour éviter tout recalcul rétroactif.

Les prix figés dans `wash_items` (`unitPrice`) et le `409 onboarding_incomplete` sont eux déjà conformes et doivent être conservés.

---

## 7. Modèle de données actuel → cible

| Type actuel | Table(s) cible(s) | Transformation principale |
| --- | --- | --- |
| `Company` | `companies` | + `country`, `currency`, `deleted_at` |
| `Station` | `stations` | **1 → N** par entreprise ; horaires en table dédiée ou JSONB normalisé |
| `AppUser` + `passwords` | `user_profiles`, `user_station_assignments`, `roles`, `permissions` | suppression des mots de passe ; liaison à `auth.users` |
| `VehicleCategory` | `vehicle_categories` | + `company_id`, `sort_order` |
| `Service` + `prices` | `services`, `service_prices` | **dénormaliser la grille** en lignes (une par catégorie) |
| `Client` | `customers`, `vehicles` | plaque → véhicule ; + email, préférences |
| `Wash` / `WashItem` | `washes`, `wash_items`, `wash_assignments`, `wash_status_history`, `wash_quality_checks` | statuts FR → EN (7) ✅ P05, historisation, affectations multiples |
| `Payment` | `payments`, `payment_methods` | + référence, statut, remboursement, idempotence |
| `CashSession` | `cash_sessions`, `cash_movements` | mouvements immuables, clôtures non modifiables, rapprochement par canal |
| `Expense` | `expenses`, `expense_categories` | justificatif via Storage, suppression logique |
| `Plan` / `Subscription` | `plans`, `subscriptions`, `subscription_usage` | tarifs administrables, quotas appliqués côté serveur |
| `AuditLog` | `audit_logs` | append-only, acteur = `auth.uid()` |
| — | `products`, `suppliers`, `purchase_orders`, `stock_movements`, `inventory_*`, `commission_*`, `attendance_records`, `loyalty_*`, `fleet_*` | création |

Champs transverses à généraliser : `id UUID`, `company_id`, `station_id` (nullable pour le niveau entreprise), `created_at`, `updated_at`, `created_by`, `deleted_at`, index sur `(company_id, station_id, created_at)`.

---

## 8. État de l'infrastructure Supabase (constaté, pas modifié)

| Élément | Valeur |
| --- | --- |
| Projet cible | `lavauto` · ref `cgxrqorwmmcyqescatzs` · organisation `mveogdqltrxhuegvmvhp` |
| Région / moteur | `eu-central-1` · PostgreSQL 17.11 · statut `ACTIVE_HEALTHY` |
| Migrations | **0** |
| Tables du schéma `public` | **0** |
| Autre projet | `BarberShop` (`fpapxbfsiiwgpvsefsec`, `INACTIVE`) — **sans rapport, à ne pas toucher** |
| Côté dépôt | `.env.example` avec `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` vides ; aucun `.env` ; client `supabase.ts` inerte |

Conséquence : le projet est **prêt à recevoir le schéma**, mais **rien n'a été créé** au titre de ce prompt. La clé publishable et la configuration Auth seront à récupérer aux étapes 03/04, après validation du modèle.

---

## 9. Validation du Prompt 01

| Critère | Résultat |
| --- | --- |
| Le projet compile | ✅ `npm run build` exécuté après rédaction des documents |
| Aucune fonctionnalité existante supprimée | ✅ `git diff` sur `src/**` vide pour ce prompt ; seuls 4 documents + un lien README sont ajoutés |
| Architecture cible documentée | ✅ `docs/architecture-target.md` |
| Stratégie de migration progressive | ✅ `docs/migration-roadmap.md` |
| Risques techniques identifiés | ✅ §5, §6 et `docs/technical-debt.md` |
| Cartographie / fonctionnel / simulé / incomplet / dépendances / sécurité | ✅ §2 à §5 |

**Conclusion :** les fondations sont saines pour une évolution incrémentale. Le risque n'est pas la qualité du frontend, mais l'absence d'autorité serveur. La priorité n'est donc ni le design, ni la création de tables « à la hâte » : c'est la mise en place d'un **contrat d'accès aux données** stable (étape 03) avant de déplacer le premier module.
