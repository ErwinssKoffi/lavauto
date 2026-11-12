// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import { theoreticalCash } from '../../src/lib/metrics';
import type { PayMethod } from '../../src/types';

// Aucune Auth ni commande distante : seul le store local est exercé.
vi.mock('../../src/services/auth/getAuthPort', () => ({
  getAuthPort: () => ({
    kind: 'local',
    onAuthStateChange: () => ({ unsubscribe: () => {} }),
  }),
}));
import { StoreProvider, useStore } from '../../src/lib/store';

let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useStore>;

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

function Probe() { store = useStore(); return null; }
async function mount(options: { open: boolean; cashRequiresOpen?: boolean }) {
  const base = baseState();
  const station = base.station as Record<string, unknown>;
  const cashSessions = options.open ? [{
    id: 'cash-test', stationId: 'st1', openedBy: 'Test', openedAt: new Date(Date.now() - 5000).toISOString(),
    openingFloat: 10000, closedAt: null, countedAmount: null, closedBy: null,
    status: 'ouverte', reopenReason: null, reopenedAt: null,
  }] : [];
  localStorage.setItem('washguard.state.v1', JSON.stringify({
    ...base, station: { ...station, cashRequiresOpen: options.cashRequiresOpen ?? true },
    washes: [], washCounter: 0, expenses: [], cashSessions, cashMovements: [], cashClosures: [],
  }));
  await act(async () => { root.render(React.createElement(StoreProvider, null, React.createElement(Probe))); });
}
function create(method: PayMethod, amount = 1000) {
  return store.createWash({
    categoryId: 'c1', plate: '1234 AB 01', employeeId: 'u1', clientId: null, clientName: '',
    items: [{ serviceId: 's1', qty: 1 }], discount: 0, payment: { amount, method },
  });
}

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
  localStorage.clear();
});

describe('paiement local saisi à la création du lavage', () => {
  it('lie le mouvement espèces au paiement et le garde correct après encaissement et remboursement', async () => {
    await mount({ open: true });
    await act(async () => { await create('especes'); });
    const wash = store.state.washes[0];
    const initial = wash.payments[0];
    expect(store.state.cashMovements).toHaveLength(1);
    expect(store.state.cashMovements[0]).toMatchObject({
      cashSessionId: 'cash-test', kind: 'payment_in', amount: 1000, paymentId: initial.id, uiMethod: 'especes',
    });
    expect(theoreticalCash(store.state, 'cash-test')).toBe(11000);

    await act(async () => { await store.addPayment(wash.id, 1000, 'especes', 'pay-next'); });
    expect(theoreticalCash(store.state, 'cash-test')).toBe(12000);
    await act(async () => { await store.cancelPayment(initial.id, 'Erreur client'); });
    expect(store.state.cashMovements).toHaveLength(3);
    expect(store.state.cashMovements[2]).toMatchObject({ kind: 'adjustment', amount: -1000, paymentId: initial.id, cashSessionId: 'cash-test' });
    expect(store.state.washes[0].paid).toBe(1000);
    expect(theoreticalCash(store.state, 'cash-test')).toBe(11000);

    await act(async () => { await store.closeCash(10900); });
    expect(store.state.cashClosures[0]).toMatchObject({ theoretical: 11000, counted: 10900, difference: -100 });
  });

  it('ne crée pas de mouvement espèces pour un paiement Mobile Money', async () => {
    await mount({ open: true });
    await act(async () => { await create('mobile_money'); });
    expect(store.state.washes[0].paid).toBe(1000);
    expect(store.state.cashMovements).toEqual([]);
    expect(theoreticalCash(store.state, 'cash-test')).toBe(10000);
  });

  it.each([
    [{ items: [{ serviceId: 's1', qty: 1.5 }] }, 'quantités'],
    [{ items: [{ serviceId: 's1', qty: 0 }] }, 'quantités'],
    [{ discount: 1.5 }, 'remise'],
    [{ discount: -1 }, 'remise'],
    [{ payment: { amount: 1.5, method: 'wave' } }, 'paiement'],
    [{ payment: { amount: -1, method: 'wave' } }, 'paiement'],
    [{ payment: { amount: 100, method: 'autre' } }, 'paiement'],
  ])('refuse les données invalides avant toute écriture : %s', async (override, message) => {
    await mount({ open: true });
    const payload = {
      categoryId: 'c1', plate: '1234 AB 01', employeeId: 'u1', clientId: null, clientName: '',
      items: [{ serviceId: 's1', qty: 1 }], discount: 0, payment: null,
      ...override,
    } as Parameters<typeof store.createWash>[0];
    expect(() => store.createWash(payload)).toThrow(new RegExp(message, 'i'));
    expect(store.state.washes).toHaveLength(0);
    expect(store.state.cashMovements).toEqual([]);
  });

  it.each([1.5, -1, NaN, Infinity])('refuse un comptage de rapprochement non entier ou invalide : %s', async (counted) => {
    await mount({ open: true });
    expect(() => store.reconcileChannel('canal', '2026-11-01', '2026-11-30', counted))
      .toThrow('Le montant doit être un entier en FCFA');
    expect(store.state.reconciliations).toEqual([]);
  });

  it('refuse les espèces sans caisse lorsque la règle est active ; pas de mouvement si elle est désactivée', async () => {
    await mount({ open: false });
    expect(() => create('especes')).toThrow('exige une caisse ouverte');
    expect(store.state.washes).toHaveLength(0);
    expect(store.state.cashMovements).toEqual([]);
    await act(async () => { store.updateStation({ cashRequiresOpen: false }); });
    await act(async () => { await create('especes'); });
    expect(store.state.washes[0].paid).toBe(1000);
    expect(store.state.cashMovements).toEqual([]);
  });
});
