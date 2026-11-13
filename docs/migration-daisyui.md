# Migration DaisyUI — journal et table de correspondance

**Objectif :** remplacer intégralement le design system maison `wg-*` par DaisyUI, sans casser les 16 écrans, leurs URL, leurs rôles ni leurs textes.
**État final :** DaisyUI **5.8** sur **Tailwind 4.3**, configuration CSS-first (`@plugin`). La première étape de la migration s'est faite sur DaisyUI 4/Tailwind 3 ; la montée de version est décrite au §9.
**Référence de conception :** [design-system.md](design-system.md).

---

## 1. Pourquoi DaisyUI 4 et pas une autre solution

| Option | Décision | Raison |
| --- | --- | --- |
| **DaisyUI 4.12.24** | ✅ retenue | 100 % CSS (aucun runtime JS), compatible Tailwind 3.4 déjà installé, thèmes par variables, composants `btn/card/input/table/modal/tabs/badge/alert/progress/kbd/skeleton` |
| DaisyUI 5 | ❌ | exige Tailwind 4 : migration supplémentaire hors périmètre |
| shadcn/ui + Radix | ❌ | implique `clsx`, `tailwind-merge`, `cva` et des primitives Radix : dette et surface de régression bien plus grandes |
| Conserver `wg-*` | ❌ | le besoin exprimé est la sortie du système maison |

## 2. Ordre de migration (aucune étape intermédiaire cassée)

1. **Socle** — installation, thèmes `washguard` / `washguard-dark`, `data-theme` synchronisé, skin global (`body`, bordures, focus).
2. **Primitives partagées** — `ui.tsx` réécrit **à API constante** (les 18 exports gardent leurs props), puis `feedback`, `DataTable`, `ConfirmDialog`.
3. **Châssis** — `AppShell` (sidebar, topbar, menus, bandeaux), `CommandPalette`.
4. **Composants métier** — `PriceInput`, `PwaControls`, `StationLogoEditor`, `StockAlertBanner`, `WhatsappPanels`, `AccountSecurity`, `WashReceipt`, `Breadcrumbs`, `Sparkline`, `Revenue7DaysLineChart`.
5. **Écrans** — les 16 pages `/app`, les écrans d'authentification et la vitrine.
6. **Nettoyage** — suppression des classes `.wg-*` et variables `--wg-*` de `src/index.css`, mise à jour du contrôle `scripts/check.cjs`, documentation, garde-fou anti-retour.

## 3. Table de correspondance

| Ancien (`wg-*`) | DaisyUI / Tailwind | Notes |
| --- | --- | --- |
| `wg-card` | `card bg-base-100 shadow-xl` + `p-5` | `p-5` explicite car `card-body` n'est pas utilisé |
| `wg-card` en ligne | `card flex flex-row …` | `.card` est `flex-col` : `flex-row` requis sur les 6 usages horizontaux |
| `wg-btn` | `btn btn-sm` | densité alignée sur 2,4 rem (voir §5) |
| `wg-btn-primary` | `btn btn-sm btn-primary` | |
| `wg-btn-ghost` | `btn btn-sm` | plus de fond gris : contour + hover DaisyUI |
| `wg-btn-danger` | `btn btn-sm btn-error btn-outline` | pas de variante « soft » en v4 |
| `wg-input` | `input input-bordered input-sm` | |
| `wg-label` | `label` + `block` conservé | |
| `wg-badge(-success/warn/danger/accent)` | `badge badge-sm` + `badge-success/warning/error/primary` | |
| `wg-link` | `link link-primary` | |
| `wg-muted` | `text-base-content/60` | |
| `wg-th` / `wg-td` | `.table` sur `<table>`, cellules sans classe | en-têtes recapitalisés par `index.css` |
| `wg-scroll-x` | `overflow-x-auto` + `min-w-[620px]` sur la table | |
| `wg-kbd` | `kbd` | |
| `wg-overlay` | `bg-black/60 backdrop-blur-sm` | |
| `wg-skeleton` | `skeleton` | |
| `wg-gradient` | `bg-gradient-to-br from-sky-600 via-sky-500 to-cyan-400` | |
| `wg-fade-in` | `animate-fade-in` | `--animate-fade-in` dans `@theme` |
| `wg-scroll-thin` | `[scrollbar-width:thin]` | + barres globales dans `index.css` |
| `wg-nav-item(-active/-soon)` | classes Tailwind composées dans `AppShell` | actif : `bg-primary text-primary-content` |
| `wg-topbar` | `bg-base-100/90 backdrop-blur-xl` | |
| `wg-elev-1/2` | `shadow-lg` / `shadow-xl` | |
| `var(--wg-border)` | `border-base-300` (ou `borderColor.DEFAULT`) | |
| `var(--wg-surface)` / `-2` | `bg-base-100` / `bg-base-200` | |
| `var(--wg-text)` / `--wg-muted` | `text-base-content` / `text-base-content/60` | |
| `Modal` maison | `<dialog class="modal modal-open">` + `modal-box` + `modal-backdrop` | z-index 999 natif, `z-[80]` si empilement |
| `Tabs` maison | `tabs tabs-boxed` + `tab-active` | |
| `Progress` maison | `<progress class="progress …">` | |

