// ─── Catalogue de thèmes DaisyUI ────────────────────────────────────────────
// `themes: all` (src/index.css) embarque les 35 thèmes intégrés de DaisyUI en
// plus des deux thèmes WashGuard. Ce module est la seule liste de référence :
// le store, le sélecteur de thème et les contrôles de `npm run check`
// s'appuient dessus. `scheme` sert uniquement à l'icône de bascule
// clair/sombre et à la classe `dark` de compatibilité.

export type ThemeScheme = 'light' | 'dark';

export interface ThemeOption {
  /** Valeur exacte de l'attribut `data-theme`. */
  name: string;
  label: string;
  scheme: ThemeScheme;
}

export const WASHGUARD_THEMES: ThemeOption[] = [
  { name: 'washguard-dark', label: 'WashGuard sombre', scheme: 'dark' },
  { name: 'washguard', label: 'WashGuard clair', scheme: 'light' },
];

/** Thèmes intégrés de DaisyUI 5 (`themes: all`). */
export const DAISY_THEMES: ThemeOption[] = [
  { name: 'abyss', label: 'Abyss', scheme: 'dark' },
  { name: 'acid', label: 'Acid', scheme: 'light' },
  { name: 'aqua', label: 'Aqua', scheme: 'dark' },
  { name: 'autumn', label: 'Autumn', scheme: 'light' },
  { name: 'black', label: 'Black', scheme: 'dark' },
  { name: 'bumblebee', label: 'Bumblebee', scheme: 'light' },
  { name: 'business', label: 'Business', scheme: 'dark' },
  { name: 'caramellatte', label: 'Caramel Latte', scheme: 'light' },
  { name: 'cmyk', label: 'CMYK', scheme: 'light' },
  { name: 'coffee', label: 'Coffee', scheme: 'dark' },
  { name: 'corporate', label: 'Corporate', scheme: 'light' },
  { name: 'cupcake', label: 'Cupcake', scheme: 'light' },
  { name: 'cyberpunk', label: 'Cyberpunk', scheme: 'light' },
  { name: 'dark', label: 'Dark', scheme: 'dark' },
  { name: 'dim', label: 'Dim', scheme: 'dark' },
  { name: 'dracula', label: 'Dracula', scheme: 'dark' },
  { name: 'emerald', label: 'Emerald', scheme: 'light' },
  { name: 'fantasy', label: 'Fantasy', scheme: 'light' },
  { name: 'forest', label: 'Forest', scheme: 'dark' },
  { name: 'garden', label: 'Garden', scheme: 'light' },
  { name: 'halloween', label: 'Halloween', scheme: 'dark' },
  { name: 'lemonade', label: 'Lemonade', scheme: 'light' },
  { name: 'light', label: 'Light', scheme: 'light' },
  { name: 'lofi', label: 'Lo-Fi', scheme: 'light' },
  { name: 'luxury', label: 'Luxury', scheme: 'dark' },
  { name: 'night', label: 'Night', scheme: 'dark' },
  { name: 'nord', label: 'Nord', scheme: 'light' },
  { name: 'pastel', label: 'Pastel', scheme: 'light' },
  { name: 'retro', label: 'Retro', scheme: 'light' },
  { name: 'silk', label: 'Silk', scheme: 'light' },
  { name: 'sunset', label: 'Sunset', scheme: 'dark' },
  { name: 'synthwave', label: 'Synthwave', scheme: 'dark' },
  { name: 'valentine', label: 'Valentine', scheme: 'light' },
  { name: 'winter', label: 'Winter', scheme: 'light' },
  { name: 'wireframe', label: 'Wireframe', scheme: 'light' },
];

export const THEME_OPTIONS: ThemeOption[] = [...WASHGUARD_THEMES, ...DAISY_THEMES];

/**
 * Thèmes de la marque — **Signature Edition**.
 *
 * `washguard-dark` (bleu nuit + cyan) est le thème appliqué au premier
 * lancement ; `washguard` en est le pendant clair et forme, avec lui, la paire
 * de la bascule rapide soleil/lune. Les 35 autres thèmes DaisyUI restent
 * disponibles dans le sélecteur, mais ne sont plus proposés par défaut.
 */
export const DEFAULT_LIGHT_THEME = 'washguard';
export const DEFAULT_DARK_THEME = 'washguard-dark';
export const DEFAULT_THEME = DEFAULT_DARK_THEME;

/**
 * Version du format de préférence enregistrée.
 *
 * Incrémenter invalide les thèmes mémorisés par les versions précédentes : au
 * premier chargement de cette génération, l'application repart donc sur
 * `DEFAULT_THEME` (washguard-dark), puis les choix de l'utilisateur sont de
 * nouveau respectés. La même valeur est vérifiée dans le script inline de `index.html`
 * et par `npm run check`.
 */
export const THEME_PREFERENCE_VERSION = '3';

const BY_NAME = new Map(THEME_OPTIONS.map((t) => [t.name, t]));

export function isKnownTheme(name: string | null | undefined): name is string {
  return typeof name === 'string' && BY_NAME.has(name);
}

/** Schéma de couleurs d'un thème ; `dark` par défaut pour un nom inconnu. */
export function themeScheme(name: string): ThemeScheme {
  return BY_NAME.get(name)?.scheme ?? 'dark';
}

export function themeLabel(name: string): string {
  return BY_NAME.get(name)?.label ?? name;
}
