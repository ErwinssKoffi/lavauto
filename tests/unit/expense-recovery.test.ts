// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPendingExpense, ExpenseCommandError, readPendingExpense, savePendingExpense, type PendingExpense } from '../../src/lib/expenseAttempt';
import { SupabaseFinanceCommands } from '../../src/services/adapters/SupabaseFinanceCommands';
import type { SupabaseReader, SupabaseResult } from '../../src/services/adapters/SupabaseDataAdapter';

const pending: PendingExpense = {
  version: 1, userId: 'user', stationId: 'station', startedAt: '2026-01-01T00:00:00Z',
  payload: { stationId: 'station', amount: 1200, category: 'Eau', reason: 'Facture test', supplier: '',
    date: '2026-01-01', method: 'wave', idempotencyKey: 'expense-test-key' },
};
const storageKey = 'washguard.pending-expense.v1:user:station';
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

function commands(result: SupabaseResult<unknown> | Error) {
  const rpc = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
  return { adapter: new SupabaseFinanceCommands({ rpc } as unknown as SupabaseReader), rpc };
}

describe('tentative de dépense dans cet onglet', () => {
  it('enregistre, relit et efface seulement la commande inchangée', () => {
    savePendingExpense(pending);
    expect(readPendingExpense('user', 'station')).toEqual(pending);
    expect(readPendingExpense('user', 'other')).toBeNull();
    expect(() => clearPendingExpense({ ...pending, payload: { ...pending.payload, amount: 1300 } })).toThrow(/a changé/);
    expect(readPendingExpense('user', 'station')).toEqual(pending);
    clearPendingExpense(pending);
    expect(readPendingExpense('user', 'station')).toBeNull();
  });
  it.each(['{tronqué', ''])('ne remplace pas une tentative illisible (%j) par une commande vide', (raw) => {
    sessionStorage.setItem(storageKey, raw);
    expect(() => readPendingExpense('user', 'station')).toThrow(/illisible/);
    expect(sessionStorage.getItem(storageKey)).toBe(raw);
  });
  it('signale une tentative disparue au lieu de confirmer silencieusement son effacement', () => {
    savePendingExpense(pending);
    sessionStorage.removeItem(storageKey);
    expect(() => clearPendingExpense(pending)).toThrow(/a disparu/);
  });
  it('refuse le stockage échoué avant envoi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(() => savePendingExpense(pending)).toThrow(/aucune dépense envoyée/);
  });
  it('signale un effacement non confirmé', () => {
    savePendingExpense(pending);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    expect(() => clearPendingExpense(pending)).toThrow(/non confirmé/);
    expect(readPendingExpense('user', 'station')).toEqual(pending);
  });
  it('rejette une tentative pour un autre utilisateur ou une autre station', () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ ...pending, stationId: 'other' }));
    expect(() => readPendingExpense('user', 'station')).toThrow(/illisible/);
  });
});

describe('commande de dépense Supabase', () => {
  it('transmet exactement la clé, le montant et le canal et exige un identifiant', async () => {
    const { adapter, rpc } = commands({ data: 'server-id', error: null, status: 200 });
    await expect(adapter.addExpense(pending.payload)).resolves.toBe('server-id');
    expect(rpc).toHaveBeenCalledWith('record_expense_by_key', {
      p_station_id: 'station', p_amount_minor: 1200, p_category_name: 'Eau', p_reason: 'Facture test',
      p_supplier: '', p_spent_at: '2026-01-01', p_method_key: 'wave', p_idempotency_key: 'expense-test-key',
    });
  });
  it.each([
    ['refus SQL', { data: null, error: { code: '42501', message: 'Refus' }, status: 403 }, 'rejected'],
    ['validation SQL', { data: null, error: { code: '23514', message: 'Invalide' }, status: 400 }, 'rejected'],
    ['collision', { data: null, error: { code: '23505', message: 'Collision' }, status: 409 }, 'unknown'],
    ['erreur proxy sans code', { data: null, error: { message: 'Proxy' }, status: 400 }, 'unknown'],
    ['timeout', { data: null, error: { message: 'Timeout' }, status: 408 }, 'unknown'],
    ['réseau', { data: null, error: { message: 'Network' }, status: 0 }, 'unknown'],
    ['serveur indisponible', { data: null, error: { message: 'Panne' }, status: 503 }, 'unknown'],
    ['identifiant absent', { data: null, error: null, status: 200 }, 'unknown'],
    ['exception réseau', new Error('Connexion coupée'), 'unknown'],
  ] as const)('classe %s sans présumer le résultat', async (_name, result, outcome) => {
    const { adapter } = commands(result);
    const error = await adapter.addExpense(pending.payload).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExpenseCommandError);
    expect((error as ExpenseCommandError).outcome).toBe(outcome);
  });
});
