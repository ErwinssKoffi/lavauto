# 02 — Design system & UX (DaisyUI + thèmes WashGuard)

**Statut :** migration DaisyUI **terminée**. Le système maison `wg-*` a été entièrement remplacé : plus aucune classe `wg-*` ni variable `--wg-*` n'existe dans `src/`. Les 16 écrans, leurs URL, leurs rôles et leurs textes sont inchangés.

**Dépendance ajoutée :** `daisyui@4.12.24` (devDependency, compatible Tailwind 3). Aucun autre paquet UI (ni shadcn/ui, ni Radix, ni Headless UI) n'a été installé.

Journal de migration et table de correspondance : [migration-daisyui.md](migration-daisyui.md).

Références : [architecture-audit.md](architecture-audit.md) · [architecture-target.md](architecture-target.md) · [technical-debt.md](technical-debt.md) · [migration-roadmap.md](migration-roadmap.md).

---

## 1. Principes de conception

| Principe | Traduction concrète |
| --- | --- |
| Hiérarchie par la surface, pas par la couleur | cartes sur `bg-base-100`, panneaux imbriqués sur `bg-base-200`, bordures `border-base-300`, ombres `shadow-xl` |
| Un seul accent | le bleu WashGuard devient `primary` du thème ; `success` / `warning` / `error` restent réservés aux états métier |
| Densité lisible sur le terrain | variantes `btn-sm` / `input-sm` / `select-sm` / `badge-sm` pour conserver la densité d'origine |
| Mouvement discret | `animate-fade-in` (320 ms, défini dans `tailwind.config.js`), transitions 150–200 ms, **désactivables** via `prefers-reduced-motion` |
| Le clavier compte | anneau `:focus-visible` global, fil d'Ariane, `aria-sort`, `aria-expanded`, piège de focus, `Ctrl/Cmd + K` |
| Pas de maquette morte | chaque composant reste branché sur un écran existant et couvert par `npm run check` |

**API publique figée :** les 18 exports de `src/components/ui.tsx` (`Logo`, `Card`, `PageHeader`, `SectionTitle`, `Label`, `Input`, `Select`, `Textarea`, `Badge`, `StatCard`, `Progress`, `EmptyState`, `Modal`, `Tabs`, `LockedPanel`, `Alert`, `ToastHost`, `useSafeAction`) conservent **exactement** leurs props. Les pages n'ont eu qu'à changer leurs classes, jamais leurs composants.

---

## 2. Thèmes DaisyUI (`tailwind.config.js`)

Deux thèmes personnalisés remplacent les anciens tokens CSS. Ils sont appliqués via `data-theme` sur `<html>` :

| Thème | `data-theme` | Usage |
| --- | --- | --- |
| WashGuard clair | `washguard` | palette historique claire (`base-100 #ffffff`, texte `#0f172a`) |
| WashGuard sombre | `washguard-dark` | palette historique sombre (`base-100 #101b2d`, texte `#e9f0fb`) — **thème par défaut** (`darkTheme`) |

| Variable DaisyUI | Rôle | Ancien token |
| --- | --- | --- |
| `--p` / `--pc` | accent unique | `--wg-accent` |
| `--b1` / `--b2` / `--b3` | surface, panneau, bordure | `--wg-surface`, `--wg-surface-2`, `--wg-border` |
| `--bc` | texte principal (`/60` = texte secondaire) | `--wg-text`, `--wg-muted` |
| `--su`, `--wa`, `--er` | états métier | `--wg-success`, `--wg-warn`, `--wg-danger` |
| `--rounded-box/btn/field/badge` | rayons (1 rem / 0,75 rem / 999 px) | `--wg-radius*` |
| `--padding-card` | 1,25 rem | padding des cartes |

Réglages complémentaires :

- `borderColor.DEFAULT` = `oklch(var(--b3))` : un simple `border` reste sensible au thème, comme l'ancienne règle globale. Les surcharges `!border-amber-500/40` continuent de fonctionner.
- `--page-bg` (`src/index.css`) : fond applicatif volontairement distinct de `base-100` pour conserver la profondeur visuelle d'origine.
- **Densité** : `src/index.css` réaligne les variantes `-sm` de DaisyUI sur la métrique d'origine (2,4 rem au lieu de 2 rem pour `btn-sm`, `input-sm`, `select-sm` et `textarea-sm`) et recapitalise les en-têtes de tableaux (`.table thead`, 0,06 em). Aucun composant n'est modifié : seules les dimensions changent, pour que les 16 écrans gardent leur lisibilité de terrain.
- `darkMode: 'class'` est conservé ; `store.tsx` synchronise à la fois la classe `dark` et `data-theme`, et `index.html` applique le thème **avant** le premier rendu (aucun flash).

Seules règles globales restantes dans `src/index.css` : fond de page, `::selection`, anneau `:focus-visible`, barres de défilement, `prefers-reduced-motion` et les styles du **reçu imprimable**, volontairement isolés du thème.

---

## 3. Composants réels