## 4. Points de vigilance vérifiés

- **`.card` est une colonne flex** : tout usage horizontal porte `flex flex-row` (App, AppShell, Commissions, Onboarding, Platform, StatCard).
- **Doublons de classes** : les variantes (`wg-btn-primary`, `wg-badge-success`) ont été remplacées avant la classe de base, sinon `wg-btn` → `btn btn-sm` produisait `btn btn-sm-primary`.
- **`Alert` sans `role`** : ajouter `role="status"` cassait un contrat testé et modifiait les annonces lecteur d'écran ; l'attribut a été retiré.
- **`btn-square` évité** : `.btn-square` fige 3 rem de côté et entrerait en conflit avec la densité ; les boutons d'icônes utilisent `btn btn-sm !px-2.5`.
- **`<table className="table min-w-[620px]">`** uniquement dans un conteneur `overflow-x-auto` ; la table du back-office en `max-h-44 overflow-y-auto` reste en `table w-full`.
- **Reçu imprimable** : `.wash-receipt-*` reste en CSS autonome (hors thème), il ne doit pas hériter du sombre.

## 5. Densité (parité visuelle)

`src/index.css` aligne les variantes `-sm` de DaisyUI sur les hauteurs d'origine des contrôles de terrain :

| Sélecteur | Valeur | Ancienne métrique |
| --- | --- | --- |
| `.btn.btn-sm` | `height`/`min-height` 2,4 rem | `wg-btn` ≈ 2,29 rem |
| `.input.input-sm`, `.select.select-sm` | `height` 2,4 rem | `wg-input` ≈ 2,39 rem |
| `.textarea.textarea-sm` | `min-height` 2,4 rem | idem |
| `.table thead` | `uppercase`, `letter-spacing .06em` | `wg-th` |

## 6. Garde-fous

- `scripts/check.cjs` :
  - « thème : DaisyUI configuré, thèmes clair/sombre, focus clavier et mouvement réduit » — plugin `daisyui`, `darkTheme: 'washguard-dark'`, thèmes complets, `:focus-visible`, `prefers-reduced-motion`, absence de `.wg-` dans `index.css` ;
  - « plus aucune classe ni variable wg-\* dans les sources React » — parcourt `src/**/*.{ts,tsx,css}` (validé en réintroduisant volontairement une classe `wg-`).
- `npm run check` monte les 15 écrans en JSDOM : toute classe manquante ne casse pas le rendu, mais toute erreur React ou tout texte contractuel modifié échoue.

## 7. Validation finale

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | ✅ 0 erreur |
| `npm run lint` | ✅ 26 règles |
| `npm run check` | ✅ 250 OK / 0 KO |
| `npm run test:unit` | ✅ 288 tests / 34 fichiers |
| `npm run build` | ✅ build Vite + PWA |

## 8. Différences visuelles connues (assumées)

