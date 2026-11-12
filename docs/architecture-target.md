# 01 — Architecture cible (Foundation & Audit)

**Statut :** document de design, **aucun code produit**. Il complète `docs/architecture-audit.md`.
**Règle directrice :** la structure ci-dessous est une **cible progressive**, pas un grand déménagement. On adapte l'existant sans multiplier les dossiers : aucun dossier n'est créé tant qu'un module n'en a pas besoin.

---

## 1. Principes

| # | Principe | Conséquence concrète |
| --- | --- | --- |
| P1 | **Ne pas réécrire** | `src/pages/*`, `src/components/ui.tsx`, `src/index.css` restent la base ; on les fait évoluer, on ne les remplace pas |
| P2 | **Le contrat `Ctx` est le point de bascule** | les 16 pages appellent `useStore()` ; conserver la forme du contrat permet de brancher Supabase sans modifier les écrans |
| P3 | **Étranglement (strangler fig)** | un adaptateur `LocalDataAdapter` (l'actuel `store.tsx`) et un `SupabaseDataAdapter` cohabitent derrière la même interface ; bascule par module, pas par projet |
| P4 | **Le serveur fait autorité** | `company_id`, rôles, quotas, montants, statuts et activation sont vérifiés en base (RLS + fonctions), jamais déduits d'un état navigateur |
| P5 | **Le frontend ne transmet jamais `company_id` librement** | il est dérivé de `auth.uid()` via `user_profiles` / claim JWT |
| P6 | **Domaine pur, effets aux bords** | `computeOnboarding`, `buildReport`, `buildCommissions`, `theoreticalCash` restent des fonctions pures testables ; les écritures passent par des services |
| P7 | **Pas de faux chiffre** | aucun indicateur de rentabilité tant que les coûts ne sont pas tous renseignés ; état « données manquantes » explicite |
| P8 | **Aucune donnée d'exemple en production** | la discipline actuelle (tout part vide, aucun prix inventé, aucun témoignage) est un actif à conserver |
| P9 | **Français, XOF par défaut, multi-pays** | devise et formats configurables par entreprise ; `Intl` plutôt que des suffixes codés en dur |
| P10 | **Chaque étape est réversible** | feature flag `VITE_DATA_SOURCE=local\|supabase`, rollback immédiat, `npm run check` doit rester vert |

---

## 2. Organisation des dossiers cible

```
src/
├── app/                          # créé à l'étape 02 (regroupement, pas de réécriture)
│   ├── router/                   # routes.tsx, guards.tsx (RoleRoute, AuthRoute…)
│   ├── providers/                # QueryProvider, ThemeProvider, StoreProvider (façade)
│   └── layouts/                  # AppShell, AuthLayout, PublicLayout
├── components/
│   ├── ui/                       # ISSU de components/ui.tsx : Button, Card, Input,
│   │                             #   Select, Badge, Modal, Drawer, Tabs, ToastHost…
│   ├── forms/                    # champs Zod + RHF, ConfirmDialog
│   ├── tables/                   # DataTable (tri, filtres, pagination serveur)
│   ├── charts/                   # wrappers Recharts
│   └── feedback/                 # EmptyState, Skeleton, ErrorBoundary
├── modules/                      # UN dossier par domaine, créé au moment du domaine
│   └── <domaine>/
│       ├── pages/                # écran(s) — déplacés depuis src/pages/*
│       ├── components/
│       ├── hooks/                # useWashes, useCashSession…
│       ├── api.ts                # appels au service (TanStack Query)
│       ├── schema.ts             # Zod
│       └── rules.ts              # règles métier pures du domaine
├── services/                     # accès données
│   ├── supabase/client.ts        # issu de lib/supabase.ts
│   ├── adapters/
│   │   ├── DataAdapter.ts        # interface = forme de Ctx
│   │   ├── LocalDataAdapter.ts   # enveloppe l'actuel store.tsx
│   │   └── SupabaseDataAdapter.ts
│   ├── repositories/             # washes.repo.ts, cash.repo.ts, finance.repo.ts…
│   └── audit.ts
├── hooks/                        # hooks transverses (usePermissions, useStationScope…)
├── lib/                          # CONSERVÉ : format.ts, metrics.ts (extension), plans.ts
│                                 #   → plans.ts devient un cache de la table `plans`
├── types/                        # découpage progressif de types.ts (domain/*.ts)
├── schemas/                      # schémas Zod partagés (env, pagination, montants)
├── utils/                        # helpers neutres
└── index.css                     # design tokens (variables CSS) — conservé et enrichi
```

**Ce qu'on ne crée PAS maintenant :** aucun dossier vide, aucun `modules/*` anticipé, aucun double composant. `src/pages/*` reste en place jusqu'à ce que le domaine correspondant soit migré. Le déplacement se fait **module par module**, avec mise à jour des imports et `npm run check` après chacun.

### Correspondance fichier actuel → cible

| Actuel | Cible | Action |
| --- | --- | --- |
| `src/App.tsx` | `app/router/routes.tsx` + `app/router/guards.tsx` | **déplacer / scinder** |
| `src/components/AppShell.tsx` | `app/layouts/AppShell.tsx` | déplacer, enrichir (sidebar repliable, breadcrumbs, recherche globale) |
| `src/components/ui.tsx` | `components/ui/*` + `components/feedback/*` | **scinder**, garder l'API publique (`Card`, `Input`…) pour ne rien casser |
| `src/pages/auth/AuthLayout.tsx` | `app/layouts/AuthLayout.tsx` | déplacer |
| `src/main.tsx` | `main.tsx` + `app/providers/*` | conserver l'ordre des providers |
| `src/lib/store.tsx` | `services/adapters/LocalDataAdapter.ts` + `app/providers/StoreProvider.tsx` (façade) | **envelopper**, ne pas supprimer les règles |
| `src/lib/supabase.ts` | `services/supabase/client.ts` | déplacer + validation Zod de l'env |
| `src/lib/metrics.ts` | `modules/finance/rules.ts` + `modules/analytics/rules.ts` | scinder **après** l'étape 06 ; conserver `buildReport`/`buildCommissions`/`theoreticalCash` et leurs tests |
| `src/lib/format.ts` | `lib/format.ts` (+ `Intl`) | conserver et généraliser la devise |
| `src/lib/plans.ts` | cache local de `plans` | remplacer la constante par une requête, garder un fallback hors ligne explicite |
| `src/types.ts` | `types/domain/*.ts` | scinder progressivement, réexporter depuis `types/index.ts` |
| `src/index.css` | `index.css` + `styles/tokens.css` | conserver les variables de thème |
| `scripts/check.cjs` | `scripts/check.cjs` + `tests/` (Vitest/Playwright) | conserver comme filet de sécurité non-régression |

---

## 3. Le contrat d'accès aux données (pièce maîtresse)

L'interface ci-dessous est **la forme actuelle de `Ctx`**. Le but : que `LocalDataAdapter` et `SupabaseDataAdapter` l'implémentent tous les deux, si bien qu'aucune page ne change.

```ts
// services/adapters/DataAdapter.ts — extrait illustratif
export interface DataAdapter {
  // lecture
  getSession(): Promise<Session | null>;
  getBootstrap(): Promise<Bootstrap>;          // company, stations, profil, permissions
  getOnboarding(): OnboardingStep[];           // constaté côté serveur, jamais coché par l'UI
  // écriture de base
  signUp(p: SignUpPayload): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  updateStation(patch: Partial<Station>): Promise<void>;
  setPrice(serviceId: string, categoryId: string, price: number): Promise<void>;
  // exploitation (TOUJOURS protégées par le serveur)
  createWash(p: WashPayload): Promise<Wash>;   // 409 onboarding_incomplete
  addPayment(washId: string, amount: number, method: PayMethod): Promise<void>;
  openCash(openingFloat: number): Promise<void>;
  closeCash(counted: number): Promise<void>;
  addExpense(p: ExpenseInput): Promise<void>;
  // …les ~40 actions de Ctx
}
```

- `LocalDataAdapter` = l'actuel `store.tsx` (localStorage), conservé pour la démo et le rollback.
- `SupabaseDataAdapter` = repositories + RPC ; mêmes codes d'erreur (`onboarding_incomplete`, `cash_closed`, `wash_cancelled`…) pour que l'UI ne change pas.
- `StoreProvider` devient une **façade** : il expose toujours `useStore()` avec la même forme, mais délègue à l'adaptateur choisi par `VITE_DATA_SOURCE`.

**Bénéfice :** l'étape 03 peut créer le schéma sans casser une seule page ; l'étape 04 peut brancher Auth sans réécrire les formulaires.

---

## 4. Modèle multi-entreprises et sécurité

```
auth.users (Supabase Auth)
   │ 1:1
user_profiles ── company_id ──> companies ── 1:N ──> stations
   │                                   │
   └── user_station_assignments ───────┘   (un utilisateur ↔ N stations)
            │
       roles ── role_permissions ──> permissions
```

| Règle | Implémentation |
| --- | --- |
| Isolation | RLS sur **toutes** les tables : `company_id = (SELECT company_id FROM user_profiles WHERE id = auth.uid())` ; aucune politique `USING (true)` |
| Portée station | `station_id IN (SELECT station_id FROM user_station_assignments WHERE user_id = auth.uid())` |
| `company_id` | jamais accepté depuis le frontend : valeur par défaut ou trigger serveur |
| Opérations sensibles | fonctions SQL `SECURITY DEFINER` (clôture de caisse, validation de commissions, annulation de paiement, suspension d'entreprise), avec vérification de permission **dans la fonction** |
| Audit | `audit_logs` en append-only, écriture par trigger/fonction, acteur = `auth.uid()`, jamais par le client |
| Données niveau entreprise | `station_id NULL` autorisé (ex. `companies`, `plans`, abonnements, contrats de flotte) |
| Suppression | logique (`deleted_at`) pour l'historique métier ; interdiction de `DELETE` sur `payments`, `cash_movements`, `stock_movements`, `wash_status_history`, `audit_logs` |
| Idempotence | clé d'idempotence sur paiements / encaissements / réceptions ; contraintes d'unicité sur `wash_items`, numéros de lavage par station |
| Rôles cibles | `proprietaire`, `gerant`, `caissier`, `laveur`, `super_admin` (ce dernier hors `company_id`, via une table/service plateforme distinct) |

**Permissions granulaires** (`washes.create`, `washes.update_status`, `payments.create`, `cash.open`, `cash.close`, `expenses.create`, `employees.manage`, `reports.view`, `inventory.manage`, `settings.manage`, …) : la table fait foi, l'UI ne fait que **refléter** (`usePermissions`). `RoleRoute` reste utile comme confort, jamais comme protection.

> **État Prompt 04 :** ce modèle est appliqué. `my_context()` renvoie les permissions depuis `auth.uid()`, les mutations d'identité passent par des fonctions `SECURITY DEFINER`, l'Edge Function d'invitation vérifie le JWT et `has_permission()`, et `audit_logs` est alimenté par triggers avec acteur `auth.uid()`. Voir [docs/auth-rbac.md](auth-rbac.md).

---

## 5. Découpage des responsabilités (SOLID)

| Couche | Responsabilité | Interdit |
| --- | --- | --- |
| `pages` / `components` | rendu, interactions, états locaux | appeler `supabase` directement, calculer un montant financier |
| `hooks` | orchestration, cache (TanStack Query), états loading/empty/error | contenir une règle métier |
| `services/repositories` | requêtes, mapping DTO ↔ domaine | décider d'une autorisation |
| `modules/*/rules.ts` | règles pures (prix figé, théorique de caisse, commission, consommation stock, rentabilité) | effets de bord, I/O |
| `schemas` (Zod) | validation des entrées et des réponses | remplacer les contraintes SQL |
| Base (RLS + fonctions) | autorité finale, intégrité, audit | faire confiance au client |

Erreurs : un type `AppError` (extension de l'actuel `ApiError`) normalisé `{ code, message, missing?, cause? }`, traduit en toast par une seule couche. États : `loading` → squelette, `empty` → message explicite (jamais de donnée factice), `error` → retry.

---

## 6. Cycles de vie et énumérations cibles

| Domaine | Actuel | Cible | Migration |
| --- | --- | --- | --- |
| Lavage | `en_attente`, `en_cours`, `termine`, `annule` | `pending`, `assigned`, `in_progress`, `quality_check`, `ready`, `delivered`, `cancelled` | table de correspondance + `wash_status_history` (acteur, date, motif) ; **« terminé » ne vaut pas « livré »** |
| Paiement | `especes`, `mobile_money`, `carte`, `virement` | table `payment_methods` par station : Espèces, Orange Money, MTN MoMo, Wave, Carte, Virement, autres | seed par station ; `mobile_money` historique → méthode générique puis ventilation |
| Devise | `'FCFA'` littéral | `companies.currency` (`XOF` par défaut) + `Intl.NumberFormat` | migration de `formatFCFA` vers `formatMoney(amount, currency)` avec rétrocompatibilité |
| Rôle | 4 valeurs FR | `owner`, `manager`, `cashier`, `washer`, `super_admin` | mapping + `ROLE_LABELS` conservé pour l'affichage FR |
| Caisse | une session, un comptage | `cash_sessions` + `cash_movements` immuables, clôtures figées | convertir l'actuel `countedAmount` en écriture de clôture |
| Commission | recalcul à la volée | `commission_periods` (figé) → `employee_commissions` → `commission_payouts` | ne jamais recalculer une période validée |

---

## 7. États, performance et expérience

- **État serveur** : TanStack Query (clés `[company, station, domain, params]`), invalidation après mutation, optimistic UI uniquement sur les actions réversibles.
- **État UI** : contexte léger (thème, sidebar, filtres persistants), pas de données métier dupliquées.
- **Performance** : pagination côté serveur sur lavages / paiements / mouvements, index `(company_id, station_id, created_at)`, lazy-loading des modules, agrégations de dashboard en vues matérialisées ou fonctions SQL, images via Supabase Storage avec transformations.
- **Accessibilité / responsive** : navigation clavier, focus visible, `aria-*`, tables responsives (déjà présentes via `.wg-scroll-x`), sidebar repliable, cibles tactiles adaptées au terrain.
- **Connectivité** : les stations peuvent avoir un réseau instable. Décision à trancher à l'étape 05 : file d'attente hors ligne avec idempotence, **ou** exigence de connexion explicite. Ne pas promettre un mode hors ligne sans le tester.

---

## 8. Critères de sortie de l'architecture cible

1. `useStore()` conserve sa forme publique ; les 16 écrans rendent sans modification fonctionnelle.
2. `LocalDataAdapter` et `SupabaseDataAdapter` passent **la même suite** `npm run check` (66 assertions) sur les parcours communs.
3. Deux entreprises de test ne peuvent pas se lire mutuellement (test d'isolation).
4. Aucun `company_id` n'est envoyé par le frontend.
5. Aucun mot de passe, aucun token, aucun secret dans `localStorage` ni dans le bundle.
6. `npm run typecheck`, `npm run build`, lint et tests passent en CI.
7. Les documents `docs/database.md`, `docs/security.md` (étapes 03/04) reprennent exactement ce modèle.
