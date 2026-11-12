# 01 — Stratégie de migration progressive vers Supabase (Foundation & Audit)

**Statut :** plan validable, **aucune migration SQL exécutée**, **aucun projet créé**, **aucune clé générée** au titre du Prompt 01.
**Constat de départ :** projet Supabase `lavauto` (`cgxrqorwmmcyqescatzs`, `eu-central-1`, PostgreSQL 17.11) **actif mais vide** (0 migration, 0 table `public`). Le dépôt, lui, contient un frontend complet qui persiste tout dans `localStorage`.

> **Mise à jour 11/11/2026 — Prompt 03 exécuté après validation :** les 10 migrations de la phase 2 sont appliquées, la RLS est active sur les 51 tables, l'isolation A/B est vérifiée et l'adaptateur de lecture est en place. Le détail réel fait foi dans [docs/database.md](database.md). Le texte ci-dessous conserve le plan initial pour trace ; aucune action du Prompt 04 n'est engagée avant nouvelle validation.

---

## 1. Stratégie : étranglement, pas « big bang »

```
ÉTAT ACTUEL                      TRANSITION                        CIBLE
pages → useStore() ──────────►  pages → useStore() [façade] ─────►  pages → hooks/Query
          │                              │                                  │
   StoreProvider                  DataAdapter (interface)            SupabaseDataAdapter
   (localStorage)                ├── LocalDataAdapter  (existant)      ├── repositories
                                 └── SupabaseDataAdapter (nouveau)     └── RPC / RLS
```

| Décision | Choix | Raison |
| --- | --- | --- |
| Ordre | **schéma + RLS d'abord**, Auth ensuite, modules métier après | on ne connecte pas Auth à un modèle non arrêté |
| Découpage | **un module à la fois**, jamais tout le store | 66 contrôles restent verts à chaque étape |
| Bascule | `VITE_DATA_SOURCE=local\|supabase` + sélection par module | rollback immédiat, démo toujours fonctionnelle |
| Écritures | **pas de double écriture** : import unique des données locales, puis bascule de lecture/écriture par module | évite les divergences et les doublons financiers |
| Contrat | la forme de `Ctx` est gelée tant que tous les modules ne sont pas migrés | aucune page à réécrire |
| Autorité | `company_id` dérivé de `auth.uid()`, RLS sur toutes les tables | le frontend n'est jamais une barrière de sécurité |
| Données | import idempotent, checksum avant/après, dump `localStorage` conservé | traçabilité et retour arrière |

**Interdit pendant la migration :** supprimer une fonctionnalité validée, inventer des données d'exemple en production, afficher un bénéfice calculé sur des coûts incomplets, envoyer un message « envoyé » sans fournisseur de communication configuré.

---

## 2. Prérequis de fondations (à faire juste après validation du Prompt 01)

| Action | Détail | Vérification |
| --- | --- | --- |
| Variables d'environnement | `.env.example` → `VITE_SUPABASE_URL`, clé **publishable** (et non `service_role`), `VITE_DATA_SOURCE`, `VITE_SUPABASE_PROJECT_REF` ; validation Zod au démarrage | aucune clé secrète dans le bundle |
| Outils | ESLint + config TS, script `lint`, CI minimale (`npm ci` → `typecheck` → `lint` → `check` → `build`) | pipeline vert |
| TS | activer `noUnusedLocals` / `noUnusedParameters`, supprimer `formatNumber`, `isToday`, `METHOD_LABEL` | `typecheck` vert |
| Migrations | choisir le versionnage (`supabase/migrations/*.sql` via CLI **ou** `create_migration` du connecteur), convention de nommage, environnement de préproduction | une migration vide appliquée puis annulée |
| Jeu de test | **deux entreprises A et B**, deux stations pour A, un utilisateur par rôle | test d'isolation reproductible |

Aucune table métier n'est créée à cette étape : elle appartient au Prompt 03.

---

## 3. Phases (alignées sur les prompts 02 → 10)

