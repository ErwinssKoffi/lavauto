# 02 — Design system & UX (Foundation → ERP SaaS)

**Statut :** livré au Prompt 02 · **aucune migration SQL**, **aucune connexion Supabase**, **aucune dépendance installée en P02**, **aucune règle métier modifiée**. Le Prompt 09 ajoute uniquement `recharts@2.15.4` pour les graphiques.
**Contraintes respectées :** `src/components/ui.tsx` n'a pas été touché (18 exports intacts) · `useStore()` garde exactement le même contrat · les 16 routes et les gardes `RoleRoute` sont inchangées · les 66 contrôles repassent.

Références : [architecture-audit.md](architecture-audit.md) · [architecture-target.md](architecture-target.md) · [technical-debt.md](technical-debt.md) · [migration-roadmap.md](migration-roadmap.md).

---

## 1. Principes de conception

Inspiration Linear / Vercel / Stripe / Notion / Apple, **sans copier leur identité** :

| Principe | Traduction concrète |
| --- | --- |
| Hiérarchie par la surface, pas par la couleur | cartes sur `var(--wg-surface)`, panneaux imbriqués sur `--wg-surface-2`, bordures fines, ombres à deux niveaux (`--wg-elev-1/2`) |
| Un seul accent | le bleu WashGuard, réservé à l'action et à la sélection ; le rouge/ambre/vert restent des états métier |
| Densité lisible sur le terrain | texte de navigation 13 px, tableaux 13,6 px, groupes en capitales 10 px espacées |
| Mouvement discret | `wg-fade-in` 320 ms, transitions 150–200 ms, **entièrement désactivables** via `prefers-reduced-motion` |
| Le clavier compte | anneau `:focus-visible` global, fil d'Ariane, `aria-sort`, `aria-expanded`, piège de focus, `Ctrl/Cmd + K` |
| Pas de maquette morte | tout composant ajouté est branché sur un écran existant et testé |

**Décision de périmètre :** le découpage de `components/ui.tsx` en `components/ui/*` prévu au §2 de `architecture-target.md` est **reporté**. L'API publique a été gelée sur demande explicite pour ce prompt ; les nouveaux composants vivent donc dans des fichiers frères. Aucun doublon de primitive n'a été créé : `ConfirmDialog` et `DataTable` réutilisent `Card` / `EmptyState` / les classes `wg-*`.

---

## 2. Tokens (`src/index.css`)

Toutes les variables historiques (`--wg-bg`, `--wg-surface`, `--wg-border`, `--wg-accent`, …) sont **conservées à l'identique** : les 16 écrans gardent le même contrat visuel en thème clair et sombre.

| Token ajouté | Rôle |
| --- | --- |
| `--wg-overlay` | fond des modales / palette, avec flou ; plus opaque en sombre |
| `--wg-elev-1`, `--wg-elev-2` | ombres de carte et de superposition |
| `--wg-nav-hover` | survol des éléments de navigation, adapté au thème |
| `--wg-skeleton` | base du shimmer des états de chargement |
| `--wg-ring`, `--wg-radius`, `--wg-radius-sm` | anneau de focus et rayons cohérents |
| `color-scheme: light / dark` | contrôles natifs (select, date, scrollbar) alignés sur le thème |

Classes ajoutées (aucune classe retirée) : `wg-card-hover`, `wg-elev-1`, `wg-elev-2`, `wg-overlay`, `wg-kbd`, `wg-group-label`, `wg-nav-item`, `wg-nav-item-active`, `wg-nav-item-soon`, `wg-skeleton`, `wg-scroll-thin`, `wg-topbar`.

Accessibilité : `:focus-visible` global (2 px, offset 2 px) + bloc `@media (prefers-reduced-motion: reduce)`.

---

## 3. Composants réels créés