- En-têtes de tableaux DaisyUI : fond `base-200` très léger, taille 0,75 rem (au lieu de 0,7 rem transparent) — capitales conservées via `index.css`.
- `badge` : hauteur fixe 1,25 rem (ou 1 rem en `badge-sm`).
- Boutons « ghost » : fond transparent au repos avec contour au survol, au lieu d'un fond gris permanent.
- Cartes : ombre `shadow-xl` DaisyUI au lieu de l'ombre maison à deux niveaux.

Ces écarts sont typographiques et restent dans le même contrat de couleurs, de densité et de hiérarchie visuelle.


---

## 9. Montée de version Tailwind 4 + DaisyUI 5

Décidée après la première migration (DaisyUI 4 / Tailwind 3), pour utiliser la syntaxe demandée : `@import "tailwindcss"` + `@plugin "daisyui"`.

### 9.1 Pile et fichiers de configuration

| Avant | Après |
| --- | --- |
| `tailwind.config.js` (`content`, `theme.extend`, `plugins`, `daisyui.themes`) | `src/index.css` en CSS-first : `@import "tailwindcss" source(none)`, `@source`, `@plugin "daisyui"`, `@plugin "daisyui/theme"`, `@theme` |
| `postcss.config.js` + `postcss` + `autoprefixer` | `@tailwindcss/vite` (plugin Vite), préfixage intégré — les trois ont été supprimés |
| `darkMode: 'class'` | `data-theme` seul (la classe `dark` reste posée pour compatibilité `<html class="dark">`) |
| `daisyui@4.12.24` | `daisyui@5.8.0` |
| `borderColor.DEFAULT` (thème Tailwind) | `@layer base { *, ::before, ::after, ::backdrop { border-color: var(--color-base-300) } }` |

### 9.2 Thèmes

`@plugin "daisyui" { themes: washguard-dark --default --prefersdark, washguard, abyss, …, wireframe; }` (liste explicite des 37 thèmes) puis deux blocs `@plugin "daisyui/theme"` (`washguard`, `washguard-dark`). Les tokens deviennent `--color-*`, `--radius-*`, `--size-field`, `--border`, `--depth`, `--noise`.

**`themes: all` a été abandonné** : cette branche de `pluginOptionsHandler.js` impose `light` comme `--default` et `dark` comme `--prefersdark` en dur, en ignorant les clés `default:` / `prefersdark:` des thèmes personnalisés. Résultat : `:where(:root)` portait la palette `light` et le repli `prefers-color-scheme: dark` la palette `dark`. La liste explicite rend la racine à WashGuard :

```css
@plugin "daisyui" { themes: washguard-dark --default --prefersdark, washguard, … ; }
@plugin "daisyui/theme" { name: "washguard-dark"; default: true; prefersdark: true; … }
```

soit `:where(:root),[data-theme=washguard-dark]{…}` et `@media (prefers-color-scheme: dark){:root:not([data-theme]){…washguard-dark…}}`. Coût mesuré : CSS 148,7 → 190,4 kB (23,3 → 30,2 kB gzip), légèrement moins que `themes: all`. `npm run check` compare la liste déclarée au catalogue `src/lib/themes.ts` et refuse `themes: all`.

### 9.3 Ruptures de classes corrigées

| DaisyUI 4 / Tailwind 3 | DaisyUI 5 / Tailwind 4 | Volume |
| --- | --- | --- |
| `input-bordered`, `select-bordered`, `textarea-bordered` | supprimées (`input`/`select`/`textarea` ont une bordure native) | 19 |
| `tabs-boxed` | `tabs-box` | 1 |
| `!px-2.5` (modificateur préfixé) | `px-2.5!` (modificateur suffixé) | 114 tokens |
| `bg-gradient-to-br` | `bg-linear-to-br` | 18 |
| `rounded-sm`, `shadow-sm`, `blur-sm` | `rounded-xs`, `shadow-xs`, `blur-xs` | 3 |
| largeur implicite des champs (`width: 100%` en v4) | `width: clamp(3rem, 20rem, 100%)` en v5 → `w-full` explicite ajouté | 4 fichiers |

