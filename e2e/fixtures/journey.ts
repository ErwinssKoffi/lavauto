import type { Page } from '@playwright/test';
import type { AppState, Session } from '../../src/types';
import { baseState } from './state';

/** Données isolées : aucune caisse ni opération préexistante. */
export function journeyState(session?: Session): Record<string, unknown> {
  const base = baseState();
  return {
    ...base,
    ...(session ? { session } : {}),
    washes: [], washCounter: 0, expenses: [],
    cashSessions: [], cashMovements: [], cashClosures: [],
  };
}

/**
 * La fixture métier est écrite une seule fois par contexte de navigateur : les
 * navigations et rechargements relisent ensuite le vrai localStorage de l'app.
 * Le pont Auth de test, lui, doit être réinjecté à chaque nouveau document :
 * la session normale est exclusivement en mémoire et n'est pas persistée.
 */
export async function seedJourney(page: Page, state = journeyState()): Promise<void> {
  await page.addInitScript((fixture) => {
    if (!sessionStorage.getItem('wg.e2e.journey.seeded')) {
      localStorage.setItem('washguard.state.v1', JSON.stringify(fixture));
      localStorage.setItem('washguard.theme', 'dark');
      sessionStorage.setItem('wg.e2e.journey.seeded', '1');
    }
    (window as unknown as { __WG_TEST_SESSION__: { session: unknown } }).__WG_TEST_SESSION__ = {
      session: fixture.session ?? null,
    };
  }, state);
}

/** Lecture des données de l'application, pas d'une copie de la fixture. */
export async function savedState(page: Page): Promise<Omit<AppState, 'session'>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('washguard.state.v1') ?? '{}'));
}
