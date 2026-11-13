# 02 — Design system & UX (Tailwind 4 + DaisyUI 5, thèmes WashGuard)

**Statut :** migration DaisyUI **terminée**. Le système maison `wg-*` a été entièrement remplacé : plus aucune classe `wg-*` ni variable `--wg-*` n'existe dans `src/`. Les 16 écrans, leurs URL, leurs rôles et leurs textes sont inchangés.

**Pile :** `tailwindcss@4` + `@tailwindcss/vite@4` + `daisyui@5`, en **configuration CSS-first** (`src/index.css`). Aucun autre paquet UI (ni shadcn/ui, ni Radix, ni Headless UI) n'a été installé. `tailwind.config.js`, `postcss.config.js`, `postcss` et `autoprefixer` ont été supprimés.

Journal de migration et table de correspondance : [migration-daisyui.md](migration-daisyui.md).

Références : [architecture-audit.md](architecture-audit.md) · [architecture-target.md](architecture-target.md) · [technical-debt.md](technical-debt.md) · [migration-roadmap.md](migration-roadmap.md).

---

## 1. Principes de conception

| Principe | Traduction concrète |
| --- | --- |
| Hiérarchie par la surface, pas par la couleur | cartes sur `bg-base-100`, panneaux imbriqués sur `bg-base-200`, bordures `border-base-300`, ombres `shadow-xl` |
| Un seul accent | le bleu WashGuard devient `primary` du thème ; `success` / `warning` / `error` restent réservés aux états métier |
| Densité lisible sur le terrain | variantes `btn-sm` / `input-sm` / `select-sm` / `badge-sm` pour conserver la densité d'origine |
| Mouvement discret | `animate-fade-in` (320 ms, déclaré dans `@theme` de `src/index.css`), transitions 150–200 ms, **désactivables** via `prefers-reduced-motion` |
| Le clavier compte | anneau `:focus-visible` global, fil d'Ariane, `aria-sort`, `aria-expanded`, piège de focus, `Ctrl/Cmd + K` |
| Pas de maquette morte | chaque composant reste branché sur un écran existant et couvert par `npm run check` |

**API publique figée :** les 18 exports de `src/components/ui.tsx` (`Logo`, `Card`, `PageHeader`, `SectionTitle`, `Label`, `Input`, `Select`, `Textarea`, `Badge`, `StatCard`, `Progress`, `EmptyState`, `Modal`, `Tabs`, `LockedPanel`, `Alert`, `ToastHost`, `useSafeAction`) conservent **exactement** leurs props. Les pages n'ont eu qu'à changer leurs classes, jamais leurs composants.

---

## 2. Thèmes DaisyUI (`src/index.css`, CSS-first)

Deux thèmes personnalisés remplacent les anciens tokens CSS, déclarés avec le plugin `@plugin "daisyui/theme"` et appliqués via `data-theme` sur `<html>` :

| Thème | `data-theme` | Usage |
| --- | --- | --- |
| WashGuard clair | `washguard` | palette historique claire (`base-100 #ffffff`, texte `#0f172a`) |
| WashGuard sombre | `washguard-dark` | palette historique sombre (`base-100 #101b2d`, texte `#e9f0fb`) — cible de la bascule rapide |
| **Cupcake** | `cupcake` | thème intégré DaisyUI, **thème par défaut de tout le projet** (`--default` + `--prefersdark`) |
| **Dim** | `dim` | pendant sombre de la bascule rapide (`DEFAULT_DARK_THEME`), pour rester dans une esthétique douce |

`@plugin "daisyui" { themes: cupcake --default --prefersdark, washguard-dark, washguard, abyss, …, wireframe; }` : **liste explicite** des 37 thèmes (35 intégrés + les 2 WashGuard), plutôt que `themes: all`.

Pourquoi pas `all` : dans `daisyui/functions/pluginOptionsHandler.js`, la branche `themes === "all"` réserve `:where(:root)` au thème `light` et `prefers-color-scheme: dark` au thème `dark`, **sans lire** les clés `default:` / `prefersdark:` des blocs `@plugin "daisyui/theme"`. La racine du document appartenait donc à `light`, et le repli sombre à `dark` — deux palettes qui ne sont pas celles de la marque. Avec la liste explicite, nos clés sont appliquées : `:where(:root),[data-theme=washguard-dark]{…}` et `@media (prefers-color-scheme: dark){:root:not([data-theme]){…washguard-dark…}}`.