Le remplacement du modificateur important a été fait **uniquement dans les littéraux de classes** : un premier passage sur tout le fichier avait réécrit des négations JS (`|| !canWriteSubscription` → `canWriteSubscription!`), détecté puis annulé avant commit.

### 9.4 Densité portée par le thème

Plus besoin de surcharger les hauteurs : `--size-field: 0.3rem` dans les deux thèmes donne `0,3 × 8 = 2,4 rem` pour `btn-sm`, `input-sm`, `select-sm`, `textarea-sm` (DaisyUI 5 calcule `--size` à partir de ce token).

Trois ajustements restent **hors couche** (donc prioritaires sur la couche `utilities` où DaisyUI 5 place ses composants) : `--fontsize` des `btn-sm` (14 px), rayon des badges (pastille 999 px) et capitalisation des en-têtes de tableaux.

### 9.5 Sources et poids du CSS

`@import "tailwindcss" source(none)` + `@source "../index.html"` + `@source "./**/*.{ts,tsx}"` : la documentation et les tests ne produisent plus de classes. Résultat : **192,3 kB** de CSS (30,2 kB gzip) avec les 37 thèmes, contre 148,7 kB (23,3 kB gzip) avec deux thèmes et 125 kB en Tailwind 3.

### 9.6 Validation après montée de version

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | ✅ 0 erreur |
| `npm run lint` | ✅ 26 règles |
| `npm run check` | ✅ 250 OK / 0 KO |
| `npm run test:unit` | ✅ 288 tests / 34 fichiers |
| `npm run build` | ✅ Vite + PWA · CSS 192,3 kB / gzip 30,2 kB |


---

## 10. Sélecteur de thème

Les 35 thèmes intégrés sont déclarés explicitement dans `@plugin "daisyui" { themes: … }` et exposés dans la topbar par `src/components/ThemeSwitcher.tsx`.

| Élément | Détail |
| --- | --- |
| Catalogue | `src/lib/themes.ts` : `WASHGUARD_THEMES` (2) + `DAISY_THEMES` (35), `DEFAULT_THEME = 'washguard-dark'`, `isKnownTheme`, `themeScheme` |
| Source de vérité | `data-theme` sur `<html>`, écrit par le store ; la classe `dark` reste maintenue pour compatibilité |
| Persistance | `washguard.theme.name` (nom exact du thème) + `washguard.theme` (`dark`/`light`) ; l'ancienne clé seule reste lue si la nouvelle est absente |
| Premier rendu | `index.html` applique `washguard.theme.name` avant tout script (aucun flash), avec repli sur `washguard-dark` |
| Aperçu | chaque ligne du menu porte `data-theme="<thème>"` : les pastilles affichent la vraie palette, sans image |
| Accessibilité | bouton `aria-expanded`, lignes `aria-pressed`, fermeture au clic extérieur et sur Échap |
| Garde-fous | `npm run check` compare `themes.ts` aux fichiers `node_modules/daisyui/theme/*.css` et rejoue l'ouverture du menu, ses 37 entrées, l'application d'un thème, sa persistance et le retour au WashGuard clair ; `tests/unit/themes.test.ts` vérifie l'unicité, l'ordre et les libellés |

La bascule rapide soleil/lune reste volontairement limitée aux deux thèmes WashGuard : un thème exotique sélectionné n'empêche pas de revenir en un clic au thème de la marque.


---

## 11. Audit shadcn/ui

Le dépôt n'a jamais contenu de shadcn/ui, et n'en contient toujours pas : aucun `components.json`, aucun dossier `src/components/ui/`, aucune dépendance `shadcn`, `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `lucide-react`, `tailwindcss-animate`, aucun helper `cn()`, aucun token `--*-foreground` ni attribut `data-slot`. Le seul paquet proche présent dans `node_modules` est `clsx`, dépendance transitive de `recharts` (`npm ls clsx`), jamais importée par l'application.

`npm run check` porte un contrôle dédié, validé en réintroduisant volontairement `clsx` dans `package.json` (KO attendu, puis restauration).
