# 01 — Dette technique et registre des risques (Foundation & Audit)

**Statut :** inventaire priorisé, **aucune correction de code au titre de ce prompt**. Référence : `docs/architecture-audit.md`, `docs/audit.md`.
**Légende gravité :** 🔴 bloquant pour un SaaS · 🟠 important · 🟡 amélioration · ✅ déjà traité en 1.0.1.

> **Mise à jour après le Prompt 02** (détail dans `docs/design-system.md`) : **soldées** TD-24 et TD-26 ; **partielle** TD-20 (états de chargement / erreur / vide réels, mais aucune requête serveur à squelettiser tant que Supabase n'est pas branché) ; TD-22 **volontairement reportée** car l'API publique de `ui.tsx` a été gelée sur consigne explicite. Restent notamment ouvertes : TD-29 (lint/CI), TD-21 (Zod), TD-23 (pagination serveur), TD-28, TD-30 à TD-38. **Aucune dette 🔴 de la section 2 n'a été traitée** : elles relèvent des Prompts 03/04.
>
> **Mise à jour après le Prompt 04** (détail dans `docs/auth-rbac.md`) : TD-01, TD-05, TD-35 et S-01/S-05/S-07/S-08 sont **soldés** (Supabase Auth, `onAuthStateChange`, `usePermissions`, RLS et `has_permission()` serveur, plus aucun mot de passe dans `AppState`). TD-29 est **partiellement traitée** : `npm run lint` existe sous forme de lint statique sans dépendance ; ESLint/Prettier et CI restent ouverts. TD-19, TD-20, TD-21, TD-23, TD-27, TD-28, TD-30 à TD-34 et TD-36 à TD-38 restent ouvertes. Le cycle lavages P05 est branché sur RPC (TD-10 soldé) ; la finance P06 est branchée sur RPC et l'état « coûts manquants » est explicite. **Mise à jour après le Prompt 07** : TD-13 est **soldée** — consommations valorisées, achats rattachés et attestation immuable publient un résultat net uniquement quand les coûts sont complets ; hors attestation, `result` et `grossMargin` restent `NULL`.

> **Mise à jour après le Prompt 03** (détail dans `docs/database.md`) : TD-19 **partielle** ; TD-20 **partielle** ; TD-30 **partielle** ; TD-27 ouverte (Storage non configuré).

---

## 1. Dette déjà remboursée (ne pas refaire)

| ✅ | Sujet | Fichier |
| --- | --- | --- |
| ✅ | Injection de formule dans les exports CSV | `src/lib/format.ts` |
| ✅ | `allowedHosts: true` (DNS rebinding en dev) | `vite.config.ts` |
| ✅ | URL directes non protégées par rôle | `src/App.tsx` (`RoleRoute`) |
| ✅ | Encaissement / statut sur fiche annulée | `src/lib/store.tsx` |
| ✅ | Double annulation de dépense, réouverture de caisse multiple, double comptage | `store.tsx`, `metrics.ts` |
| ✅ | Décalage de date sur `aaaa-mm-jj` | `format.ts` |
| ✅ | Flash de thème sombre | `index.html` |
| ✅ | Reliquats CRA (`jsconfig.json`, `prettier.config.js`, manifest) | racine / `public/` |
| ✅ | Dérive de versions hors lock | `package.json` (outils de test pinnés) |
| ✅ | 66 contrôles automatisés reproductibles | `scripts/check.cjs` |

---

## 2. Dette bloquante pour le SaaS

| ID | Gravité | Dette | Impact | Fichiers | Correction | Étape |
| --- | --- | --- | --- | --- | --- | --- |
| TD-01 | 🔴 | Mots de passe en clair + auth locale | Aucune sécurité des comptes, RGPD, vol de session | `types.ts` (`passwords`), `store.tsx` (`signIn`, `addEmployee`, `resetPassword`) | Supabase Auth, suppression du champ, reset obligatoire à la migration | 04 |
| TD-02 | 🔴 | Règles métier contournables via `localStorage` | `station.activated`, `role`, montants modifiables → faux 409, faux paiements | `store.tsx` | RPC `SECURITY DEFINER` + contraintes SQL + RLS | 03/04 |
| TD-03 | 🔴 | Mono-entreprise / mono-station dans `AppState` | Impossible de vendre un SaaS multi-stations | `types.ts` (`company`, `station`, `session.stationId`), toutes les pages | `companies 1:N stations`, `user_station_assignments`, sélecteur de station | 03/04 |
| TD-04 | 🔴 | Aucune table, aucune RLS, aucune migration | Aucune persistance serveur | projet Supabase `lavauto` (vide) | schéma versionné + politiques sur toutes les tables | 03 |
| TD-05 | 🔴 | Permissions = masquage UI | Un caissier peut forger une requête | `App.tsx`, `AppShell.tsx` | `permissions` + vérification serveur dans chaque fonction sensible | 04 |
| TD-06 | 🔴 | `company_id` non dérivé du JWT | Risque d'accès inter-entreprises | à concevoir | `user_profiles` + claim, jamais de `company_id` venant du client | 03/04 |
| TD-07 | 🟠 | Journal d'audit local, éditable, plafonné à 200 | Non-conformité, perte de preuve | `logAction()` | `audit_logs` append-only, acteur `auth.uid()`, triggers | 03 |
| TD-08 | 🟠 | Quotas d'abonnement non appliqués | `plans.limits` décoratif : 5 stations, 50 employés, lavages illimités non contrôlés | `plans.ts`, `Subscription.tsx` | `subscription_usage` + contrôle serveur à chaque création | 09 |

---

## 3. Dette de modèle de données et de calcul

| ID | Gravité | Dette | Correction | Étape |
| --- | --- | --- | --- | --- |
| TD-09 | 🟠 | `Service.prices` est un `Record` embarqué | table `service_prices` (une ligne par catégorie), contrainte d'unicité, historique des tarifs | 03/05 |
| TD-10 | ✅ | 4 statuts FR sans historique | **Soldé au P05** : 7 statuts EN + mapping + `wash_status_history` (acteur, date, motif) ; « terminé » ≠ « livré » | 05 |
| TD-11 | 🟠 | 4 moyens de paiement codés en dur | `payment_methods` configurable par station (Orange Money, MTN MoMo, Wave…), référence de transaction | 03/06 |
| TD-12 | 🟠 | `currency: 'FCFA'` + suffixe codé en dur | `companies.currency` = `XOF`, `formatMoney()` via `Intl.NumberFormat`, formatage local | 03/09 |
| TD-13 | ✅ | `result = collected - expenses` présenté comme indicateur | **P06** : distinctions comptables + `partialBalance` + `costsMissing=true` ; **P07** : consommations valorisées, achats rattachés, attestation immuable et `result`/`grossMargin` publiés seulement après certification | 06/07 |
| TD-14 | 🟠 | Commissions recalculées, jamais figées | `commission_periods` validés, `employee_commissions` figés, `commission_payouts` | 06 |
| TD-15 | 🟠 | Caisse : un seul comptage, clôture modifiable | `cash_movements` immuables, clôtures non éditables, rapprochement **par canal** (espèces ≠ Mobile Money) | 06 |
| TD-16 | 🟡 | `uid()` = `Math.random()` | `gen_random_uuid()` côté base ; `crypto.randomUUID()` pour les clés d'idempotence client | 03 |
| TD-17 | 🟡 | Annulations tracées mais sans mouvement inverse explicite | mouvements d'annulation (paiement, dépense, réception) plutôt que simple `status` | 06/07 |
| TD-18 | 🟡 | `AuditLog` / `PlatformCompany` mélangent données métier et plateforme | séparer `audit_logs` (métier) et `platform_*` (back-office) | 03/09 |

---

## 4. Dette frontend / UX

| ID | Gravité | Dette | Correction | Étape |
| --- | --- | --- | --- | --- |
| TD-19 | 🟠 | `store.tsx` = 759 lignes mêlant état, règles, persistance, toasts, thème | façade `StoreProvider` + `LocalDataAdapter` + `modules/*/rules.ts` | 01/03 |
| TD-20 | 🟠 | Aucun état de chargement / erreur réseau / skeleton / error boundary | design system + TanStack Query, retry, états vides explicites | 02/03 |
| TD-21 | 🟠 | Formulaires sans validation de schéma | Zod (+ React Hook Form) et remontée des erreurs serveur | 02/05 |
| TD-22 | 🟡 | `components/ui.tsx` (242 lignes) regroupe 15 primitives | scinder en `components/ui/*` **en conservant l'API publique** | 02 |
| TD-23 | 🟡 | Pas de pagination (toutes les listes chargent tout) | pagination serveur + `DataTable` | 09/10 |
| TD-24 | ✅ | Pas de recherche globale, pas de breadcrumbs, sidebar non repliable | **Fait au 02** : `navigation.tsx`, `Breadcrumbs`, `CommandPalette`, sidebar repliable persistée | 02 |
| TD-25 | 🟡 | Pas de graphiques (Recharts) | `components/charts` | 09 |
| TD-26 | ✅ | `window.confirm` pour la réinitialisation de démo | **Fait au 02** : `ConfirmDialog` accessible (focus piégé, Échap, ARIA) | 02 |
| TD-27 | 🟡 | `logoUrl` non validé, fichiers non hébergés | `https:`/`data:image` + Supabase Storage (justificatifs, logos) | 03/06 |
| TD-28 | 🟡 | Libellés en dur dans les pages (pas de i18n) | centraliser les chaînes FR ; préparer l'i18n sans la livrer | 02 |

---

## 5. Dette outillage / qualité

| ID | Gravité | Dette | Correction | Étape |
| --- | --- | --- | --- | --- |
| TD-29 | 🟡 | Aucun ESLint / Prettier, aucune CI (`.github/` absent) | **P04** : `scripts/lint.cjs` fournit `npm run lint` sans dépendance ; ESLint/Prettier + CI restent à faire | 04/10 |
| TD-30 | 🟠 | `npm run check` couvre le frontend local mais aucun test de base, d'isolation, ni E2E | Vitest (règles + RLS via SQL), Playwright (15 parcours) | 03/10 |
| TD-31 | 🟡 | `strict: true` mais `noUnusedLocals: false`, `noUnusedParameters: false`, `skipLibCheck: true`, pas de `noUncheckedIndexedAccess` | durcir progressivement, corriger les erreurs remontées | 01 |
| TD-32 | 🟡 | Code mort : `formatNumber`, `isToday`, `METHOD_LABEL` | supprimer ou intégrer à `Intl` | 01 |
| TD-33 | 🟡 | `react-router-dom` 6.30.6 : avis modéré, correctif en v7 **breaking** | migration planifiée et testée séparément (routes, `Navigate`, `useNavigate`) | 10 |
| TD-34 | 🟡 | `npm audit` : 5 modérées (3 outils de build + react-router) | surveiller ; aucune exposition navigateur | 10 |
| TD-35 | ✅ | `fetchMeOnce` mémorise la promesse à vie | **Soldée P04** : `onAuthStateChange` + vol unique + déduplication par JWT | 04 |
| TD-36 | 🟡 | `.env.example` vide, aucune validation des variables | schéma Zod pour l'env, `.env.local` documenté, secrets jamais committés | 01/10 |
| TD-37 | 🟡 | `make rendu` / captures d'écran et `Cache-Control: no-cache` absents | à arbitrer côté hébergement / API | 02/10 |
| TD-38 | 🟢 | Aucune documentation d'installation, base, sécurité, déploiement, tests | 7 documents livrés au Prompt 10 | 10 |

---

## 6. Registre des risques

| R | Risque | Probabilité | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R-01 | Migration « big bang » qui casse les 16 écrans validés | Moyenne | 🔴 | adaptateur + bascule module par module + `npm run check` à chaque étape |
| R-02 | Perte des données de démo / de vraies stations lors du passage à Supabase | Moyenne | 🔴 | import idempotent, dump `localStorage` avant cutover, rollback par flag |
| R-03 | RLS mal configurée → fuite inter-entreprises | Moyenne | 🔴 | tests d'isolation avec **deux** entreprises, revue des politiques, aucune `USING (true)` |
| R-04 | Import des mots de passe en clair | Faible | 🔴 | interdit : reset obligatoire, aucune colonne de mot de passe |
| R-05 | Mauvais mapping des statuts FR → EN → lavages « livrés » par erreur | Élevée | 🟠 | table de correspondance versionnée + tests ; « terminé » ne déclenche pas la livraison |
| R-06 | Faux bénéfice affiché (encaissements − dépenses) | Élevée | 🟠 | TD-13, libellés explicites, état « données manquantes » |
| R-07 | Double comptage financier (paiement dupliqué, commission recalculée, stock négatif) | Moyenne | 🟠 | idempotence, contraintes d'unicité, mouvements immuables, tests de cohérence |
| R-08 | Multi-devise / fuseaux (Abidjan UTC+0, extension à d'autres pays) | Moyenne | 🟡 | `XOF` configurable, `timestamptz`, périodes calculées côté serveur |
| R-09 | Connectivité instable en station | Élevée | 🟠 | décision explicite file hors ligne ou connexion requise ; ne pas simuler |
| R-10 | Multiplication des dossiers / sur-ingénierie | Moyenne | 🟡 | P1/P2 de `architecture-target.md` : aucun dossier vide |
| R-11 | Migration React Router v7 cassant les gardes | Moyenne | 🟡 | étape dédiée, tests de routes, pas de mélange avec une migration métier |
| R-12 | Tarifs `PLANS` (0 / 15 000 / 35 000 FCFA) pris pour des valeurs validées | Élevée | 🟡 | documenter comme hypothèses commerciales, rendre administrables en back-office |
| R-13 | Projet Supabase `BarberShop` (inactif) utilisé par erreur | Faible | 🟡 | cible unique documentée : `cgxrqorwmmcyqescatzs` ; ne jamais toucher `fpapxbfsiiwgpvsefsec` |
| R-14 | Limites du plan Supabase (connexions, stockage, branchements) | Moyenne | 🟡 | mesurer en préproduction, pagination et agrégations dès l'étape 03 |

---

## 7. Ordre de remboursement recommandé

1. **Fondations :** TD-29 partiellement traitée au P04 (`npm run lint` statique) ; TD-31, TD-32, TD-36 et CI restent à faire avant le durcissement final.
2. **Autorité serveur :** TD-04 → TD-06 → TD-03 → TD-01/TD-05/TD-07. C'est le vrai saut de nature : schéma, RLS, Auth, multi-tenant.
3. **Cœur métier :** TD-10 soldé au Prompt 05 ; TD-09 / TD-11 → TD-15 → TD-13 → TD-14 traités au Prompt 06 (caisse, canaux, clôtures, commissions figées, rentabilité honnête).
4. **Rentabilité :** TD-13 **soldée au Prompt 07** : la consommation de produits est un coût direct valorisé au coût moyen, et le résultat net reste conditionné à une attestation de période.
5. **UX et analytics :** TD-19 à TD-28, TD-25, puis Prompt 09.
6. **Durcissement final :** TD-38 soldée au Prompt 10 ; TD-30, TD-33 et TD-34 restent suivies séparément.

**Règle de non-régression :** chaque remboursement doit laisser `npm ci && npm run typecheck && npm run build && npm run check` verts. Toute dette non traitée doit rester **visible** dans ce fichier plutôt que masquée par une interface qui paraît terminée.
