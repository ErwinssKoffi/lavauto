// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readPendingPayment, savePendingPayment, type PendingPayment } from '../../src/lib/paymentAttempt';

const key = 'washguard.pending-payment.v1:user:station:wash';
const pending: PendingPayment = {
  version: 1, userId: 'user', stationId: 'station', washId: 'wash',
  amount: 1200, method: 'wave', key: 'payment-test-key',
};

afterEach(() => sessionStorage.clear());

describe('tentative de paiement dans cet onglet', () => {
  it('distingue une clé absente et une tentative sauvegardée', () => {
    expect(readPendingPayment('user', 'station', 'wash')).toBeNull();
    savePendingPayment(pending);
    expect(readPendingPayment('user', 'station', 'wash')).toEqual(pending);
  });
  it.each(['', '{tronqué'])('bloque une tentative illisible (%j) sans l’effacer', (raw) => {
    sessionStorage.setItem(key, raw);
    expect(() => readPendingPayment('user', 'station', 'wash')).toThrow(/illisible/);
    expect(sessionStorage.getItem(key)).toBe(raw);
  });
});
