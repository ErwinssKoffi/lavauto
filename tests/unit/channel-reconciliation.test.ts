import { describe, expect, it } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import { channelExpected, mapFinanceBoard } from '../../src/lib/finance';
import { normalizeWashes } from '../../src/lib/washLifecycle';
import type { AppState, Payment, PaymentMethod, Wash } from '../../src/types';

const method = (id: string, stationId: string, uiMethod: PaymentMethod['uiMethod']): PaymentMethod => ({
  id, stationId, key: uiMethod, label: uiMethod, uiMethod, affectsCash: false, active: true,
});
const payment = (id: string, amount: number, methodKey: Payment['method'], at: string): Payment => ({
  id, amount, method: methodKey, at, byUserId: 'u1',
});

describe('canaux de paiement et rapprochement', () => {
  it('conserve Wave, Orange Money et MTN dans les projections lavage et finance', () => {
    const methods = ['wave', 'orange_money', 'mtn_momo'] as const;
    const rows = methods.map((key) => ({ id: key, stationId: 'st1', key, label: key,
      uiMethod: key, affectsCash: false, active: true }));
    const board = mapFinanceBoard({
      paymentMethods: rows, cashSessions: [], cashMovements: [], cashClosures: [], expenses: [],
      reconciliations: [], commissionPeriods: [], commissionLines: [], commissionPayouts: [], paymentCancellations: [],
    });
    expect(board.paymentMethods.map((row) => row.uiMethod)).toEqual(methods);
    const washes = normalizeWashes([{ id: 'w1', status: 'pending', payments: methods.map((key) => ({ method: key })) }]);
    expect(washes[0].payments.map((row) => row.method)).toEqual(methods);
  });

  it('isole la station et retranche les remboursements de la période, même pour un paiement antérieur', () => {
    const base = baseState() as unknown as AppState;
    const original = base.washes[0];
    const washes: Wash[] = [{
      ...original, stationId: 'st1', payments: [
        payment('old', 400, 'wave', '2026-11-10T12:00:00'),
        payment('new', 1000, 'wave', '2026-11-11T12:00:00'),
        payment('orange', 700, 'orange_money', '2026-11-11T12:00:00'),
      ],
    }, {
      ...original, id: 'w2', stationId: 'st2', payments: [
        payment('other', 2000, 'wave', '2026-11-11T12:00:00'),
      ],
    }];
    const state: AppState = { ...base, washes,
      paymentMethods: [method('wave-a', 'st1', 'wave'), method('orange-a', 'st1', 'orange_money'), method('wave-b', 'st2', 'wave')],
      paymentCancellations: [
        { id: 'cancel-old', paymentId: 'old', amount: 400, reason: '', at: '2026-11-11T13:00:00' },
        { id: 'cancel-other', paymentId: 'other', amount: 2000, reason: '', at: '2026-11-12T13:00:00' },
      ],
    };
    expect(channelExpected(state, 'wave-a', '2026-11-11', '2026-11-11')).toBe(600);
    expect(channelExpected(state, 'orange-a', '2026-11-11', '2026-11-11')).toBe(700);
    expect(channelExpected(state, 'wave-b', '2026-11-11', '2026-11-11')).toBe(2000);
    expect(channelExpected(state, 'wave-b', '2026-11-12', '2026-11-12')).toBe(-2000);
    expect(channelExpected(state, 'unknown', '2026-11-11', '2026-11-11')).toBe(0);
  });
});