**cupcake est le thème de tout le projet** : `<html>` porte `data-theme="cupcake"` avant tout script, `DEFAULT_THEME` vaut `'cupcake'`, et les clés `--default` + `--prefersdark` lui donnent `:where(:root)` et le repli `prefers-color-scheme`. Coût mesuré : 188,6 kB de CSS (29,0 kB gzip).

| Variable DaisyUI 5 | Rôle | Ancien token |
| --- | --- | --- |
| `--color-primary` / `-content` | accent unique | `--wg-accent` |
| `--color-base-100/200/300` | surface, panneau, bordure | `--wg-surface`, `--wg-surface-2`, `--wg-border` |
| `--color-base-content` (`/60` = secondaire) | texte | `--wg-text`, `--wg-muted` |
| `--color-success/warning/error` | états métier | `--wg-success`, `--wg-warn`, `--wg-danger` |
| `--radius-box/field/selector` | rayons (1 rem / 0,75 rem / 0,75 rem) | `--wg-radius*` |
| `--size-field: 0.3rem` | densité : `0,3 × 8 = 2,4 rem` pour `btn-sm`/`input-sm`/`select-sm` | hauteurs `wg-btn`/`wg-input` |
| `--border`, `--depth`, `--noise` | épaisseur de bordure, profondeur d'ombre, grain | — |

Réglages complémentaires :

