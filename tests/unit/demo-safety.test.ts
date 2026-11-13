// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState, load } from '../../src/lib/store';
import { createDemoBackup, DEMO_PASSWORDS_KEY, DEMO_STATE_KEY, readDemoState, serializeDemoState, writeDemoState } from '../../src/lib/demoStorage';
import { verifyDemoPassword } from '../../src/lib/demoPasswords';
import { LocalAuthAdapter } from '../../src/services/auth/LocalAuthAdapter';
import type { AppState } from '../../src/types';
import type { SignUpPayload } from '../../src/services/auth/authTypes';

const payload: SignUpPayload = {
  companyName: 'Test Auto', stationName: 'Station test', phone: '+225 0700000000',
  city: 'Abidjan', ownerName: 'Propriétaire test', email: 'owner@test.invalid', password: 'test-unique-123',
};

function harness(initial: AppState = emptyState()) {
  let state = initial;
  const adapter = new LocalAuthAdapter({
    getState: () => state,
    setState: (updater) => { state = updater(state); },
  });
  return { adapter, state: () => state, setState: (next: AppState) => { state = next; } };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('sauvegarde et authentification de démonstration locale', () => {
  it('refuse une réinscription sans connecter ni remplacer un espace existant', async () => {
    const h = harness();
    await h.adapter.signUp(payload);
    h.setState({ ...h.state(), clients: [{ id: 'client', stationId: h.state().station!.id,
      name: 'Client à conserver', phone: '', plate: '', notes: '', createdAt: '2026-01-01' }] });
    writeDemoState(serializeDemoState(h.state()));
    await h.adapter.signOut();
    const before = structuredClone(h.state());
    const credentials = localStorage.getItem(DEMO_PASSWORDS_KEY);
    const saved = localStorage.getItem(DEMO_STATE_KEY);
    const changes: string[] = [];
    h.adapter.onAuthStateChange((change) => changes.push(change.type));
    await expect(h.adapter.signUp({ ...payload, companyName: 'Tentative', password: 'incorrect-456' }))
      .rejects.toMatchObject({ code: 'demo_account_exists' });
    expect(h.state()).toEqual(before);
    expect(await h.adapter.getIdentity()).toBeNull();
    expect(localStorage.getItem(DEMO_STATE_KEY)).toBe(saved);
    expect(localStorage.getItem(DEMO_PASSWORDS_KEY)).toBe(credentials);
    expect(changes).not.toContain('SIGNED_IN');
    await expect(h.adapter.signIn(payload.email, 'incorrect-456')).rejects.toMatchObject({ code: 'invalid_credentials' });
    const result = await h.adapter.signIn(payload.email.toUpperCase(), payload.password);
    expect(result.identity?.company?.name).toBe('Test Auto');
    expect(h.state().clients[0].name).toBe('Client à conserver');
  });

  it('révoque une invitation de démonstration en désactivant le compte lié', async () => {
    const h = harness();
    const signed = await h.adapter.signUp(payload);
    const invitation = await h.adapter.invite({ fullName: 'Invitée', email: 'invitee@test.invalid', phone: '',
      role: 'caissier', stationIds: signed.identity!.stationIds });
    const invited = h.state().users.find((user) => user.email === 'invitee@test.invalid');
    expect(invited?.active).toBe(true);
    await h.adapter.revokeInvitation(invitation.id);
    expect(h.state().users.find((user) => user.id === invited?.id)?.active).toBe(false);
    expect((await h.adapter.listInvitations())[0].revokedAt).toBeTruthy();
    await expect(h.adapter.revokeInvitation(invitation.id)).resolves.toBeUndefined();
    await h.adapter.updateUser({ userId: invited!.id, active: true });
    await expect(h.adapter.revokeInvitation(invitation.id)).rejects.toMatchObject({ code: 'reconciliation_required' });
    expect(h.state().users.find((user) => user.id === invited?.id)?.active).toBe(true);
  });

  it('protège aussi un état partiel même sans propriétaire', async () => {
    const initial = { ...emptyState(), clients: [{ id: 'orphan', stationId: '', name: 'À conserver',
      phone: '', plate: '', notes: '', createdAt: '2026-01-01' }] };
    const h = harness(initial);
    await expect(h.adapter.signUp(payload)).rejects.toMatchObject({ code: 'demo_account_exists' });
    expect(h.state()).toEqual(initial);
    expect(localStorage.getItem(DEMO_PASSWORDS_KEY)).toBeNull();
  });

  it('refuse deux inscriptions avant que React ait appliqué le premier état', async () => {
    const initial = emptyState();
    const setState = vi.fn();
    const adapter = new LocalAuthAdapter({ getState: () => initial, setState });
    const first = adapter.signUp(payload);
    const second = adapter.signUp({ ...payload, email: 'other@test.invalid' });
    await first;
    await expect(second).rejects.toMatchObject({ code: 'demo_account_exists' });
    expect(setState).toHaveBeenCalledTimes(1);
    expect(verifyDemoPassword(payload.email, payload.password)).toBe(true);
    expect(verifyDemoPassword('other@test.invalid', payload.password)).toBe(false);
  });

  it.each(['{données tronquées', 'null', '{"users":"incorrect"}', '{"washes":[null]}'])
  ('conserve intégralement un état illisible (%s) et bloque une nouvelle inscription', async (raw) => {
    localStorage.setItem(DEMO_STATE_KEY, raw);
    const recovered = load();
    expect(localStorage.getItem(DEMO_STATE_KEY)).toBe(raw);
    expect(readDemoState().status).toBe('unreadable');
    const h = harness(recovered);
    await expect(h.adapter.signUp(payload)).rejects.toMatchObject({ code: 'demo_storage_unavailable' });
    expect(localStorage.getItem(DEMO_STATE_KEY)).toBe(raw);
  });

  it('ne remplace pas les empreintes illisibles lors d’une inscription', async () => {
    const raw = '{empreintes tronquées';
    localStorage.setItem(DEMO_PASSWORDS_KEY, raw);
    const h = harness();
    await expect(h.adapter.signUp(payload)).rejects.toThrow('Stockage des accès de démonstration');
    expect(localStorage.getItem(DEMO_PASSWORDS_KEY)).toBe(raw);
    expect(h.state().company).toBeNull();
    expect(await h.adapter.getIdentity()).toBeNull();
  });

  it('exporte les deux valeurs brutes, y compris corrompues, sans jeton Supabase', () => {
    localStorage.setItem(DEMO_STATE_KEY, '{données à récupérer');
    localStorage.setItem(DEMO_PASSWORDS_KEY, '{empreintes à récupérer');
    localStorage.setItem('sb-test-auth-token', 'secret-ne-doit-pas-etre-exporte');
    const before = [...Object.keys(localStorage)].map((key) => [key, localStorage.getItem(key)]);
    const backup = createDemoBackup(localStorage, 'https://exemple.invalid');
    expect(backup).toMatchObject({ format: 'washguard-local-backup-v1', origin: 'https://exemple.invalid', entries: {
      [DEMO_STATE_KEY]: '{données à récupérer', [DEMO_PASSWORDS_KEY]: '{empreintes à récupérer',
    } });
    expect(JSON.stringify(backup)).not.toContain('secret-ne-doit-pas-etre-exporte');
    expect([...Object.keys(localStorage)].map((key) => [key, localStorage.getItem(key)])).toEqual(before);
  });
});