### Phase 1 — Prompt 02 : Design system & UX
- **Objectif :** uniformiser sans casser les comportements.
- **DB :** aucune migration. **Données :** aucune.
- **Frontend (réalisé au Prompt 02, voir `docs/design-system.md`) :** `ui.tsx` **conservé tel quel** (API gelée sur consigne explicite, le découpage est reporté) ; `navigation.tsx` (8 sections), `AppShell` (sidebar repliable persistée, groupes dépliables, fil d'Ariane, recherche globale `Ctrl/Cmd + K`, drawer mobile), `feedback.tsx` (`Skeleton`, `LoadingState`, `ErrorState`, `ErrorBoundary`), `ConfirmDialog`, `Breadcrumbs`, `CommandPalette`, `DataTable<T>` (recherche + tri + état vide, sans pagination serveur).
- **Attention :** chaque composant interactif garde son comportement réel ; aucune maquette morte.
- **Tests :** `npm run check` (66) + nouveaux tests des composants ; parcours inscription → mise en route → lavage → caisse rejoués.
- **Rollback :** purement frontend, `git revert`.
- **Sortie :** 16 écrans rendent à l'identique fonctionnellement, thème clair/sombre OK, mobile OK.

### Phase 2 — Prompt 03 : Database & Domain Architecture ✅
- **Objectif :** schéma robuste, RLS, contraintes, fonctions ; **le livrable le plus structurant**.
- **DB :** migrations `001_extensions_and_companies` → `002_identity_rbac` → `003_catalog` → `004_washes` → `005_finance` → `006_hr` → `007_stock` → `008_saas` → `009_rls` → `010_functions_triggers`. UUID, FK, index `(company_id, station_id, created_at)`, `updated_at` par trigger, `deleted_at`, unicité, `timestamptz`.
- **RLS :** politique par table ; `company_id` jamais fourni par le client ; `super_admin` via un mécanisme séparé (pas un `company_id` spécial).
- **Fonctions :** `create_wash_with_items`, `record_payment`, `close_cash_session`, `validate_commission_period`, `receive_purchase_order`, `consume_products_for_wash` — transactions + idempotence + contrôle de permission dans la fonction.
- **Frontend :** créer `DataAdapter`, envelopper `store.tsx` en `LocalDataAdapter`, implémenter un `SupabaseDataAdapter` **en lecture seule** d'abord (bootstrap, plans, catalogue). `PLANS` devient un cache de la table `plans`.
- **Données :** seed des **formules** et des données de démonstration uniquement dans un environnement de test ; aucune donnée d'exemple en production.
- **Tests :** contraintes, unicité, **isolation A/B**, `npm run check` en mode `local` **et** en mode `supabase` (lecture seule).
- **Rollback :** `VITE_DATA_SOURCE=local` ; les migrations restent (additives).
- **Sortie :** deux entreprises ne peuvent pas se lire ; schéma documenté dans `docs/database.md`.

### Phase 3 — Prompt 04 : Auth, multi-tenancy, RBAC ✅
- **DB :** `user_profiles`, `roles`, `permissions`, `role_permissions`, `user_station_assignments`, triggers d'audit, configuration Auth (redirect URI, JWT, confirmation e-mail).
- **Frontend :** Supabase Auth (inscription, connexion, déconnexion, **mot de passe oublié réel** — ce qui lève une divergence assumée avec le texte actuel qui renvoie vers *Employés* : le texte devra être mis à jour ici, avec validation explicite), invitations, affectations multi-stations, `usePermissions`, `RoleRoute` conservé comme confort.
- **Données :** **aucun import de mots de passe**. Les comptes de démo sont recréés via invitation ; reset obligatoire. Suppression de `passwords` de `AppState`.
- **Tests :** accès non autorisé, session expirée, utilisateur désactivé, élévation de privilèges, isolation, `fetchMeOnce` remplacé par `onAuthStateChange` sans boucle de requêtes.
- **Sortie :** aucune session forgeable depuis `localStorage` ; 20 migrations à la livraison P04 (23 après P05), 31 permissions, `docs/auth-rbac.md` livré. Validation explicite des quatre choix `reset_oui`, `confirm_keep`, `no_accounts`, `env_oui` reçue avant exécution.

### Phase 4 — Prompt 05 : Cœur métier lavages (priorité métier n°1) ✅
- **DB :** `vehicles`, `vehicle_categories`, `services`, `service_prices`, `washes`, `wash_items`, `wash_assignments`, `wash_status_history`, `wash_posts`, `wash_quality_checks`.
- **Frontend :** nouveau lavage, file d'attente, postes, affectations multiples, 7 statuts, contrôle qualité, historique véhicule ; **conserver** le prix figé (`unitPrice`) et la grille tarifaire existante.
- **Migration des données :** mapping des 4 statuts FR → 7 statuts EN (table de correspondance), création d'un `wash_status_history` initial par lavage importé.
- **Tests :** un lavage « terminé » n'est pas « livré » ; aucun lavage compté deux fois ; prix inchangé après modification de la grille.
- **Sortie :** cycle complet arrivée → restitution traçable.
- **Livré :** validation `p05_complet`, migrations `021`/`022`/`023`, RPC serveur, 7 statuts EN + mapping FR→EN, postes/affectations, contrôle qualité, historique véhicule, frontend, 17/17 tests distants, [docs/washes.md](washes.md).

### Phase 5 — Prompt 06 : Caisse, paiements, finance, rentabilité (priorité n°2)
- **DB :** `payment_methods`, `payments`, `cash_sessions`, `cash_movements`, `expenses`, `expense_categories`, `commission_periods`, `employee_commissions`, `commission_payouts`.
- **Frontend :** paiements partiels/remboursements, rapprochement **par canal** (espèces ≠ Mobile Money), clôtures immuables, relevés de commission figés, rapport de rentabilité avec état « coûts manquants ».
- **Règle :** ne jamais remplacer `collected - expenses` par un « bénéfice net » ; distinguer CA, encaissé, créances, achats, consommations, commissions, charges fixes, marge, résultat.
- **Migration :** convertir `CashSession.countedAmount` en mouvement de clôture ; rattacher les `payments` existants à une méthode ; créer les `cash_movements` correspondants.
- **Tests :** solde théorique = fond + encaissements espèces − décaissements espèces ; aucun paiement dupliqué ; période de commission validée non recalculable.
- **Livré :** validation `p06_complet`, migrations `024`–`029`, 32/32 contrôles distants en `ROLLBACK`, finance branchée sur RPC, clôtures immuables, rapprochement par canal, commissions figées, rapport « coûts manquants », [docs/finance.md](finance.md).

### Phase 6 — Prompt 07 : Stock, fournisseurs, approvisionnements
- **DB :** `products`, `product_categories`, `suppliers`, `purchase_orders`, `purchase_order_items`, `stock_movements`, `inventory_sessions`, `inventory_items`, consommations théoriques par prestation.
- **Frontend :** catalogue, commandes (le stock n'augmente **qu'à la réception**), inventaires avec écarts, alertes, valorisation.
- **Lien avec la rentabilité :** c'est cette phase qui fournit le coût des consommations nécessaire à TD-13. Sans elle, aucun résultat net honnête.
- **Tests :** stock jamais négatif sans autorisation, réception partielle, mouvement jamais supprimé, consommation générée une seule fois par lavage.

### Phase 7 — Prompt 08 : CRM, fidélisation, flottes — **livré** (`p08_complet`)
- **DB :** extension `customers`, `vehicles`, `loyalty_*`, `packages`, `promotions`, `fleets`, contrats, créances ; **architecture de notifications sans fournisseur = aucun envoi simulé**.
- **Frontend :** fiche client enrichie, historique, points/carte/forfaits, promotions, flottes, préférence de canal de communication.
- **Tests :** conditions et dates de validité des forfaits, aucune promotion appliquée deux fois.
- **Livré :** migrations `034`–`038`, 13 tables, 18 RPC, `my_crm_board()`, 2 routes réelles, [`docs/crm.md`](crm.md) et `supabase/tests/p08_rollback.sql` **35/35** en `BEGIN … ROLLBACK`, 0 fixture.

### Phase 8 — Prompt 09 : Analytics, multi-stations, administration SaaS — **livré** (`p09_complet`)
- **DB :** vues d'agrégation / fonctions de rapport, `subscription_usage`, limites contrôlées côté serveur, `plans` administrables.
- **Frontend :** dashboards station et consolidé, graphiques Recharts, comparaison de périodes avec **les mêmes définitions métier**, classement des stations, back-office super admin (entreprises, abonnements, suspension, journaux, quotas).
- **Attention :** les tarifs 0 / 15 000 / 35 000 FCFA restent des **hypothèses commerciales** à valider sur le terrain ivoirien, administrables depuis le back-office.
- **Tests :** cohérence des indicateurs entre périodes et entre stations ; quota refusé au-delà de la limite.
- **Livré :** migrations `039`–`044`, 2 vues, 12 RPC, quotas serveur, dashboards station/consolidé Recharts, classement par CA, back-office super admin, [`docs/analytics.md`](analytics.md) et [`supabase/tests/p09_rollback.sql`](../supabase/tests/p09_rollback.sql) **30/30** en `BEGIN … ROLLBACK`, 0 fixture.

### Phase 9 — Prompt 10 : QA, sécurité, performance, déploiement
- **DB :** EXPLAIN sur les requêtes critiques, index complémentaires, sauvegardes, stratégie de migration et de rollback.
- **Frontend :** pagination serveur, lazy loading, optimisation des images (Storage), gestion des erreurs réseau, idempotence.
- **Tests :** 15 parcours de bout en bout (Playwright), tests de sécurité (isolation, permissions, fichiers, finances), tests de cohérence, Vitest sur les règles pures.
- **Déploiement :** Vercel (frontend) + Supabase (Auth/PostgreSQL/Storage), env dev/prod, CORS, redirect URI, CI/CD, documentation (`installation`, `architecture`, `database`, `security`, `user-guide`, `deployment`, `testing`).

---

## 4. Mapping des données locales → tables

| `washguard.state.v1` | Table(s) cible(s) | Transformation / idempotence |
| --- | --- | --- |
| `company` | `companies` | `id` conservé comme clé d'import ; `currency='XOF'` |
| `station` | `stations` | une ligne ; `company_id` dérivé du profil, pas du client |
| `users` + `passwords` | `user_profiles`, `user_station_assignments` | **mots de passe ignorés** ; invitations + reset ; `role` FR → EN |
| `vehicleCategories` | `vehicle_categories` | mapping d'ID |
| `services[].prices` | `services`, `service_prices` | éclater le `Record` en lignes ; unicité `(service, category)` |
| `clients` | `customers`, `vehicles` | `plate` → véhicule ; client facultatif conservé (lavage sans client autorisé) |
| `washes`, `items`, `payments` | `washes`, `wash_items`, `payments`, `wash_status_history` | `unitPrice` conservé tel quel ; statuts mappés ; `number` unique par station |
| `cashSessions` | `cash_sessions`, `cash_movements` | `countedAmount` → clôture ; `reopenReason` → mouvement tracé |
| `expenses` | `expenses` | `annulee` conservée avec `cancelReason` ; aucune suppression |
| `subscription` | `subscriptions` | `planId` → FK `plans` ; `pendingPlanId` → demande |
| `auditLogs` | `audit_logs` | import à part, acteur « import » ; **ne pas écraser** le journal serveur |
| `platformCompanies` | back-office / vue sur `companies` | ne pas importer comme table métier : dériver |
| `session`, `theme`, `demoMode`, `washCounter` | — | **non migrés** : session = Auth, thème = préférence UI, compteur = séquence SQL |

**Imports :** un script `scripts/import-local.ts` lit un export JSON du `localStorage`, vérifie les doublons par `id` d'origine (`external_id`), écrit dans une transaction, produit un rapport `{tables, lignes, ignorés, erreurs}`. Réexécutable sans doublon.

---

## 5. Tables de correspondance

| Statut actuel | Statut cible | Note |
| --- | --- | --- |
| `en_attente` | `pending` | en file d'attente |
| — | `assigned` | affectation employé/poste |
| `en_cours` | `in_progress` | — |
| — | `quality_check` | contrôle qualité obligatoire avant restitution |
| `termine` | `ready` | **le lavage terminé n'est pas livré** |
| — | `delivered` | restitution au client |
| `annule` | `cancelled` | motif conservé |

| Méthode actuelle | Cible |
| --- | --- |
| `especes` | Espèces (canal physique, impacte la caisse) |
| `mobile_money` | méthode générique à ventiler : Orange Money / MTN MoMo / Wave |
| `carte` | Carte bancaire |
| `virement` | Virement |
| — | autres méthodes configurables par station, sans impact caisse physique |

| Rôle actuel | Rôle cible |
| --- | --- |
| `proprietaire` | `owner` |
| `gerant` | `manager` |
| `caissier` | `cashier` |
| — | `washer` (laveur) |
| `support` | `super_admin` (service plateforme, hors `company_id`) |

---

## 6. Cutover et retour arrière

1. **Shadow read** : le `SupabaseDataAdapter` lit en parallèle du local, on compare les résultats (aucune écriture).
2. **Import** : une seule fois, idempotent, sur l'environnement cible ; rapport de contrôle validé.
3. **Bascule par module** : `VITE_DATA_SOURCE=supabase` + liste `MIGRATED_MODULES` ; commencer par le catalogue/lecture, finir par **lavages → caisse → paiements** (les plus sensibles).
4. **Vérification** : `npm run check` dans les deux modes, tests d'isolation A/B, tests de cohérence financière, comparaison des totaux avant/après.
5. **Rollback** : repasser le flag sur `local`, sans suppression de données serveur ; l'import reste rejouable.
6. **Décommissionnement** (uniquement après validation) : retirer `passwords`, `LocalDataAdapter` et `washguard.state.v1`, conserver le mode démo derrière un jeu de données de test explicite.

---

## 7. Définition de « terminé » pour chaque phase

- `npm ci && npm run typecheck && npm run lint && npm run check && npm run build` : **verts**.
- Les assertions existantes passent **dans les deux modes** : P04 clôture, puis refonte de `/`, à **140 OK / 0 KO · local** et **141 OK / 0 KO · supabase**.
- Tests d'isolation entreprises A/B : **0 fuite**.
- Tests de cohérence financière : aucun doublon, aucun montant négatif incohérent, aucune clôture modifiée sans trace.
- Aucune fonctionnalité de la liste §3.1 de `architecture-audit.md` n'a disparu.
- Rapport d'étape produit (9 points demandés par le playbook : avant / réutilisé / créé / modifié / fichiers / migrations / tests / problèmes restants / prochaine étape).
- **Attente de validation explicite avant la phase suivante.**

---

## 8. Prochaine étape

Les **Prompts 01 à 10 sont livrés et documentés**. Le Prompt 10 a été exécuté sur les validations explicites `p10_complet` + `levee_totale` : QA, sécurité Storage, `EXPLAIN`/index, sauvegardes et rollback, pagination serveur, lazy loading, optimisation des images par Storage privé, gestion des erreurs réseau, idempotence, 15 parcours Playwright, tests de sécurité/cohérence, Vitest, CI/CD Vercel/Supabase et 7 documents de déploiement. L'ancienne entrée désactivée « Prévisions & alertes » est remplacée par l'écran réel `/app/qualite` : aucune prévision ni alerte n'est fabriquée.

À la livraison P10, le projet Supabase `lavauto` portait **49 migrations** (10 P03 + 10 P04 + 3 P05 + 6 P06 + 4 P07 + 5 P08 + 6 P09 + 5 P10, correctif `048` retiré) et **70 tables publiques**. Depuis, `051` et `052` ont été appliquées via le connecteur : 51 migrations et 71 tables sous RLS ont été constatées. La recette métier réelle et le déploiement du frontend de cette branche restent à faire ; voir [testing.md](testing.md). P10 ajoutait 1 table d'idempotence, 5 index, 4 RPC, 1 bucket privé, 10 policies Storage dont 5 gardes `RESTRICTIVE`, et conservait les 2 vues / 12 RPC / 3 triggers de quota de P09. `BarberShop` n'est pas touché. Aucun compte Auth de test, e-mail, secret ou clé API n'a été créé. Les tests d'intégration P05 (17/17), P06 (32/32), P07 (**22/22**), P08 (**35/35**), P09 (**30/30**) et P10 (**30/30**) ont été exécutés en `BEGIN … ROLLBACK` : 0 donnée résiduelle. La PR #3 a été fusionnée dans `main` (`f6f6301`) ; les 15 specs Chromium ont aussi été exécutées localement avec un binaire empaqueté récupéré depuis npm, et la CI GitHub Actions les rejoue avec l'installation officielle. `site_url` et l'allow-list Auth utilisent désormais `https://lavauto-five.vercel.app` ; la mise en production finale reste conditionnée aux secrets `VERCEL_*`, aux variables `VITE_SUPABASE_*` et aux origines CORS Supabase (voir [`deployment.md`](deployment.md)).
