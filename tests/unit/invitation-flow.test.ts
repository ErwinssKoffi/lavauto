import { describe, expect, it, vi } from 'vitest';
import { createInvitationHandler, type InvitationClient } from '../../supabase/functions/_shared/invitation';
import { SupabaseAuthAdapter, type AuthSupabaseClient } from '../../src/services/auth/SupabaseAuthAdapter';

const station = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reservation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const invitation = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const payload = { email: ' Invité@Example.invalid ', fullName: ' Aïcha Test ', phone: '+2250700000000', roleKey: 'manager', stationIds: [station] };

function harness() {
  const getUser = vi.fn(async () => ({ data: { user: { id: user } }, error: null }));
  const reserve = vi.fn(async (_name: string, _args?: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> => ({ data: reservation, error: null }));
  const invite = vi.fn(async (_email: string, _options: { redirectTo: string; data: Record<string, unknown> }): Promise<{ data: { user: { id: string } | null }; error: unknown }> => ({ data: { user: { id: user } }, error: null }));
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> =>
    name === 'finalize_user_invitation' ? { data: { userId: user, invitationId: invitation }, error: null } : { data: { status: 'cleanup' }, error: null });
  const caller = { auth: { getUser }, rpc } as unknown as InvitationClient;
  caller.rpc = reserve;
  const admin = { auth: { admin: { inviteUserByEmail: invite } }, rpc } as unknown as InvitationClient;
  const handler = createInvitationHandler({
    url: 'https://database.invalid', anonKey: 'anon', serviceKey: 'service',
    allowedOrigins: ['https://app.invalid'], defaultOrigin: 'https://app.invalid',
    makeClient: (_url, key) => key === 'anon' ? caller : admin,
  });
  const call = (body: unknown = payload, token = 'Bearer signed') => handler(new Request('https://edge.invalid', {
    method: 'POST', headers: { Authorization: token, Origin: 'https://app.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { call, getUser, reserve, invite, rpc };
}

describe('invitation : réservation puis Auth puis finalisation', () => {
  it('vérifie le JWT et la réservation avant Auth, puis finalise une seule fois', async () => {
    const h = harness();
    const response = await h.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, userId: user, invitationId: invitation });
    expect(h.getUser).toHaveBeenCalledWith('signed');
    expect(h.reserve).toHaveBeenCalledWith('reserve_user_invitation', {
      p_email: 'invité@example.invalid', p_full_name: 'Aïcha Test', p_phone: '+2250700000000', p_role_key: 'manager', p_station_ids: [station],
    });
    expect(h.reserve.mock.invocationCallOrder[0]).toBeLessThan(h.invite.mock.invocationCallOrder[0]);
    expect(h.invite.mock.invocationCallOrder[0]).toBeLessThan(h.rpc.mock.invocationCallOrder[0]);
    expect(h.invite).toHaveBeenCalledWith('invité@example.invalid', {
      redirectTo: 'https://app.invalid/connexion?invite=1',
      data: { full_name: 'Aïcha Test', phone: '+2250700000000', invitation: true, invitation_reservation_id: reservation },
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('finalize_user_invitation', {
      p_reservation: reservation, p_user: user, p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it.each([
    ['session absente', payload, ''],
    ['nom invalide', { ...payload, fullName: 'A' }, 'Bearer signed'],
    ['téléphone invalide', { ...payload, phone: '1' }, 'Bearer signed'],
    ['rôle interdit', { ...payload, roleKey: 'owner' }, 'Bearer signed'],
    ['station en double', { ...payload, stationIds: [station, station.toUpperCase()] }, 'Bearer signed'],
  ])('bloque %s avant toute réservation ou appel Auth', async (_label, body, token) => {
    const h = harness();
    expect((await h.call(body, token)).status).toBeGreaterThanOrEqual(400);
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.invite).not.toHaveBeenCalled();
  });

  it.each(['42501', '23514', '23505'])('un refus SQL %s ne contacte pas Auth', async (code) => {
    const h = harness();
    h.reserve.mockResolvedValueOnce({ data: null, error: { code, message: 'Abonnement ou quota refusé' } });
    const response = await h.call();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await response.json()).code).toBe('reservation_refused');
    expect(h.invite).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('une réservation à la réponse perdue ne déclenche pas Auth', async () => {
    const h = harness();
    h.reserve.mockRejectedValueOnce(new Error('timeout'));
    const response = await h.call();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('reservation_unconfirmed');
    expect(h.invite).not.toHaveBeenCalled();
  });

  it('ne libère ni ne supprime de compte lorsque la réponse Auth est perdue', async () => {
    const h = harness();
    h.invite.mockRejectedValueOnce(new Error('timeout'));
    const response = await h.call();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'invite_unconfirmed', error: expect.stringContaining('Ne renvoyez pas') });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('retrouve une finalisation commitée malgré une réponse perdue', async () => {
    const h = harness();
    h.rpc.mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { status: 'finalized', userId: user, invitationId: invitation }, error: null });
    const response = await h.call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, userId: user, invitationId: invitation });
    expect(h.rpc).toHaveBeenLastCalledWith('inspect_user_invitation', { p_reservation: reservation, p_user: user });
  });

  it('une finalisation non confirmée reste en rapprochement, sans suppression Auth', async () => {
    const h = harness();
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'essai expiré' } });
    const response = await h.call();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'profile_unconfirmed', error: expect.stringContaining('Ne renvoyez pas') });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc).toHaveBeenLastCalledWith('inspect_user_invitation', { p_reservation: reservation, p_user: user });
  });
});

