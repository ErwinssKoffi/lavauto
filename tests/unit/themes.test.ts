import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DAISY_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, DEFAULT_THEME, THEME_OPTIONS,
  WASHGUARD_THEMES, isKnownTheme, themeLabel, themeScheme,
} from '../../src/lib/themes';

describe('catalogue de thèmes DaisyUI', () => {
  it('expose les 35 thèmes intégrés de DaisyUI 5, à l’identique du paquet installé', () => {
    const installed = readdirSync('node_modules/daisyui/theme')
      .filter((file) => file.endsWith('.css'))
      .map((file) => file.replace(/\.css$/, ''))
      .sort();
    expect(DAISY_THEMES.map((t) => t.name).sort()).toEqual(installed);
  });

  it('ajoute les deux thèmes WashGuard en tête de liste', () => {
    expect(WASHGUARD_THEMES.map((t) => t.name)).toEqual(['washguard-dark', 'washguard']);
    expect(THEME_OPTIONS.slice(0, 2).map((t) => t.name)).toEqual(['washguard-dark', 'washguard']);
    expect(THEME_OPTIONS).toHaveLength(37);
  });

  it('n’a aucun doublon et applique la Signature sombre par défaut', () => {
    const names = THEME_OPTIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(DEFAULT_THEME).toBe('washguard-dark');
    expect(themeScheme(DEFAULT_THEME)).toBe('dark');
    expect(isKnownTheme(DEFAULT_THEME)).toBe(true);
  });

  it('ignore un thème inconnu sans casser le schéma de couleurs', () => {
    expect(isKnownTheme('washguard-dark')).toBe(true);
    expect(isKnownTheme('inconnu')).toBe(false);
    expect(isKnownTheme(null)).toBe(false);
    expect(themeScheme('inconnu')).toBe('dark');
    expect(themeLabel('inconnu')).toBe('inconnu');
  });

  it('fournit une paire clair/sombre pour la bascule rapide', () => {
    expect(DEFAULT_LIGHT_THEME).toBe('washguard');
    expect(DEFAULT_DARK_THEME).toBe('washguard-dark');
    expect(DEFAULT_THEME).toBe(DEFAULT_DARK_THEME);
    expect(themeScheme(DEFAULT_LIGHT_THEME)).toBe('light');
    expect(themeScheme(DEFAULT_DARK_THEME)).toBe('dark');
    expect(isKnownTheme(DEFAULT_DARK_THEME)).toBe(true);
  });

  it('conserve les libellés lisibles des thèmes WashGuard', () => {
    expect(themeLabel('washguard')).toBe('WashGuard clair');
    expect(themeLabel('washguard-dark')).toBe('WashGuard sombre');
  });
});
