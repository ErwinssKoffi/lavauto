import { describe, expect, it } from 'vitest';
import { CHART_AREA_OPACITY, CHART_COLORS } from '../../src/lib/chartTheme';

describe('palette des graphiques', () => {
  it('n’utilise que des variables CSS du thème DaisyUI (aucun hexadécimal)', () => {
    for (const [name, value] of Object.entries(CHART_COLORS)) {
      expect(value, `${name} doit être une variable CSS`).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });

  it('distingue chiffre d’affaires, encaissé et dépenses', () => {
    expect(new Set([CHART_COLORS.revenue, CHART_COLORS.collected, CHART_COLORS.expenses]).size).toBe(3);
    expect(CHART_COLORS.revenue).toBe('var(--color-primary)');
    expect(CHART_COLORS.collected).toBe('var(--color-success)');
    expect(CHART_COLORS.expenses).toBe('var(--color-warning)');
    expect(CHART_COLORS.error).toBe('var(--color-error)');
  });

  it('garde un dégradé d’aire discret et décroissant', () => {
    expect(CHART_AREA_OPACITY.top).toBeGreaterThan(CHART_AREA_OPACITY.bottom);
    expect(CHART_AREA_OPACITY.top).toBeLessThanOrEqual(0.4);
    expect(CHART_AREA_OPACITY.bottom).toBeGreaterThanOrEqual(0);
  });
});
