/**
 * Palette des graphiques (recharts / SVG), alignée sur le thème DaisyUI actif.
 *
 * Les couleurs sont exprimées en variables CSS résolues par le thème porté par
 * `<html data-theme="…">` : un graphique reste donc lisible sur un thème clair
 * (`cupcake`, `lemonade`) comme sur un thème sombre (`dracula`, `night`), sans
 * re-rendu ni valeur hexadécimale figée.
 *
 * Convention de lecture, constante dans toute l'application :
 * - `revenue`   → chiffre d'affaires (`primary`)
 * - `collected` → montants encaissés (`success`)
 * - `expenses`  → dépenses (`warning`)
 * - `error`     → déficit, écart de caisse (`error`)
 */
export const CHART_COLORS = {
  revenue: 'var(--color-primary)',
  collected: 'var(--color-success)',
  expenses: 'var(--color-warning)',
  error: 'var(--color-error)',
  /** Chrome des graphiques : axes, grille, infobulles. */
  axis: 'var(--color-base-content)',
  grid: 'var(--color-base-300)',
  surface: 'var(--color-base-100)',
  content: 'var(--color-base-content)',
} as const;

export type ChartColor = keyof typeof CHART_COLORS;

/** Opacités du remplissage dégradé sous une courbe (haut, bas). */
export const CHART_AREA_OPACITY = { top: 0.3, bottom: 0.02 } as const;
