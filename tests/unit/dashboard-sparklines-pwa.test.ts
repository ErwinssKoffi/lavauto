// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Sparkline from '../../src/components/Sparkline';
import { OfflineIndicator, PWAInstallButton } from '../../src/components/PwaControls';
import { StoreProvider } from '../../src/lib/store';
import Dashboard from '../../src/pages/Dashboard';

let container: HTMLDivElement;
let root: Root;
declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('Sparklines du tableau de bord & continuité PWA Workbox', () => {
  it('affiche un sparkline SVG valide et réactif sans NaN même à zéro', async () => {
    const zeros = Array.from({ length: 7 }, (_, i) => ({ label: `J-${6 - i}`, value: 0 }));
    await act(async () => {
      root.render(React.createElement(Sparkline, {
        values: zeros,
        color: 'sky',
        title: 'Tendance CA · 7j',
        formatValue: (v) => `${v} FCFA`,
      }));
    });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toContain('Tendance CA · 7j');
    const paths = [...container.querySelectorAll('path')];
    expect(paths.length).toBe(2);
    paths.forEach((p) => {
      expect(p.getAttribute('d')).not.toContain('NaN');
    });
    expect(container.textContent).toContain('Total 7j : 0 FCFA');
  });

  it('affiche la variation en pourcentage quand des données existent sur les 6 jours précédents', async () => {
    const series = [
      { label: 'Lun 1', value: 10000 },
      { label: 'Mar 2', value: 10000 },
      { label: 'Mer 3', value: 10000 },
      { label: 'Jeu 4', value: 10000 },
      { label: 'Ven 5', value: 10000 },
      { label: 'Sam 6', value: 10000 },
      { label: 'Aujourd’hui', value: 15000 },
    ];
    await act(async () => {
      root.render(React.createElement(Sparkline, {
        values: series,
        color: 'emerald',
        title: 'Tendance lavages · 7j',
        formatValue: (v) => `${v} lavages`,
      }));
    });
    expect(container.textContent).toContain('+50 % vs moy. 6j');
  });

  it('intègre les deux sparklines 7 jours dans les cartes CA et Lavages du tableau de bord', async () => {
    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(StoreProvider, null, React.createElement(Dashboard)),
        ),
      );
    });
    expect(container.textContent).toContain('Tendance CA · 7j');
    expect(container.textContent).toContain('Tendance lavages · 7j');
    const svgs = [...container.querySelectorAll('svg[role="img"]')];
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('affiche le bandeau hors ligne quand la connexion est perdue puis le masque au retour en ligne', async () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(StoreProvider, null, React.createElement(OfflineIndicator)),
        ),
      );
    });
    expect(container.textContent).toContain('Hors ligne');
    expect(container.textContent).toContain('cache');

    onLineSpy.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(container.querySelector('[role="status"]')?.textContent ?? '').not.toContain('Hors ligne');
    onLineSpy.mockRestore();
  });

  it('affiche le bouton d’installation PWA sur beforeinstallprompt', async () => {
    await act(async () => {
      root.render(React.createElement(PWAInstallButton));
    });
    expect(container.querySelector('button')).toBeNull();

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const installEvt = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted'; platform: string }>;
    };
    installEvt.prompt = promptMock;
    installEvt.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });

    await act(async () => {
      window.dispatchEvent(installEvt);
    });
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('Installer');
  });

  it('configure Workbox dans vite.config.ts et un manifeste PWA complet dans public/manifest.json', () => {
    const viteCfg = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteCfg).toContain('VitePWA');
    expect(viteCfg).toContain('washguard-api-cache');
    expect(viteCfg).toContain('washguard-pages-cache');
    expect(viteCfg).toContain('NetworkFirst');

    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'public/manifest.json'), 'utf8'));
    expect(manifest.id).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  });
});
