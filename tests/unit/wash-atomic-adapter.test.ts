// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseWashCommands, type SupabaseReader, type SupabaseResult } from '../../src/services/adapters/SupabaseDataAdapter';
import type { WashCreatePayload } from '../../src/services/adapters/DataAdapter';
import {
  clearPendingWash, readPendingWash, savePendingWash, WashCreationError,
  type PendingWashCreation,
} from '../../src/lib/washCreation';

const payload: WashCreatePayload = {
  stationId: 'station', categoryId: 'category', plate: '1234 AB 01', clientId: null, clientName: '',
  items: [{ serviceId: 'service', qty: 2 }], discount: 500, employeeIds: ['employee'], postId: null,
  idempotencyKey: 'ui-atomic-123456', payment: { amount: 1000, method: 'wave' },
};

function commands(result: SupabaseResult<unknown> | Error) {
  const rpc = vi.fn().mockImplementation(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { rpc, instance: new SupabaseWashCommands({ rpc } as unknown as SupabaseReader) };
}

beforeEach(() => sessionStorage.clear());

describe('création Supabase atomique', () => {
  it('envoie fiche et paiement en un seul appel, sans prix ni tenant', async () => {
    const fake = commands({ data: 'wash-id', error: null });
    await expect(fake.instance.createWash(payload)).resolves.toBe('wash-id');
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('create_wash_atomic', { p_payload: {
      station_id: 'station', category_id: 'category', plate: '1234 AB 01', customer_id: null,
      customer_name: '', discount_minor: 500, items: [{ serviceId: 'service', qty: 2 }],
      employee_ids: ['employee'], post_id: null, idempotency_key: 'ui-atomic-123456',
      initial_payment: { amount_minor: 1000, method_key: 'wave' },
    } });
    expect(JSON.stringify(fake.rpc.mock.calls)).not.toMatch(/company_id|price_minor|service_role/);
  });

  it('envoie explicitement null pour une fiche sans paiement', async () => {
    const fake = commands({ data: 'wash-id', error: null });
    await fake.instance.createWash({ ...payload, payment: null });
    expect(fake.rpc.mock.calls[0][1].p_payload.initial_payment).toBeNull();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['especes', 'cash'], ['wave', 'wave'], ['orange_money', 'orange_money'],
    ['mtn_momo', 'mtn_momo'], ['mobile_money', 'mobile_money'], ['carte', 'card'], ['virement', 'transfer'],
  ] as const)('conserve le canal %s → %s', async (method, dbMethod) => {
    const fake = commands({ data: 'wash-id', error: null });
    await fake.instance.createWash({ ...payload, payment: { amount: 1000, method } });
    expect(fake.rpc.mock.calls[0][1].p_payload.initial_payment.method_key).toBe(dbMethod);
  });

  it.each([
    ['erreur réseau', { data: null, status: 0, error: { message: 'Failed to fetch', code: '' } }],
    ['réponse 503', { data: null, status: 503, error: { message: 'serveur indisponible' } }],
    ['timeout 408', { data: null, status: 408, error: { message: 'timeout' } }],
    ['throttling 429', { data: null, status: 429, error: { message: 'réessayer' } }],
    ['collision de clé', { data: null, status: 409, error: { code: '23505', message: 'clé utilisée' } }],
    ['identifiant absent', { data: null, status: 200, error: null }],
    ['exception réseau', new Error('Failed to fetch')],
  ] as [string, SupabaseResult<unknown> | Error][])('%s : résultat incertain, aucun repli', async (_name, result) => {
    const fake = commands(result);
    const error = await fake.instance.createWash(payload).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WashCreationError);
    expect((error as WashCreationError).outcome).toBe('unknown');
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc.mock.calls[0][0]).toBe('create_wash_atomic');
  });

  it('distingue refus métier explicite et migration manquante sans revenir aux anciennes RPC', async () => {
    for (const result of [
      { data: null, status: 403, error: { message: 'permission refusée', code: '42501' } },
      { data: null, status: 404, error: { message: 'fonction introuvable', code: 'PGRST202' } },
    ]) {
      const fake = commands(result);
      const error = await fake.instance.createWash(payload).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WashCreationError);
      expect((error as WashCreationError).outcome).toBe('rejected');
      if (result.error.code === 'PGRST202') expect((error as Error).message).toContain('migration 052');
      expect(fake.rpc).toHaveBeenCalledTimes(1);
      expect(fake.rpc.mock.calls[0][0]).toBe('create_wash_atomic');
    }
  });
});

describe('reprise locale d’une création incertaine', () => {
  const pending: PendingWashCreation = {
    version: 1, userId: 'user-a', stationId: 'station', startedAt: '2026-11-12T12:00:00Z', payload,
  };
  it('conserve la commande exacte dans cet onglet et isole utilisateur et station', () => {
    savePendingWash(pending);
    expect(readPendingWash('user-a', 'station')).toEqual(pending);
    expect(readPendingWash('user-b', 'station')).toBeNull();
    expect(readPendingWash('user-a', 'other-station')).toBeNull();
    clearPendingWash({ ...pending, payload: { ...payload, idempotencyKey: 'other-key' } });
    expect(readPendingWash('user-a', 'station')).toEqual(pending);
    clearPendingWash(pending);
    expect(readPendingWash('user-a', 'station')).toBeNull();
  });
  it.each(['{', ''])('bloque une tentative illisible (%j) au lieu de l’effacer silencieusement', (raw) => {
    sessionStorage.setItem('washguard.pending-wash.v1:user-a:station', raw);
    expect(() => readPendingWash('user-a', 'station')).toThrow('Tentative de création illisible');
    expect(sessionStorage.getItem('washguard.pending-wash.v1:user-a:station')).toBe(raw);
  });
  it.each([
    { ...payload, plate: null },
    { ...payload, payment: { amount: 1.5, method: 'wave' } },
    { ...payload, payment: { amount: 1000, method: 'inconnu' } },
    { ...payload, items: [{ serviceId: 'service', qty: 1.5 }] },
    { ...payload, idempotencyKey: '' },
  ])('bloque une commande stockée partiellement corrompue sans la rejouer', (broken) => {
    const key = 'washguard.pending-wash.v1:user-a:station';
    const raw = JSON.stringify({ ...pending, payload: broken });
    sessionStorage.setItem(key, raw);
    expect(() => readPendingWash('user-a', 'station')).toThrow('Tentative de création illisible');
    expect(sessionStorage.getItem(key)).toBe(raw);
  });
  it('refuse un montant fractionnaire avant envoi et sans écrire de tentative', () => {
    expect(() => savePendingWash({ ...pending, payload: { ...payload, payment: { amount: 1.5, method: 'wave' } } }))
      .toThrow('Aucune fiche n’a été envoyée');
    expect(readPendingWash('user-a', 'station')).toBeNull();
  });
  it('refuse la création avant envoi si le stockage de session échoue', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    try { expect(() => savePendingWash(pending)).toThrow('aucune fiche n’a été envoyée'); }
    finally { spy.mockRestore(); }
  });
});