describe('révocation navigateur : refus certain ou résultat incertain', () => {
  function adapter() {
    const rpc = vi.fn();
    const client = { rpc } as unknown as AuthSupabaseClient;
    return { instance: new SupabaseAuthAdapter(client), rpc };
  }

  it('transmet l’identifiant de l’invitation et accepte le succès de la RPC void', async () => {
    const h = adapter();
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(h.instance.revokeInvitation(invitation)).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledWith('revoke_invitation', { p_invitation_id: invitation });
  });

  it.each(['42501', '23514', 'P0002', '55000'])('un refus SQL explicite %s reste un refus', async (code) => {
    const h = adapter();
    h.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'Refus transactionnel' } });
    await expect(h.instance.revokeInvitation(invitation)).rejects.toMatchObject({ code: 'revoke_failed', message: 'Refus transactionnel' });
  });

  it.each([
    ['erreur réseau', { data: null, error: { message: 'Failed to fetch' } }],
    ['réponse proxy', { data: null, error: { message: 'Bad gateway', status: 502 } }],
    ['réponse malformée', { data: null }],
    ['réponse absente', null],
  ])('%s ne prouve pas un rollback', async (_label, response) => {
    const h = adapter();
    h.rpc.mockResolvedValueOnce(response);
    await expect(h.instance.revokeInvitation(invitation)).rejects.toMatchObject({
      code: 'revoke_unconfirmed', message: expect.stringContaining('peut-être déjà été enregistrée'),
    });
  });

  it('une exception de transport ne prouve pas un rollback', async () => {
    const h = adapter();
    h.rpc.mockRejectedValueOnce(new Error('timeout'));
    await expect(h.instance.revokeInvitation(invitation)).rejects.toMatchObject({ code: 'revoke_unconfirmed' });
  });
});