| Fichier | Composant | Comportement réel | Branché sur |
| --- | --- | --- | --- |
| `src/components/ui.tsx` | 18 primitives DaisyUI | `card`, `btn`, `input`, `select`, `textarea`, `badge`, `alert`, `progress`, `modal`, `tabs`, `skeleton` — API inchangée | tous les écrans |
| `src/components/navigation.tsx` | `NAV_GROUPS`, `groupsForRole`, `findEntry`, `NAV_PATHS`, `normalizeNavText` | configuration unique des 8 sections, filtrage par rôle, comparaison insensible aux accents | `AppShell`, `CommandPalette` |
| `src/components/feedback.tsx` | `Skeleton`, `LoadingState`, `ErrorState`, `ErrorBoundary` | squelette `skeleton`, état d'erreur avec reprise, barrière de rendu (pas de fausse donnée) | `main.tsx`, `App.tsx` |
| `src/components/ConfirmDialog.tsx` | `ConfirmDialog` | `<dialog class="modal modal-open">`, `aria-modal`, focus piégé, **Échap**, clic fond, labels ARIA via `useId` | `Settings.tsx` |
| `src/components/CommandPalette.tsx` | `CommandPalette` | `Ctrl/Cmd + K`, recherche insensible aux accents, ↑/↓, **Entrée qui navigue**, Échap, `kbd` DaisyUI | `AppShell` |
| `src/components/Breadcrumbs.tsx` | `Breadcrumbs` | fil d'Ariane dérivé de l'URL courante, `aria-current="page"`, liens `link link-primary` | `AppShell` |
| `src/components/DataTable.tsx` | `DataTable<T>` | recherche `input input-bordered input-sm`, tri réel `aria-sort`, `table` DaisyUI, état vide explicite | `Commissions.tsx` |

`Modal` et `ConfirmDialog` conservent une implémentation React (pas de `<dialog>` piloté par JS natif) pour garder le piège de focus et le retour d'Échap existants.

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
- **Les URL et les rôles sont inchangés** ; 18 URL `/app` au total, sans navigation parallèle. Le fil d'Ariane et la palette lisent la même configuration.
- Les entrées restantes « à venir » sont des `<span aria-disabled="true">` avec un badge d'étape et un `title` explicatif : **aucun lien mort, aucune page visuelle vide**.

### Shell (`src/components/AppShell.tsx`)

- Sidebar repliable (76 px ↔ 256 px) sur `bg-base-100`, groupes dépliables avec `aria-expanded`.
- Item actif : `bg-primary text-primary-content` ; survol : `hover:bg-primary/10`.
- Topbar `sticky` sur `bg-base-100/90` + flou : fil d'Ariane, bouton `Ctrl K` avec `<kbd>`, badge démo, bascule de thème, FAQ, menu compte.
- Drawer mobile conservé (fond `bg-black/60 backdrop-blur-sm`).
- Bandeau « Mise en route en cours », alertes de stock et garde du rôle `support` **inchangés** dans leurs textes et leurs conditions d'affichage.

---

## 5. États, erreurs, responsive

| État | Traitement |
| --- | --- |
| Chargement | `LoadingState` (`skeleton`) sur la vérification de session |
| Vide | `EmptyState` + état vide de `DataTable`, sans donnée factice |
| Erreur de rendu | `ErrorBoundary` avec `ErrorState` et bouton « Réessayer » (`btn btn-sm btn-primary`) |
| Action destructrice | `ConfirmDialog` (plus de `window.confirm`), bouton `btn-error btn-outline` |
| Confirmation / info | `ToastHost` (`alert` + `animate-fade-in`) |

Responsive : sidebar desktop / drawer mobile, topbar qui tronque, tableaux `table` DaisyUI dans un conteneur `overflow-x-auto` (min-width 620 px), palette limitée à `52vh`, cartes en grilles `sm:`/`lg:`. Les deux thèmes sont vérifiés par `npm run check` (montage des 15 écrans).

---

## 6. Ce qui n'a volontairement PAS été fait

| Exclu | Raison |
| --- | --- |
| shadcn/ui, Radix, Headless UI | DaisyUI couvre 100 % des besoins actuels sans runtime JS supplémentaire |
| DaisyUI 5 | incompatible avec Tailwind 3 dans ce projet |
| Remplacement de `react-icons` | aucune dépendance UI à remplacer, les icônes ne sont pas concernées |
| Modification de `src/lib/store.tsx` (métier), `metrics.ts`, `format.ts`, `types.ts`, `plans.ts` | seule la synchronisation `data-theme` a été ajoutée au thème |
| Découpage de `ui.tsx` | API publique gelée sur consigne explicite (TD-22) |
| Migration React Router v7 | breaking, hors périmètre de cette migration visuelle |

---

## 7. Validation

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | ✅ 0 erreur (TS strict) |
| `npm run lint` | ✅ 26 règles statiques |
| `npm run check` | ✅ **243 contrôles OK / 0 KO** (dont le rendu des 15 écrans en JSDOM) |
| `npm run test:unit` | ✅ 283 tests / 33 fichiers |
| `npm run build` | ✅ build Vite + PWA (39 entrées pré-cachées) |

Le contrôle « thème » de `scripts/check.cjs` vérifie désormais : `:focus-visible` et `prefers-reduced-motion` toujours présents, DaisyUI déclaré en plugin, `darkTheme: 'washguard-dark'`, les thèmes `washguard` / `washguard-dark` complets, et **l'absence** de toute classe `.wg-` ou variable `--wg-` résiduelle dans `src/` (garde-fou sur chaque fichier `.ts`/`.tsx`/`.css`).