| Fichier | Composant | Comportement réel | Branché sur |
| --- | --- | --- | --- |
| `src/components/navigation.tsx` | `NAV_GROUPS`, `groupsForRole`, `findEntry`, `NAV_PATHS`, `normalizeNavText` | configuration unique des 8 sections, filtrage par rôle, 13 URL, comparaison insensible aux accents | `AppShell`, `CommandPalette` |
| `src/components/feedback.tsx` | `Skeleton`, `LoadingState`, `ErrorState`, `ErrorBoundary` | état de chargement, état d'erreur avec reprise, barrière de rendu (pas de fausse donnée) | `main.tsx` (`ErrorBoundary`), `App.tsx` (`LoadingState`) |
| `src/components/ConfirmDialog.tsx` | `ConfirmDialog` | `role="dialog" aria-modal`, focus piégé, **Échap**, clic fond, labels ARIA via `useId`, action différée | `Settings.tsx` (réinitialisation de démo, remplace `window.confirm`) |
| `src/components/CommandPalette.tsx` | `CommandPalette` | `Ctrl/Cmd + K`, recherche insensible aux accents sur libellé + section + mots-clés, ↑/↓, **Entrée qui navigue**, Échap, aucun écran non autorisé | `AppShell` |
| `src/components/Breadcrumbs.tsx` | `Breadcrumbs` | fil d'Ariane dérivé de l'URL courante, `aria-current="page"` | `AppShell` (topbar) |
| `src/components/DataTable.tsx` | `DataTable<T>` | recherche locale, tri réel avec `aria-sort`, état vide explicite, `rowKey`, pied de tableau, générique et typé | `Commissions.tsx` (détail par laveur) |

`DataTable` n'affiche **jamais** de ligne d'exemple : à vide, il rend `EmptyState` avec un message métier. Le pied de tableau des commissions précise désormais « Total de la période (tous laveurs) » : le total reste calculé sur toutes les lignes, même si un filtre de recherche est appliqué — c'est explicité sous le tableau pour éviter un chiffre trompeur.

---

## 4. Navigation ERP — 8 sections

| Section | Écrans existants (URL inchangées) | Rôles | À venir (désactivé, non cliquable) |
| --- | --- | --- | --- |
| **Pilotage** | Tableau de bord, Mise en route | STAFF / MANAGERS | — |
| **Exploitation** | Lavages | LIVRÉ | Postes, affectations, 7 statuts (P05) |
| **Commercial** | Clients, Prestations, Fidélisation & forfaits, Flottes & contrats | STAFF / MANAGERS | — |
| **RH** | Employés, Commissions | MANAGERS | — |
| **Finance** | Caisse, Dépenses | STAFF | — |
| **Stock** | Stocks & achats, Consommations | MANAGERS | — |
| **Analyse** | Rapports | MANAGERS | Consolidation multi-stations (P09) |
| **Administration** | Paramètres, Abonnement, Espace plateforme | MANAGERS / OWNER / SUPPORT | — |

- `STAFF` = propriétaire, gérant, caissier · `MANAGERS` = propriétaire, gérant · `OWNER` = propriétaire · `SUPPORT` = support.
- **Les 13 écrans historiques gardent exactement leurs URL et leurs rôles** ; P07 ajoute 2 écrans réels (`/app/stock`, `/app/consommations`), P08 2 écrans réels (`/app/fidelisation`, `/app/flottes`) et P09 `/app/consolidation`, soit **18 URL `/app`**, sans navigation parallèle. Le fil d'Ariane et la palette lisent la même configuration.
- Les entrées restantes « à venir » sont des `<span aria-disabled="true">` avec un badge d'étape et un `title` explicatif : **aucun lien mort, aucune page visuelle vide**. Les deux entrées P07 sont de vrais liens filtrés par `inventory.view` / `inventory.consume` ; les deux entrées P08 par `crm.view` / `fleets.view`.
- Le rôle `support` ne voit que l'Administration → Espace plateforme, comme avant. Le badge « N étapes manquantes » de Mise en route est conservé.

### Shell (`src/components/AppShell.tsx`)

- Sidebar repliable (76 px ↔ 256 px) avec préférence persistée dans `washguard.sidebar.collapsed` ; groupes dépliables avec `aria-expanded`.
- Topbar : fil d'Ariane, bouton de recherche `Ctrl K`, badge démo, bascule de thème, FAQ, menu compte (Paramètres toujours réservé propriétaire/gérant).
- Drawer mobile conservé, overlay stylé, titre courant affiché sous `sm`.
- Bandeau « Mise en route en cours » et garde du rôle `support` **inchangés** : aucune fonctionnalité supprimée.