describe('modification de compte : refus SQL ou réponse incertaine', () => {
  const update = { userId: user, role: 'caissier' as const, active: false, stationIds: [station] };
  function adapter() {
    const rpc = vi.fn();
    return { instance: new SupabaseAuthAdapter({ rpc } as unknown as AuthSupabaseClient), rpc };
  }
  it('transmet les changements et accepte la réponse void confirmée', async () => {
    const h = adapter();
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(h.instance.updateUser(update)).resolves.toBeUndefined();
    expect(h.rpc).toHaveBeenCalledWith('admin_update_user', {
      p_user_id: user, p_role_key: 'cashier', p_active: false, p_station_ids: [station],
    });
  });
  it.each(['42501', '23514', 'P0002', '55000'])('un refus SQL explicite %s reste un refus', async (code) => {
    const h = adapter();
    h.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'Refus transactionnel' } });
    await expect(h.instance.updateUser(update)).rejects.toMatchObject({ code: 'update_user_failed', message: 'Refus transactionnel' });
  });
  it.each([
    ['réseau', { data: null, error: { message: 'Failed to fetch' } }],
    ['proxy', { data: null, error: { status: 503, message: 'Bad gateway' } }],
    ['réponse malformée', { data: null }],
    ['réponse absente', null],
  ])('%s ne prouve pas un rollback', async (_label, result) => {
    const h = adapter();
    h.rpc.mockResolvedValueOnce(result);
    await expect(h.instance.updateUser(update)).rejects.toMatchObject({
      code: 'update_unconfirmed', message: expect.stringContaining('peut-être déjà été enregistrée'),
    });
  });
  it('une exception de transport ne prouve pas un rollback', async () => {
    const h = adapter();
    h.rpc.mockRejectedValueOnce(new Error('timeout'));
    await expect(h.instance.updateUser(update)).rejects.toMatchObject({ code: 'update_unconfirmed' });
  });
});

describe('adaptateur navigateur : résultat incertain visible', () => {
  const invitePayload = { fullName: 'Aïcha', email: 'aicha@example.invalid', phone: '', role: 'gerant' as const, stationIds: [station] };
  function adapter(result: unknown) {
    const invoke = vi.fn(async () => result);
    const client = { functions: { invoke } } as unknown as AuthSupabaseClient;
    return { instance: new SupabaseAuthAdapter(client), invoke };
  }
  it('affiche un refus métier confirmé avant appel Auth', async () => {
    const response = new Response(JSON.stringify({ code: 'reservation_refused', error: 'Quota atteint' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const h = adapter({ data: null, error: { message: 'non-2xx', context: response } });
    await expect(h.instance.invite(invitePayload)).rejects.toMatchObject({ code: 'reservation_refused', message: 'Quota atteint' });
  });
  it('ne présente pas une erreur de transport comme un rejet certain', async () => {
    const h = adapter({ data: null, error: { message: 'fetch failed' } });
    await expect(h.instance.invite(invitePayload)).rejects.toMatchObject({ code: 'invite_unconfirmed', message: expect.stringContaining('Ne renvoyez pas') });
  });
  it('signale la réservation incertaine même si Auth n’a pas été appelé', async () => {
    const response = new Response(JSON.stringify({ code: 'reservation_unconfirmed' }), { status: 503, headers: { 'content-type': 'application/json' } });
    const h = adapter({ data: null, error: { message: 'non-2xx', context: response } });
    await expect(h.instance.invite(invitePayload)).rejects.toMatchObject({ code: 'reservation_unconfirmed', message: expect.stringContaining('support') });
  });
  it('ne présente pas une réponse de succès incomplète comme une invitation envoyée', async () => {
    const h = adapter({ data: { ok: true, invitationId: invitation }, error: null });
    await expect(h.instance.invite(invitePayload)).rejects.toMatchObject({ code: 'invite_unconfirmed' });
  });
  it.each([null, undefined, { data: null }, { error: null }])('une réponse absente ou malformée reste incertaine (%j)', async (response) => {
    const h = adapter(response);
    await expect(h.instance.invite(invitePayload)).rejects.toMatchObject({ code: 'invite_unconfirmed' });
  });
  it('retourne uniquement un succès confirmé', async () => {
    const h = adapter({ data: { ok: true, userId: user, invitationId: invitation }, error: null });
    await expect(h.instance.invite(invitePayload)).resolves.toMatchObject({ id: invitation, message: expect.stringContaining('Invitation envoyée') });
  });
});
