import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuthAdapter, type AuthSupabaseClient } from '../../src/services/auth/SupabaseAuthAdapter';
import type { AuthChange } from '../../src/services/auth/AuthPort';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const user = (id: string) => ({ data: { user: { id, email: `${id}@test.invalid`, email_confirmed_at: '2026-01-01' } }, error: null });
const context = (id: string, permissions = ['washes.view']) => ({ data: {
  authenticated: true, profileReady: true, active: true, userId: id,
  companyId: 'company', company: { id: 'company', name: 'Test' },
  email: `${id}@test.invalid`, fullName: id, roleKey: 'owner', permissions,
  stations: [{ id: 'station', name: 'Station', activated: true }],
}, error: null });
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function harness() {
  let callback!: (event: string, session: { access_token?: string } | null) => void;
  const getUser = vi.fn();
  const rpc = vi.fn();
  const client = {
    auth: {
      getUser,
      onAuthStateChange: (fn: typeof callback) => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc,
  } as unknown as AuthSupabaseClient;
  const adapter = new SupabaseAuthAdapter(client);
  const changes: AuthChange[] = [];
  adapter.onAuthStateChange((change) => changes.push(change));
  const emit = (event: string, token?: string) => callback(event, token ? { access_token: token } : null);
  return { adapter, changes, getUser, rpc, emit };
}

describe('synchronisation Auth et identité vérifiée', () => {
  it('ignore une vérification utilisateur terminée après déconnexion', async () => {
    const h = harness(); const old = deferred<ReturnType<typeof user>>();
    h.getUser.mockReturnValueOnce(old.promise);
    h.emit('SIGNED_IN', 'old'); h.emit('SIGNED_OUT'); old.resolve(user('ancien'));
    await flush();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.changes.map((c) => c.type)).toEqual(['SIGNED_OUT']);
  });

  it('ignore un contexte et une erreur tardifs après reconnexion', async () => {
    const h = harness(); const old = deferred<ReturnType<typeof context>>();
    h.getUser.mockResolvedValueOnce(user('ancien')).mockResolvedValueOnce(user('nouveau'));
    h.rpc.mockReturnValueOnce(old.promise).mockResolvedValueOnce(context('nouveau'))
      .mockResolvedValue({ data: null, error: null });
    h.emit('SIGNED_IN', 'old'); await flush();
    h.emit('SIGNED_OUT'); h.emit('SIGNED_IN', 'new'); await flush();
    old.reject(new Error('ancienne erreur')); await flush();
    expect(h.changes.map((c) => [c.type, c.identity?.userId])).toEqual([
      ['SIGNED_OUT', undefined], ['SIGNED_IN', 'nouveau'],
    ]);
    expect((await h.adapter.getIdentity())?.userId).toBe('nouveau');
  });

  it('un nouveau jeton invalide une lecture en cours même sans événement de déconnexion', async () => {
    const h = harness(); const old = deferred<ReturnType<typeof context>>();
    h.getUser.mockResolvedValueOnce(user('ancien')).mockResolvedValueOnce(user('nouveau'));
    h.rpc.mockReturnValueOnce(old.promise).mockResolvedValueOnce(context('nouveau'))
      .mockResolvedValue({ data: null, error: null });
    h.emit('SIGNED_IN', 'token-a'); await flush();
    h.emit('SIGNED_IN', 'token-b'); await flush();
    old.resolve(context('ancien')); await flush();
    expect(h.getUser).toHaveBeenCalledTimes(2);
    expect(h.changes.map((c) => c.identity?.userId)).toEqual(['nouveau']);
    expect((await h.adapter.getIdentity())?.userId).toBe('nouveau');
  });

  it('relit les permissions au rafraîchissement même si le jeton est inchangé', async () => {
    const h = harness();
    h.getUser.mockResolvedValue(user('utilisateur'));
    h.rpc.mockResolvedValueOnce(context('utilisateur', ['washes.view', 'reports.view']))
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(context('utilisateur', ['washes.view']));
    h.emit('SIGNED_IN', 'same'); await flush();
    h.emit('TOKEN_REFRESHED', 'same'); await flush();
    expect(h.changes[h.changes.length - 1]?.identity?.permissions).toEqual(['washes.view']);
    expect(h.rpc.mock.calls.filter(([name]) => name === 'my_context')).toHaveLength(2);
  });

  it('refuse un contexte qui ne correspond pas à l’utilisateur vérifié', async () => {
    const h = harness();
    h.getUser.mockResolvedValue(user('utilisateur'));
    h.rpc.mockResolvedValue(context('autre'));
    h.emit('SIGNED_IN', 'token'); await flush();
    expect(h.changes).toHaveLength(1);
    expect(h.changes[0]).toMatchObject({ type: 'SIGNED_OUT', identity: null, reason: 'session_expired' });
  });
});