---

## 5. États, erreurs, responsive

| État | Traitement |
| --- | --- |
| Chargement | `LoadingState` sur la vérification de session (un seul appel `/auth/me`, comportement préservé) |
| Vide | `EmptyState` existant + état vide de `DataTable`, sans donnée factice |
| Erreur de rendu | `ErrorBoundary` avec `ErrorState` et bouton « Réessayer » |
| Action destructrice | `ConfirmDialog` (plus de `window.confirm`) |
| Confirmation / info | `ToastHost` existant, non modifié |

Responsive : sidebar desktop / drawer mobile, topbar qui tronque, tableaux en scroll horizontal (`wg-scroll-x`), palette limitée à `52vh`, cartes en grilles `sm:`/`lg:`. Thème clair et sombre vérifiés via les deux palettes de tokens.

---

## 6. Ce qui n'a volontairement PAS été fait

| Exclu | Raison |
| --- | --- |
| Schéma SQL, migrations, RLS, Auth, Storage | **Prompts 03/04** — « ne connecte pas Supabase à la hâte » |
| Nouvelle dépendance (Framer Motion, Recharts, Zod, RHF, TanStack Query…) | aucun gain réel à cette étape : CSS + React suffisent ; compatibilité préservée |
| Modification de `src/lib/store.tsx`, `metrics.ts`, `format.ts`, `types.ts`, `plans.ts` | aucune règle métier, aucun calcul, aucun format touché |
| Découpage de `ui.tsx` | API publique gelée sur consigne explicite |
| ESLint / Prettier / CI | dette **TD-29 partielle** : `npm run lint` existe depuis le Prompt 04 (lint statique sans dépendance) ; CI GitHub Actions et Playwright livrés au Prompt 10, ESLint/Prettier restent ouverts |
| Pages « Stock », graphiques, back-office | modules des Prompts 07/09 — pas de maquette morte |
| i18n, validation Zod des formulaires | TD-21 / TD-28, reportés aux étapes où les schémas serveur existeront |
| Migration React Router v7 | breaking, volontairement reportée après le Prompt 10 (`npm audit fix --force` non appliqué) |

**Dette soldée :** TD-24 (breadcrumbs, sidebar repliable, recherche globale) · TD-26 (`window.confirm`) · TD-20 partiellement (états chargement/erreur/vides réels, mais pas encore de squelette sur chaque requête serveur — il n'y a pas encore de requête serveur). **Dette restante la plus proche :** TD-29 (ESLint/CI, le lint statique est livré), TD-21 (Zod), TD-22 (découpage `ui.tsx`), TD-23 (pagination serveur).

---

## 7. Validation

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | ✅ 0 erreur (TS strict) |
| `npm run build` | ✅ 98 modules · JS 424,25 kB / gzip 115,20 kB · CSS 32,67 kB / gzip 7,57 kB |
| `npm run check` | ✅ **66 contrôles historiques + 20 nouveaux = 86 OK / 0 KO** |
| `npm audit` | ⚠️ 5 modérées, 0 haute, 0 critique (inchangé) |
| `npm run lint` | ✅ lint statique `scripts/lint.cjs` (TD-29 partielle, sans dépendance) |

Les 20 nouveaux contrôles ([6] de `scripts/check.cjs`) vérifient : API de `ui.tsx`, contrat `useStore()`, 8 sections, 13 URL, entrées désactivées sans fausse route, zéro dépendance ajoutée, tokens CSS, branchement des états, rendu des 8 groupes sans erreur console, filtrage par rôle, ouverture/filtrage/navigation réels de la palette, persistance du repli, confirmation accessible sans `window.confirm`, et tri `aria-sort` de `DataTable`.

**Étape suivante :** Prompt 04 — Auth, multi-tenancy, RBAC. Le Prompt 03 a été exécuté après validation ; le schéma réel est documenté dans [docs/database.md](database.md). Aucune action du Prompt 04 n'est engagée avant nouvelle validation.