- **Bordure par défaut** : Tailwind 4 utilise `currentColor` ; une règle `@layer base { *, ::before, ::after, ::backdrop { border-color: var(--color-base-300); } }` rétablit une bordure thématique pour les simples `border`.
- **Fond applicatif** : `body { background: color-mix(in oklab, var(--color-base-100) 94%, #000) }` — légèrement plus profond que la surface des cartes, et **dérivé du thème actif** : les 37 thèmes sont donc respectés sans aucune couleur codée en dur (l'ancienne variable `--page-bg` figée sur deux valeurs a été supprimée).
- **Ajustements hors couche** : DaisyUI 5 émet ses composants dans la couche `utilities`, donc une règle `@layer components` serait perdante. Trois règles volontairement **non calquées** (donc prioritaires) ajustent le texte des `btn-sm` (`--fontsize: .875rem`), le rayon des badges (pastille `999px`) et la capitalisation des en-têtes de tableaux.
- **Sélecteur de thème** (`src/components/ThemeSwitcher.tsx`) : menu de la topbar listant les deux thèmes WashGuard puis les 35 thèmes DaisyUI ; la pastille active est celui des 37 qui est en cours (cupcake par défaut). Chaque ligne porte son propre `data-theme`, donc les pastilles montrent les couleurs réelles du thème proposé. Champ de **recherche** (insensible aux accents : « lofi » trouve `Lo-Fi`), navigation par **flèches haut/bas**, `Échap` referme et rend le focus au bouton, thème actif amené à l'écran à l'ouverture. Persistance `localStorage` : `washguard.theme.name` (thème exact), `washguard.theme` (`dark`/`light`, conservé pour la compatibilité et le script inline de `index.html`), `washguard.theme.light` / `.dark` (paire de la bascule) et `washguard.theme.v` (version de préférence). La bascule rapide soleil/lune alterne entre le **dernier thème clair** et le **dernier thème sombre** utilisés (cupcake / dim par défaut, mémorisés dans `washguard.theme.light` et `washguard.theme.dark`).
- **Barre du navigateur mobile** : à chaque changement de thème, le store recopie `--color-base-100` du thème actif dans `<meta name="theme-color">`.
- **`@theme`** : police `Inter` (`--font-sans`) et animation `--animate-fade-in` (keyframes `fadeIn`).
- **`@import "tailwindcss" source(none)` + `@source`** : seuls `index.html` et `src/**/*.{ts,tsx}` produisent des classes (ni la documentation ni les tests ne gonflent le CSS).
- `darkMode: 'class'` n'existe plus : la classe `dark` reste posée pour compatibilité, mais la source de vérité est `data-theme`, synchronisée dans `store.tsx` et appliquée avant le premier rendu par `index.html`.

Seules règles globales restantes dans `src/index.css` : fond de page, `::selection`, anneau `:focus-visible`, barres de défilement, `prefers-reduced-motion` et les styles du **reçu imprimable**, volontairement isolés du thème.

### Audit : aucune trace de shadcn/ui

Vérifié sur tout le dépôt (code, configuration, `package.json`, CSS) :

| Marqueur shadcn/ui | Résultat |
| --- | --- |
| `shadcn`, `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `lucide-react`, `sonner`, `cmdk`, `tailwindcss-animate` | **absents** de `dependencies` et `devDependencies` |
| `components.json` / `.components.json` | **absents** |
| Dossier `src/components/ui/` | **absent** — une seule primitive maison, `src/components/ui.tsx`, réécrite sur DaisyUI |
| Helper `cn()` / `@/lib/utils` / alias `@/` | **absents** |
| Tokens `--primary-foreground`, `--muted-foreground`, `--ring`, `--popover`… | **absents** (`--border: 1px` est un token de largeur DaisyUI 5, pas le `--border` couleur de shadcn) |
| `data-slot`, `data-orientation`, `data-state` (Radix) | **absents** |

`clsx@2.1.1` apparaît dans `node_modules` uniquement comme dépendance transitive de **recharts** (`npm ls clsx` → `recharts`), jamais importée par le code de l'application : la retirer casserait les graphiques.

Rien n'a donc été supprimé : il n'y avait aucun shadcn à retirer. DaisyUI est la seule couche UI, et le contrôle `npm run check` « aucune trace de shadcn/ui (ou de sa pile) » échoue désormais si l'une de ces dépendances, de ces imports, de ce helper ou de ces tokens réapparaît.

### Palette : plus aucune couleur codée en dur

Avec 37 thèmes sélectionnables, une classe `slate`/`sky`/`amber` codée en dur devient un bug : elle ignore le thème et casse le contraste sur un thème clair. Les surfaces et les textes de l'application (`/app`, dialogs, primitives partagées) utilisent donc uniquement les tokens DaisyUI.

| Avant (Tailwind brut) | Après (DaisyUI) | Rôle |
| --- | --- | --- |
| `bg-slate-950`, `bg-slate-900/80`, `bg-slate-800` | `bg-base-100`, `bg-base-100/80`, `bg-base-300` | surfaces |
| `text-slate-100…400`, `text-slate-950` | `text-base-content`, `text-base-content/80`, `/70`, `/60` | texte hiérarchisé |
| `border-slate-800`, `border-slate-200` | `border-base-300` | séparateurs |
| `text-sky-400`, `bg-sky-500`, `border-sky-500`, `ring-sky-100` | `text-primary`, `bg-primary`, `border-primary`, `ring-primary/20` | marque / action |
| `from-sky-600 via-sky-500 to-cyan-400` | `from-primary via-primary to-secondary` | dégradés |
| `text-emerald-400`, `bg-emerald-500` | `text-success`, `bg-success` | positif, validé |
| `text-amber-400`, `bg-amber-500/10` | `text-warning`, `bg-warning/10` | alerte, seuil |
| `text-red-400`, `bg-red-500`, `border-red-500/30` | `text-error`, `bg-error`, `border-error/30` | erreur, négatif |
| `text-white` sur une surface colorée | `text-primary-content`, `text-error-content`… | contraste garanti |
| `bg-white`, `bg-slate-50` | `bg-base-100`, `bg-base-200` | champs, pages |

**La vitrine et l'authentification suivent désormais le thème comme le reste** : plus aucune zone épinglée. Les dégradés par-dessus les photos utilisent `neutral` (+ `neutral-content` pour le texte), ce qui reste lisible sur photo claire sans couleur littérale ; les voiles de modale conservent `bg-black/60` (convention, indépendante du thème).

Les graphiques (recharts / SVG) suivent intégralement le thème, **séries comprises**, via `src/lib/chartTheme.ts` :

| Clé | Variable | Série |
| --- | --- | --- |
| `revenue` | `var(--color-primary)` | chiffre d'affaires |
| `collected` | `var(--color-success)` | montants encaissés |
| `expenses` | `var(--color-warning)` | dépenses |
| `error` | `var(--color-error)` | déficit, écart de caisse |
| `axis` / `content` | `var(--color-base-content)` | axes, libellés |
| `grid` | `var(--color-base-300)` | grille |
| `surface` | `var(--color-base-100)` | infobulles, points actifs |

Le dégradé sous les courbes (`CHART_AREA_OPACITY` : 0,3 → 0,02) utilise `stopOpacity` sur la couleur du thème, au lieu d'un `rgba()` figé. Plus aucun hexadécimal ni `rgba()` ne subsiste dans le code applicatif : c'est vérifié par `npm run check`.

Le contrôle `npm run check` « palette DaisyUI partout » parcourt **tous** les `.tsx` et échoue sur toute classe `text|bg|border|ring|from|via|to|shadow-{slate,sky,amber,emerald,red,white…}` ainsi que sur tout `#hex` ou `rgba()` (seul `bg-black/NN` des voiles est toléré).

## 3. Composants réels

| Fichier | Composant | Comportement réel | Branché sur |
| --- | --- | --- | --- |
| `src/components/ui.tsx` | 18 primitives DaisyUI | `card`, `btn`, `input`, `select`, `textarea`, `badge`, `alert`, `progress`, `modal`, `tabs`, `skeleton` — API inchangée | tous les écrans |
| `src/components/navigation.tsx` | `NAV_GROUPS`, `groupsForRole`, `findEntry`, `NAV_PATHS`, `normalizeNavText` | configuration unique des 8 sections, filtrage par rôle, comparaison insensible aux accents | `AppShell`, `CommandPalette` |
| `src/components/feedback.tsx` | `Skeleton`, `LoadingState`, `ErrorState`, `ErrorBoundary` | squelette `skeleton`, état d'erreur avec reprise, barrière de rendu (pas de fausse donnée) | `main.tsx`, `App.tsx` |
| `src/components/ConfirmDialog.tsx` | `ConfirmDialog` | `<dialog class="modal modal-open">`, `aria-modal`, focus piégé, **Échap**, clic fond, labels ARIA via `useId` | `Settings.tsx` |
| `src/components/CommandPalette.tsx` | `CommandPalette` | `Ctrl/Cmd + K`, recherche insensible aux accents, ↑/↓, **Entrée qui navigue**, Échap, `kbd` DaisyUI | `AppShell` |
| `src/components/Breadcrumbs.tsx` | `Breadcrumbs` | fil d'Ariane dérivé de l'URL courante, `aria-current="page"`, liens `link link-primary` | `AppShell` |
| `src/components/ThemeSwitcher.tsx` | `ThemePicker`, `ThemeRow` | sélection parmi 37 thèmes, aperçu par `data-theme`, fermeture au clic extérieur et à Échap, `aria-expanded` / `aria-pressed` | `AppShell` (topbar) |
| `src/lib/themes.ts` | `THEME_OPTIONS`, `isKnownTheme`, `themeScheme` | catalogue unique des thèmes (vérifié contre les fichiers de `node_modules/daisyui/theme` par `npm run check` et les tests unitaires) | store, sélecteur, contrôles |
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
| Sélecteur de thème dans l'interface | les 35 thèmes intégrés sont disponibles et exposés par `ThemePicker` dans la topbar ; la bascule rapide soleil/lune reste limitée aux thèmes WashGuard |
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
| `npm run check` | ✅ **263 contrôles OK / 0 KO** (dont le rendu des 15 écrans en JSDOM) |
| `npm run test:unit` | ✅ 292 tests / 35 fichiers |
| `npm run build` | ✅ build Vite + PWA (39 entrées pré-cachées) · CSS 192,3 kB / gzip 30,2 kB |

Le contrôle « thème » de `scripts/check.cjs` vérifie désormais : `:focus-visible` et `prefers-reduced-motion` toujours présents, `@import "tailwindcss"`, les plugins `daisyui` et `daisyui/theme` (exactement deux thèmes), les variables `--color-*`, `@theme` et `--animate-fade-in`, et **l'absence** de toute classe `.wg-` ou variable `--wg-` résiduelle dans `src/` (garde-fou sur chaque fichier `.ts`/`.tsx`/`.css`).
