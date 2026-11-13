// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import { fakeSubscriptionAccess } from '../../e2e-connected/fixtures/mock-supabase';
import { analyticsBoardFromState, type AnalyticsSnapshot } from '../../src/lib/analytics';
import { todayISO } from '../../src/lib/format';
import { clonePlans, resetPlansCache } from '../../src/lib/plans';
import { mapSubscriptionAccess } from '../../src/lib/subscription';
import { LocalDataAdapter } from '../../src/services/adapters/LocalDataAdapter';
import type { AuthIdentity } from '../../src/services/auth/authTypes';
import type { AppState, Plan } from '../../src/types';

const fake = vi.hoisted(() => ({
  source: 'local' as 'local' | 'supabase',
  identity: null as AuthIdentity | null,
  plans: [] as Plan[],
  access: null as ReturnType<typeof fakeSubscriptionAccess> | null,
  readBoard: vi.fn(),
}));

vi.mock('../../src/services/adapters/DataAdapter', () => ({
  getDataSource: () => fake.source,
  getDataAdapter: (getState: () => AppState) => {
    const adapter = new LocalDataAdapter(getState);
    Object.defineProperty(adapter, 'listPlans', { value: async () => fake.plans });
    if (fake.source === 'supabase') {
      Object.defineProperty(adapter, 'subscriptionCommands', { value: {
        read: async (companyId: string) => mapSubscriptionAccess(fake.access, companyId),
      } });
      Object.defineProperty(adapter, 'analyticsCommands', { value: {} });
      Object.defineProperty(adapter, 'listAnalyticsBoard', { value: fake.readBoard });
    }
    return adapter;
  },
}));
vi.mock('../../src/services/auth/getAuthPort', () => ({
  getAuthPort: () => ({
    kind: fake.source,
    onAuthStateChange: (handler: (change: unknown) => void) => {
      let active = true;
      queueMicrotask(() => { if (active) handler({ type: 'INITIAL_SESSION', identity: fake.identity }); });
      return { unsubscribe: () => { active = false; } };
    },
    listUsers: async () => ({ identity: fake.identity, users: [] }),
    listInvitations: async () => [],
  }),
}));

import { emptyState, StoreProvider, useStore } from '../../src/lib/store';

const identity: AuthIdentity = {
  userId: 'u1', email: 'owner@test.invalid', fullName: 'Propriétaire', role: 'proprietaire', roleKey: 'owner',
  permissions: ['analytics.view', 'reports.view', 'subscription.manage'], companyId: 'co1', stationIds: ['st1'],
  stations: [{ id: 'st1', name: 'Station', city: 'Abidjan', activated: true, logoPath: null }],
  company: { id: 'co1', name: 'Entreprise', city: 'Abidjan', phone: '', currencyCode: 'XOF', suspended: false, createdAt: '2026-01-01T00:00:00Z' },
  isPlatformAdmin: false, active: true, emailConfirmed: true, profileReady: true,
};

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof useStore>;
declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

function Probe() { store = useStore(); return null; }
function fixture(): AppState {
  const day = todayISO();
  const state = baseState() as unknown as AppState;
  return { ...emptyState(), ...state,
    subscription: { ...state.subscription!, planId: 'premium', status: 'active' },
    stockMovements: [{ id: 'm1', stationId: 'st1', productId: 'p1', kind: 'consumption', qtyDelta: -1,
      unitCostMinor: 1234, referenceType: null, referenceId: null, idempotencyKey: null, note: '', createdAt: new Date().toISOString() }],
    costCertifications: [{ id: 'cert1', start: day, end: day, revenueMinor: 3000, consumptionCostMinor: 1234,
      operatingExpenseMinor: 500, commissionCostMinor: 0, grossMarginMinor: 1766, resultMinor: 1266,
      attestation: 'Attestation locale confidentielle', certifiedAt: new Date().toISOString() }],
  };
}
async function mount() {
  localStorage.setItem('washguard.state.v1', JSON.stringify(fixture()));
  await act(async () => { root.render(React.createElement(StoreProvider, { children: React.createElement(Probe) })); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear(); resetPlansCache();
  fake.source = 'local'; fake.identity = identity; fake.plans = clonePlans();
  const standard = fake.plans.find((plan) => plan.id === 'standard')!;
  standard.entitlements = { ...standard.entitlements!, consolidation: true, stock: false };
  fake.access = fakeSubscriptionAccess('co1');
  fake.readBoard.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); localStorage.clear(); sessionStorage.clear(); resetPlansCache();
});

