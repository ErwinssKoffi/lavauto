import { expect, test } from '@playwright/test';
import { EMAIL, OWNER, STATION, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

const INVITED_USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const INVITATION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

type InvitationRow = {
  id: string; email: string; roleKey: string; stationIds: string[];
  expiresAt: string; acceptedAt: string | null; revokedAt: string | null; createdAt: string;
};

// La fonction et ses réponses sont simulées : ce test n'exécute pas l'Edge
// Function, ne crée pas de compte Auth et n'envoie aucun e-mail.
function invitationBackend(reject = false) {
  const now = new Date().toISOString();
  const users = [{ id: OWNER, fullName: 'Propriétaire', email: EMAIL, phone: '', roleKey: 'owner', active: true, stationIds: [STATION] }];
  const invitations: InvitationRow[] = [];
  const handle = (call: Call) => {
    if (call.path === '/rest/v1/rpc/my_company_users') return { data: users };
    if (call.path === '/rest/v1/rpc/my_company_invitations') return { data: invitations };
    if (call.path === '/functions/v1/invite-user') {
      if (reject) return { status: 403, data: { error: 'Permission refusée', code: 'forbidden' } };
      users.push({
        id: INVITED_USER, fullName: String(call.body.fullName), email: String(call.body.email),
        phone: String(call.body.phone), roleKey: String(call.body.roleKey), active: true, stationIds: [STATION],
      });
      invitations.push({
        id: INVITATION, email: String(call.body.email), roleKey: String(call.body.roleKey), stationIds: [STATION],
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), acceptedAt: null, revokedAt: null, createdAt: now,
      });
      return { data: { ok: true, userId: INVITED_USER, invitationId: INVITATION } };
    }
    if (call.path === '/rest/v1/rpc/revoke_invitation') {
      const invitation = invitations.find((entry) => entry.id === call.body.p_invitation_id);
      if (invitation) invitation.revokedAt = new Date().toISOString();
      return { data: null };
    }
    return undefined;
  };
  return { handle, users, invitations };
}

test('invitation connectée simulée : requête, lecture après rechargement et révocation', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill(' Aïcha Test ');
  await invite.getByLabel('Adresse e-mail *').fill(' AICHA@EXAMPLE.INVALID ');
  await invite.getByLabel('Téléphone').fill(' 0701020304 ');
  await invite.getByLabel('Rôle').selectOption('gerant');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0);
  const sent = mock.calls.filter((call) => call.path === '/functions/v1/invite-user');
  expect(sent).toHaveLength(1);
  expect(sent[0].method).toBe('POST');
  expect(sent[0].body).toEqual({ fullName: 'Aïcha Test', email: 'aicha@example.invalid', phone: '0701020304', roleKey: 'manager', stationIds: [STATION] });
  expect(JSON.stringify(sent[0].body)).not.toMatch(/password|company_id|companyId/i);

  const invitations = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Expire le' }) });
  const row = invitations.getByRole('row').filter({ hasText: 'aicha@example.invalid' });
  await expect(row).toContainText('Gérant');
  await expect(row).toContainText('Station A');
  await expect(row).toContainText('En attente');
  await page.reload(); // la seule persistance est celle du faux serveur Playwright
  await expect(row).toContainText('En attente');
  await row.getByTitle('Révoquer').click();
  await expect(row).toContainText('Révoquée');
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation').map((call) => call.body)).toEqual([{ p_invitation_id: INVITATION }]);
  expect(mock.calls.filter((call) => call.path.startsWith('/rest/v1/') && !call.path.startsWith('/rest/v1/rpc/') && call.method !== 'GET')).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('invitation connectée simulée : un refus HTTP ne crée aucune invitation', async ({ page }) => {
  const backend = invitationBackend(true);
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Test Refus');
  await invite.getByLabel('Adresse e-mail *').fill('refuse@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByText(/Edge Function returned a non-2xx status code/i)).toBeVisible();
  await expect(invite).toBeVisible();
  await expect(page.getByText('Aucune invitation enregistrée.')).toBeVisible();
  await expect(page.getByText(/Invitation envoyée\. Le collaborateur/)).toHaveCount(0);
  expect(mock.calls.filter((call) => call.path === '/functions/v1/invite-user')).toHaveLength(1);
  expect(backend.users).toHaveLength(1);
  expect(backend.invitations).toHaveLength(0);
  expect(mock.calls.filter((call) => call.path.startsWith('/rest/v1/') && !call.path.startsWith('/rest/v1/rpc/') && call.method !== 'GET')).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
