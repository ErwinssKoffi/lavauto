// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import { emptySubscriptionUsage, monthStartISO } from '../../src/lib/analytics';
import { clonePlans, resetPlansCache } from '../../src/lib/plans';

const fake = vi.hoisted(() => ({ store: {} as Record<string, unknown>, refresh: vi.fn() }));
vi.mock('../../src/lib/store', () => ({ useStore: () => fake.store }));
import Subscription from '../../src/pages/Subscription';

let container: HTMLDivElement;
let root: Root;
declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

async function render() {
  await act(async () => { root.render(React.createElement(Subscription)); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  resetPlansCache(); // Le cache global contient volontairement les tarifs locaux.
  fake.refresh.mockReset().mockResolvedValue(undefined);
  fake.store = {
    state: baseState(), plans: [], plansError: null, dataSource: 'supabase',
    authReady: true, identity: { userId: 'u1' }, subscriptionUsage: emptySubscriptionUsage(),
    refreshSubscriptionUsage: fake.refresh, requestPlanChange: vi.fn(),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  resetPlansCache();
});

describe('formules et consommation de la page Abonnement', () => {
  it('ne lit pas les tarifs locaux du cache global pendant le chargement connecté', async () => {
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('—');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Chargement des formules');
    expect(container.textContent).not.toContain('15 000 FCFA');
    expect(container.textContent).not.toContain('35 000 FCFA');
    expect(container.textContent).toContain('Statut non confirmé');
    expect(container.textContent).toContain('Compteurs et limites indisponibles');
  });

  it('ne présente aucun prix de remplacement si la lecture échoue', async () => {
    fake.store.plansError = 'base indisponible';
    await render();
    expect(container.textContent).toContain('Aucune formule disponible : base indisponible');
    expect(container.textContent).not.toContain('15 000 FCFA');
    expect(container.querySelector('h2')?.textContent).toBe('—');
  });

  it('affiche les données serveur reçues et ne remplace pas une limite NULL par une valeur locale', async () => {
    fake.store.plans = [{
      id: 'essai', name: 'Formule serveur', priceMonthly: 16000, trial: true,
      limits: { stations: 2, employees: 12, washesPerMonth: 900 }, features: ['Avantage serveur'],
    }];
    fake.store.subscriptionUsage = {
      periodStart: monthStartISO(), usage: { stations: 2, employees: 4, washes: 10 },
      limits: { stations: 2, employees: null, washesPerMonth: 900 }, rows: [], rules: { quota: 'serveur' },
    };
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('Formule serveur');
    expect(container.textContent).toContain('16 000 FCFA');
    expect(container.textContent).not.toContain('15 000 FCFA');
    expect(container.textContent).toContain('∞ (aucune limite définie)');
    expect(container.textContent).toContain('ne sont pas confirmées ni transmises au serveur');
  });

  it('conserve les formules locales en mode démonstration', async () => {
    fake.store.dataSource = 'local';
    fake.store.plans = clonePlans();
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('Essai');
    expect(container.textContent).toContain('15 000 FCFA');
    expect(container.textContent).toContain('ne modifie pas la facturation');
  });

  it('n’attribue pas à une entreprise un abonnement local issu d’une autre', async () => {
    fake.store.plans = clonePlans();
    const state = fake.store.state as { company: { id: string } };
    state.company.id = 'autre-entreprise';
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('—');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });
});