describe('projection analytics et droits de formule', () => {
  it('filtre les deux périodes en local, efface le board sensible et retrouve les données après relecture autorisée', async () => {
    await mount();
    const day = todayISO();
    await act(async () => { await store.refreshAnalytics(day, day, day, day); });
    expect(store.analyticsBoard.period).toMatchObject({ consumptions: 1234, result: 1266, attestation: 'Attestation locale confidentielle' });
    expect(store.analyticsBoard.stations[0].consumptions).toBe(1234);

    // Une simple édition de libellé ne doit pas supprimer les droits techniques locaux.
    await act(async () => { await store.savePlan({ planId: 'premium', name: 'Premium modifié', priceMinor: 35000,
      trialDays: 0, active: true, sortOrder: 3, features: [] }); });
    expect(store.subscriptionAccess?.features.stock).toBe(true);
    await act(async () => { await store.setCompanySubscription({ companyId: 'co1', planId: 'standard', status: 'active' }); });
    expect(store.subscriptionAccess?.features).toMatchObject({ consolidation: true, stock: false });
    expect(store.analyticsBoard.period).toMatchObject({ consumptions: null, result: null, attestation: null, certified: false });
    expect(store.analyticsBoard.compare).toMatchObject({ consumptions: null, result: null, attestation: null });
    expect(store.analyticsBoard.stations[0].consumptions).toBeNull();
    await act(async () => { await store.refreshAnalytics(day, day, day, day); });
    expect(store.analyticsBoard.stations[0].consumptions).toBeNull();
    expect(store.state.costCertifications[0].attestation).toBe('Attestation locale confidentielle');
    expect(store.state.stockMovements[0].unitCostMinor).toBe(1234);

    await act(async () => { await store.setCompanySubscription({ companyId: 'co1', planId: 'premium', status: 'active' }); });
    expect(store.analyticsBoard.period.attestation).toBeNull(); // pas d'ancien board sensible en cache
    await act(async () => { await store.refreshAnalytics(day, day, day, day); });
    expect(store.analyticsBoard.period).toMatchObject({ consumptions: 1234, result: 1266, attestation: 'Attestation locale confidentielle' });
  });

  it('ignore une réponse Premium en vol après retrait du stock et filtre toute projection suivante', async () => {
    fake.source = 'supabase';
    await mount();
    const day = todayISO();
    const sensitive = analyticsBoardFromState(fixture(), day, day, day, day);
    let resolveBoard!: (board: AnalyticsSnapshot) => void;
    fake.readBoard.mockImplementationOnce(() => new Promise<AnalyticsSnapshot>((resolve) => { resolveBoard = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = store.refreshAnalytics(day, day, day, day); });
    expect(fake.readBoard).toHaveBeenCalledTimes(1);

    fake.access = { ...fake.access!, planId: 'standard', planName: 'Standard', status: 'active',
      features: { ...fake.access!.features, stock: false, consolidation: true } };
    await act(async () => { await store.refreshSubscriptionAccess(); });
    await act(async () => { resolveBoard(sensitive); await pending; });
    expect(store.analyticsBoard.period.attestation).toBeNull();
    expect(store.analyticsBoard.stations).toHaveLength(0); // ancienne réponse écartée

    fake.readBoard.mockResolvedValueOnce(sensitive); // défense UI, même si la RPC devrait déjà masquer
    await act(async () => { await store.refreshAnalytics(day, day, day, day); });
    expect(store.analyticsBoard.period).toMatchObject({ consumptions: null, result: null, attestation: null });
    expect(store.analyticsBoard.compare?.consumptions).toBeNull();
    expect(store.analyticsBoard.stations[0].consumptions).toBeNull();

    fake.access = { ...fake.access, planId: 'premium', planName: 'Premium', features: { ...fake.access.features, stock: true } };
    await act(async () => { await store.refreshSubscriptionAccess(); });
    expect(store.analyticsBoard.period.attestation).toBeNull();
    fake.readBoard.mockResolvedValueOnce(sensitive);
    await act(async () => { await store.refreshAnalytics(day, day, day, day); });
    expect(store.analyticsBoard.period.attestation).toBe('Attestation locale confidentielle');
  });
});
