// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import { emptySubscriptionUsage, quotaMonthStartISO } from '../../src/lib/analytics';
import { clonePlans, resetPlansCache } from '../../src/lib/plans';
import { accessCanWrite, localSubscriptionAccess, mapSubscriptionAccess } from '../../src/lib/subscription';
import { fakeSubscriptionAccess } from '../../e2e-connected/fixtures/mock-supabase';
import type { AppState } from '../../src/types';

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
    state: baseState(), plans: [], plansError: null, dataSource: 'supabase', authKind: 'supabase',
    authReady: true, identity: { userId: 'u1' }, subscriptionUsage: emptySubscriptionUsage(),
    subscriptionAccess: null, subscriptionStatus: 'loading', subscriptionError: null, canWriteSubscription: false,
    refreshSubscriptionAccess: vi.fn(), refreshSubscriptionUsage: fake.refresh, requestPlanChange: vi.fn(),
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
    expect(container.textContent).toContain('Vérification…');
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
    fake.store.subscriptionAccess = { ...mapSubscriptionAccess(fakeSubscriptionAccess('co1'), 'co1'), planName: 'Formule serveur' };
    fake.store.subscriptionStatus = 'ready';
    fake.store.canWriteSubscription = true;
    fake.store.subscriptionUsage = {
      periodStart: quotaMonthStartISO(), usage: { stations: 2, employees: 4, washes: 10 },
      limits: { stations: 2, employees: null, washesPerMonth: 900 }, rows: [], rules: { quota: 'serveur' },
    };
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('Formule serveur');
    expect(container.textContent).toContain('16 000 FCFA');
    expect(container.textContent).not.toContain('15 000 FCFA');
    expect(container.textContent).toContain('limite indisponible');
    expect(container.textContent).toContain('aucun paiement automatique');
  });

  it('conserve les formules locales en mode démonstration', async () => {
    fake.store.dataSource = 'local';
    fake.store.authKind = 'local';
    fake.store.plans = clonePlans();
    fake.store.subscriptionAccess = localSubscriptionAccess(fake.store.state as AppState, clonePlans());
    fake.store.subscriptionStatus = 'ready';
    fake.store.canWriteSubscription = true;
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('Essai');
    expect(container.textContent).toContain('15 000 FCFA');
    expect(container.textContent).toContain('Aucun abonnement réel');
  });

  it('permet de demander le renouvellement manuel après expiration payante', async () => {
    const paid = { ...fakeSubscriptionAccess('co1'), planId: 'standard', planName: 'Standard', status: 'active',
      currentPeriodEnd: '2026-11-10', serverTime: '2026-11-12T12:00:00Z', canWrite: false, reason: 'period_expired' };
    fake.store.plans = clonePlans();
    fake.store.subscriptionAccess = mapSubscriptionAccess(paid, 'co1');
    fake.store.subscriptionStatus = 'ready';
    fake.store.canWriteSubscription = false;
    await render();
    expect(container.textContent).toContain('Période expirée · lecture seule');
    const renewal = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Renouveler Standard'));
    expect(renewal?.disabled).toBe(false);
  });

  it('n’attribue pas à une entreprise un abonnement local issu d’une autre', async () => {
    fake.store.dataSource = 'local';
    fake.store.authKind = 'local';
    fake.store.plans = clonePlans();
    const state = fake.store.state as { company: { id: string } };
    state.company.id = 'autre-entreprise';
    fake.store.subscriptionAccess = localSubscriptionAccess(fake.store.state as AppState, clonePlans());
    expect(fake.store.subscriptionAccess).toBeNull();
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('—');
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true);
  });
});

describe('échéance payante lue sur le serveur', () => {
  const raw = () => ({ ...fakeSubscriptionAccess('co1'), planId: 'premium', planName: 'Premium', status: 'active',
    trialEndsAt: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-12',
    serverTime: '2026-11-12T12:00:00Z', canWrite: true, reason: null });

  it('est exclusive à minuit UTC et tient compte de l’écart d’horloge', () => {
    const receivedAt = Date.parse('2030-01-01T00:00:00Z');
    const access = mapSubscriptionAccess(raw(), 'co1', receivedAt);
    const expectedDeadline = receivedAt + Date.parse('2026-12-12T00:00:00Z') - Date.parse('2026-11-12T12:00:00Z');
    expect(access.clientWriteDeadline).toBe(expectedDeadline);
    expect(accessCanWrite(access, expectedDeadline - 1)).toBe(true);
    expect(accessCanWrite(access, expectedDeadline)).toBe(false);
  });

  it('refuse un droit payant sans échéance valide ou déjà échu', () => {
    expect(() => mapSubscriptionAccess({ ...raw(), currentPeriodEnd: null }, 'co1')).toThrow('Dates');
    expect(() => mapSubscriptionAccess({ ...raw(), currentPeriodEnd: '2026-02-30' }, 'co1')).toThrow('Dates');
    expect(() => mapSubscriptionAccess({ ...raw(), currentPeriodEnd: '2026-11-12' }, 'co1')).toThrow('incohérents');
  });
});
