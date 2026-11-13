import { expect, test } from '@playwright/test';
import { COMPANY, EMAIL, OWNER, STATION, fakeStationSetup, fakeSubscriptionAccess, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

const INVITED_USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const INVITATION = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

type InvitationRow = {
  id: string; email: string; roleKey: string; stationIds: string[];
  expiresAt: string; acceptedAt: string | null; revokedAt: string | null; createdAt: string;
};

// La fonction et ses réponses sont simulées : ce test n'exécute pas l'Edge
// Function, ne crée pas de compte Auth et n'envoie aucun e-mail.
function invitationBackend(reject = false, failRefreshAfterRevoke = false) {
  const now = new Date().toISOString();
  const users = [{ id: OWNER, fullName: 'Propriétaire', email: EMAIL, phone: '', roleKey: 'owner', active: true, stationIds: [STATION] }];
  const invitations: InvitationRow[] = [];
  let revoked = false;
  let invited = false;
  let updated = false;
  let failRefreshAfterInvite = false;
  let failRefreshAfterUpdate = false;
  let loseNextInvite = false;
  let loseNextUpdate = false;
  let rejectNextUpdate = false;
  let loseNextRevoke = false;
  let rejectNextRevoke = false;
  const handle = (call: Call) => {
    if (call.path === '/auth/v1/logout') return { data: null };
    if (call.path === '/rest/v1/rpc/my_company_users') {
      const unavailable = (revoked && failRefreshAfterRevoke) || (invited && failRefreshAfterInvite)
        || (updated && failRefreshAfterUpdate);
      return unavailable ? { status: 503, data: { message: 'Relecture indisponible' } } : { data: users };
    }
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
      invited = true;
      if (loseNextInvite) {
        loseNextInvite = false; // le faux serveur a enregistré, mais sa réponse est perdue
        return { status: 503, data: { message: 'Réponse perdue après invitation simulée' } };
      }
      return { data: { ok: true, userId: INVITED_USER, invitationId: INVITATION } };
    }
    if (call.path === '/rest/v1/rpc/admin_update_user') {
      if (rejectNextUpdate) {
        rejectNextUpdate = false;
        return { status: 403, data: { code: '42501', message: 'Modification refusée' } };
      }
      const account = users.find((entry) => entry.id === call.body.p_user_id);
      if (account && typeof call.body.p_active === 'boolean') account.active = call.body.p_active;
      updated = true;
      if (loseNextUpdate) {
        loseNextUpdate = false;
        return { status: 503, data: { message: 'Réponse perdue après modification simulée' } };
      }
      return { data: null };
    }
    if (call.path === '/rest/v1/rpc/revoke_invitation') {
      if (rejectNextRevoke) {
        rejectNextRevoke = false;
        return { status: 403, data: { code: '42501', message: 'Permission retirée' } };
      }
      const invitation = invitations.find((entry) => entry.id === call.body.p_invitation_id);
      if (invitation) {
        invitation.revokedAt ??= new Date().toISOString();
        const account = users.find((entry) => entry.email === invitation.email);
        if (account) account.active = false;
        revoked = true;
      }
      if (loseNextRevoke) {
        loseNextRevoke = false; // le faux serveur a commité, mais la réponse est perdue
        return { status: 503, data: { message: 'Réponse perdue après enregistrement simulé' } };
      }
      return { data: null };
    }
    return undefined;
  };
  return {
    handle, users, invitations,
    restoreRefresh: () => { failRefreshAfterRevoke = false; failRefreshAfterInvite = false; failRefreshAfterUpdate = false; },
    breakInvitationRefresh: () => { failRefreshAfterInvite = true; },
    breakUpdateRefresh: () => { failRefreshAfterUpdate = true; },
    loseNextInvite: () => { loseNextInvite = true; },
    loseNextUpdate: () => { loseNextUpdate = true; },
    rejectNextUpdate: () => { rejectNextUpdate = true; },
    loseNextRevoke: () => { loseNextRevoke = true; },
    rejectNextRevoke: () => { rejectNextRevoke = true; },
  };
}

test('invitation connectée simulée : requête, lecture après rechargement et révocation', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await expect(page.getByPlaceholder('Barème station')).toHaveCount(0);
  await expect(page.getByText('Réglage individuel indisponible ici en mode connecté.').first()).toBeVisible();
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
  const confirm = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await expect(confirm).toContainText('désactive aussi son accès à l’application');
  await expect(confirm).toContainText('les sessions Supabase Auth ne sont pas supprimés');
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(0);
  await confirm.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect(confirm).toHaveCount(0, { timeout: 15_000 });
  await expect(row).toContainText('Révoquée');
  const employees = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Employé' }) });
  await expect(employees.getByRole('row').filter({ hasText: 'aicha@example.invalid' })).toContainText('Désactivé');
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(false);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation').map((call) => call.body)).toEqual([{ p_invitation_id: INVITATION }]);
  expect(mock.calls.filter((call) => call.path.startsWith('/rest/v1/') && !call.path.startsWith('/rest/v1/rpc/') && call.method !== 'GET')).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('révocation confirmée : une relecture indisponible ne devient pas un échec de mutation', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = invitationBackend(false, true);
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Relecture Test');
  await invite.getByLabel('Adresse e-mail *').fill('refresh@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('row').filter({ hasText: 'refresh@example.invalid' }).getByTitle('Révoquer').click();
  const confirm = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await confirm.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect(confirm).toHaveCount(0, { timeout: 20_000 });
  const warning = page.getByRole('alert').filter({ hasText: 'Révocation enregistrée, mais données non relues' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Les états affichés peuvent être périmés');
  await expect(page.getByText('Invitation révoquée et accès du compte désactivé.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  const employees = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Employé' }) });
  const account = employees.getByRole('row').filter({ hasText: 'refresh@example.invalid' });
  await expect(account).toContainText('Actif'); // ancienne lecture non présentée comme vérifiée
  await expect(account.getByTitle('Désactiver')).toBeDisabled();
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(false);
  expect(backend.invitations[0]?.revokedAt).not.toBeNull();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(1);
  await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
  await expect(page.getByText('Actualisation incomplète. Réessayez avant toute action.')).toBeVisible({ timeout: 20_000 });
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();

  // L'avertissement persiste en naviguant ; une vraie relecture le lève.
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.getByRole('link', { name: 'Employés' }).click();
  await expect(warning).toBeVisible();
  backend.restoreRefresh();
  await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
  await expect(warning).toHaveCount(0, { timeout: 20_000 });
  await expect(account).toContainText('Désactivé');
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('invitation confirmée : une relecture indisponible bloque un nouvel envoi', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  backend.breakInvitationRefresh();
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Invitation relecture');
  await invite.getByLabel('Adresse e-mail *').fill('invite-refresh@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  const warning = page.getByRole('alert').filter({ hasText: 'Invitation enregistrée, mais données non relues' });
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  expect(backend.users).toHaveLength(2);
  expect(backend.invitations).toHaveLength(1);
  expect(mock.calls.filter((call) => call.path === '/functions/v1/invite-user')).toHaveLength(1);
  backend.restoreRefresh();
  await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
  await expect(warning).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('row').filter({ hasText: 'invite-refresh@example.invalid' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  expect(mock.calls.filter((call) => call.path === '/functions/v1/invite-user')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('invitation : réponse perdue, avertissement pendant la navigation et limite au rechargement', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  backend.loseNextInvite();
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Invitation incertaine');
  await invite.getByLabel('Adresse e-mail *').fill('incertaine@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'Invitation ou réservation non confirmée' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('incertaine@example.invalid');
  await expect(warning).toContainText('disparaît au rechargement ou à la déconnexion');
  await expect(invite.getByRole('button', { name: 'Envoyer l’invitation' })).toBeDisabled();
  await expect(page.getByText('Invitation envoyée. Le collaborateur définira son mot de passe depuis le lien reçu.')).toHaveCount(0);
  expect(backend.invitations).toHaveLength(1);
  expect(backend.users).toHaveLength(2);
  await invite.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.getByRole('link', { name: 'Employés' }).click();
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  // Limite explicite : cette alerte de création est en mémoire seulement.
  // Une relecture après reload ne prouve pas l’état Auth / e-mail externe.
  await page.reload();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  expect(mock.calls.filter((call) => call.path === '/functions/v1/invite-user')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('compte modifié : une relecture indisponible ne fait pas croire à un échec', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Compte relecture');
  await invite.getByLabel('Adresse e-mail *').fill('compte-refresh@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  const employees = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Employé' }) });
  const account = employees.getByRole('row').filter({ hasText: 'compte-refresh@example.invalid' });
  backend.breakUpdateRefresh();
  await account.getByTitle('Désactiver').click();
  const warning = page.getByRole('alert').filter({ hasText: 'Compte mis à jour, mais données non relues' });
  await expect(warning).toBeVisible({ timeout: 15_000 });
  await expect(account).toContainText('Actif');
  await expect(account.getByTitle('Désactiver')).toBeDisabled();
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(false);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
  backend.restoreRefresh();
  await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
  await expect(warning).toHaveCount(0, { timeout: 15_000 });
  await expect(account).toContainText('Désactivé');
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('compte : réponse perdue, état possiblement périmé et actions bloquées pendant la navigation', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const userId = '44444444-aaaa-4444-8444-444444444444';
  backend.users.push({ id: userId, fullName: 'Compte incertain', email: 'modification@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] });
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  const row = page.getByRole('row').filter({ hasText: 'modification@example.invalid' });
  backend.loseNextUpdate();
  await row.getByTitle('Désactiver').click();
  const warning = page.getByRole('alert').filter({ hasText: 'Modification de compte non confirmée' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(userId);
  await expect(warning).toContainText('disparaît au rechargement ou à la déconnexion');
  await expect(row).toContainText('Actif'); // réponse perdue : cet état n'est pas fiable
  expect(backend.users.find((user) => user.id === userId)?.active).toBe(false);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  await expect(row.getByTitle('Désactiver')).toBeDisabled();
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.getByRole('link', { name: 'Employés' }).click();
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  // Limite explicite : une relecture après reload n'écarte pas une commande
  // encore en vol ; le rappel n'est ni durable ni un verrou inter-onglets.
  await page.reload();
  await expect(warning).toHaveCount(0);
  await expect(row).toContainText('Désactivé');
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('compte : un refus transactionnel confirmé ne bloque pas les actions suivantes', async ({ page }) => {
  const backend = invitationBackend();
  const userId = '55555555-aaaa-4555-8555-555555555555';
  backend.users.push({ id: userId, fullName: 'Compte refusé', email: 'refus-compte@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] });
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  const row = page.getByRole('row').filter({ hasText: 'refus-compte@example.invalid' });
  backend.rejectNextUpdate();
  await row.getByTitle('Désactiver').click();
  await expect(page.getByText('Modification refusée')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Modification de compte non confirmée' })).toHaveCount(0);
  await expect(row).toContainText('Actif');
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  await row.getByTitle('Désactiver').click();
  await expect(row).toContainText('Désactivé');
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(2);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('comptes : une seule modification envoyée pendant une RPC en cours', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const first = '66666666-aaaa-4666-8666-666666666666';
  const second = '77777777-aaaa-4777-8777-777777777777';
  backend.users.push(
    { id: first, fullName: 'Premier compte', email: 'premier-compte@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] },
    { id: second, fullName: 'Second compte', email: 'second-compte@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] },
  );
  let captured = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mock = await installFakeSupabase(page, async (call) => {
    if (call.path === '/rest/v1/rpc/admin_update_user' && !captured) { captured = true; await gate; }
    return backend.handle(call);
  });
  try {
    await signInFake(page);
    await page.goto('/app/employes');
    const firstRow = page.getByRole('row').filter({ hasText: 'premier-compte@example.invalid' });
    const secondRow = page.getByRole('row').filter({ hasText: 'second-compte@example.invalid' });
    await firstRow.getByTitle('Désactiver').click();
    await expect.poll(() => captured).toBe(true);
    await secondRow.getByTitle('Désactiver').click();
    await expect(page.getByText('Une modification de compte est déjà en cours.')).toBeVisible();
    expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
    release();
    await expect(firstRow).toContainText('Désactivé');
    await expect(secondRow).toContainText('Actif');
    expect(mock.unexpected).toEqual([]);
    expect(mock.blocked).toEqual([]);
  } finally { release(); }
});

test('comptes : une ancienne relecture ne remplace pas une modification plus récente', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const alpha = '11111111-aaaa-4111-8111-111111111111';
  const bravo = '22222222-bbbb-4222-8222-222222222222';
  backend.users.push(
    { id: alpha, fullName: 'Compte Alpha', email: 'alpha@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] },
    { id: bravo, fullName: 'Compte Bravo', email: 'bravo@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] },
  );
  let updates = 0;
  let captured = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mock = await installFakeSupabase(page, async (call) => {
    if (call.path === '/rest/v1/rpc/my_company_users' && updates === 1 && !captured) {
      captured = true;
      const staleSnapshot = backend.users.map((user) => ({ ...user, stationIds: [...user.stationIds] }));
      await gate;
      return { data: staleSnapshot };
    }
    const response = backend.handle(call);
    if (call.path === '/rest/v1/rpc/admin_update_user') updates += 1;
    return response;
  });
  try {
    await signInFake(page);
    await page.goto('/app/employes');
    const employees = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Employé' }) });
    const rowA = employees.getByRole('row').filter({ hasText: 'alpha@example.invalid' });
    const rowB = employees.getByRole('row').filter({ hasText: 'bravo@example.invalid' });
    await rowA.getByTitle('Désactiver').click();
    await expect.poll(() => captured).toBe(true);
    await rowB.getByTitle('Désactiver').click();
    await expect(rowB).toContainText('Désactivé');
    await expect(page.getByText('Compte mis à jour.', { exact: true })).toHaveCount(1);
    release();
    // La première relecture devenue périmée ne vaut pas confirmation, même si
    // les deux mutations serveur ont réussi : une relecture explicite la lève.
    const warning = page.getByRole('alert').filter({ hasText: 'Compte mis à jour, mais données non relues' });
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(rowA).toContainText('Désactivé');
    await expect(rowB).toContainText('Désactivé');
    await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
    await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
    await expect(warning).toHaveCount(0, { timeout: 15_000 });
    await expect(rowB).toContainText('Désactivé');
    expect(backend.users.filter((user) => user.id === alpha || user.id === bravo).every((user) => !user.active)).toBe(true);
    expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(2);
    expect(mock.unexpected).toEqual([]);
    expect(mock.blocked).toEqual([]);
  } finally { release(); }
});

test('comptes : une relecture de quota remplacée ne vaut pas confirmation', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const userId = '11111111-aaaa-4111-8111-111111111111';
  backend.users.push({ id: userId, fullName: 'Compte quota', email: 'quota@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] });
  let updated = false;
  let captured = false;
  let failNewReads = true;
  let failedReads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mock = await installFakeSupabase(page, async (call) => {
    if (call.path === '/rest/v1/rpc/my_context') return { data: {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
      company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: new Date().toISOString() },
      stations: [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['washes.view', 'subscription.manage', 'employees.manage', 'employees.invite', 'employees.disable', 'employees.assign_stations'],
    } };
    if (call.path === '/rest/v1/rpc/admin_update_user') {
      const result = backend.handle(call);
      updated = true;
      return result;
    }
    if (call.path === '/rest/v1/rpc/my_subscription_usage' && updated) {
      if (!captured) {
        captured = true;
        await gate;
        return { data: { periodStart: call.body.p_period_start, usage: { stations: 1, employees: 1, washes: 0 },
          limits: { stations: 1, employees: 3, washesPerMonth: 100 }, rows: [], rules: {} } };
      }
      if (failNewReads) { failedReads += 1; return { status: 503, data: { message: 'Quotas indisponibles' } }; }
    }
    return backend.handle(call);
  });
  try {
    await signInFake(page);
    await page.goto('/app/employes');
    await page.getByRole('row').filter({ hasText: 'quota@example.invalid' }).getByTitle('Désactiver').click();
    await expect.poll(() => captured).toBe(true);
    await page.getByRole('link', { name: 'Abonnement', exact: true }).click();
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    release();
    await page.getByRole('link', { name: 'Employés' }).click();
    const warning = page.getByRole('alert').filter({ hasText: 'Compte mis à jour, mais données non relues' });
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
    expect(backend.users.find((user) => user.id === userId)?.active).toBe(false);
    failNewReads = false;
    await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
    await expect(warning).toHaveCount(0, { timeout: 15_000 });
    expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
    expect(mock.unexpected).toEqual([]);
    expect(mock.blocked).toEqual([]);
  } finally { release(); }
});

test('gérant Standard : comptes relus sans prétendre avoir accès aux quotas', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const userId = '22222222-aaaa-4222-8222-222222222222';
  backend.users.push({ id: userId, fullName: 'Compte géré', email: 'gere@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] });
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/rest/v1/rpc/my_context') return { data: {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: 'Gérante', roleKey: 'manager', isPlatformAdmin: false, companyId: COMPANY,
      company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: new Date().toISOString() },
      stations: [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['washes.view', 'analytics.view', 'employees.manage', 'employees.invite', 'employees.disable', 'employees.assign_stations'],
    } };
    if (call.path === '/rest/v1/rpc/my_subscription_access') return { data: {
      ...fakeSubscriptionAccess(), planId: 'standard', planName: 'Standard', status: 'active',
      features: { stock: false, loyalty: false, fleets: false, consolidation: false, audit: false },
    } };
    return backend.handle(call);
  });
  await signInFake(page);
  await page.goto('/app/employes');
  const row = page.getByRole('row').filter({ hasText: 'gere@example.invalid' });
  await row.getByTitle('Désactiver').click();
  await expect(row).toContainText('Désactivé');
  await expect(page.getByText('Compte mis à jour.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'données non relues' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/my_subscription_usage')).toHaveLength(0);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('comptes : une lecture d’abonnement remplacée ne confirme pas la relecture', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const userId = '33333333-aaaa-4333-8333-333333333333';
  backend.users.push({ id: userId, fullName: 'Compte accès', email: 'acces@example.invalid', phone: '', roleKey: 'cashier', active: true, stationIds: [STATION] });
  let updated = false;
  let captured = false;
  let failNewReads = true;
  let failedReads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mock = await installFakeSupabase(page, async (call) => {
    if (call.path === '/rest/v1/rpc/admin_update_user') {
      const result = backend.handle(call);
      updated = true;
      return result;
    }
    if (call.path === '/rest/v1/rpc/my_subscription_access' && updated) {
      if (!captured) {
        captured = true;
        await gate;
        return { data: fakeSubscriptionAccess() };
      }
      if (failNewReads) { failedReads += 1; return { status: 503, data: { message: 'Abonnement indisponible' } }; }
    }
    return backend.handle(call);
  });
  try {
    await signInFake(page);
    await page.goto('/app/employes');
    const row = page.getByRole('row').filter({ hasText: 'acces@example.invalid' });
    await row.getByTitle('Désactiver').click();
    await expect.poll(() => captured).toBe(true);
    // Un focus déclenche une nouvelle lecture ; l'ancienne réponse réussie ne
    // doit pas écraser l'erreur de la requête plus récente.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    release();
    const warning = page.getByRole('alert').filter({ hasText: 'Compte mis à jour, mais données non relues' });
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Abonnement non confirmé.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
    expect(backend.users.find((user) => user.id === userId)?.active).toBe(false);
    failNewReads = false;
    await warning.getByRole('button', { name: 'Actualiser les comptes et invitations' }).click();
    await expect(warning).toHaveCount(0, { timeout: 15_000 });
    await expect(row).toContainText('Désactivé');
    expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/admin_update_user')).toHaveLength(1);
    expect(mock.unexpected).toEqual([]);
    expect(mock.blocked).toEqual([]);
  } finally { release(); }
});

test('révocation : réponse perdue, refus ultérieur puis reprise de la même invitation', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Réponse perdue');
  await invite.getByLabel('Adresse e-mail *').fill('perdue@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  const invitationRow = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Expire le' }) })
    .getByRole('row').filter({ hasText: 'perdue@example.invalid' });
  backend.loseNextRevoke();
  await invitationRow.getByTitle('Révoquer').click();
  const confirm = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await confirm.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect(confirm.getByText(/Révocation non confirmée : elle a peut-être été enregistrée/)).toBeVisible();
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(false);
  expect(backend.invitations[0]?.revokedAt).not.toBeNull();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(1);
  const storageKey = `washguard.pending-revocation.v1:${OWNER}:${COMPANY}`;
  const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? 'null'), storageKey);
  expect(saved).toEqual({ version: 1, userId: OWNER, companyId: COMPANY, invitationId: INVITATION, startedAt: expect.any(String) });
  expect(JSON.stringify(saved)).not.toMatch(/email|password|token/i);

  // Le faux serveur affiche déjà « Révoquée » après rechargement, mais un
  // instantané ne permet pas d'écarter une requête encore en vol ailleurs.
  await page.reload();
  const warning = page.getByRole('alert').filter({ hasText: 'Révocation non confirmée' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(INVITATION);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  await expect(invitationRow).toContainText('Révoquée');
  await warning.getByRole('button', { name: 'Reprendre la même révocation' }).click();
  backend.rejectNextRevoke(); // le refus de la seconde tentative n'annule pas la première
  await confirm.getByRole('button', { name: 'Vérifier / réessayer la même révocation' }).click();
  await expect(page.getByText('Permission retirée')).toBeVisible();
  await expect(confirm.getByText(/un refus ultérieur ne prouverait pas/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Annuler' }).click();
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.getByRole('link', { name: 'Employés' }).click();
  await expect(warning).toBeVisible();
  // Dans le même onglet, une nouvelle connexion du même compte retrouve aussi
  // le marqueur ; une autre identité ne doit pas en hériter.
  await page.getByRole('button', { name: 'Menu du compte' }).click();
  const logout = page.waitForResponse((response) => new URL(response.url()).pathname === '/auth/v1/logout');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await logout;
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('sb-') && key.endsWith('-auth-token')))).toBe(false);
  await signInFake(page);
  await page.goto('/app/employes');
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Reprendre la même révocation' }).click();
  await confirm.getByRole('button', { name: 'Vérifier / réessayer la même révocation' }).click();
  await expect(confirm).toHaveCount(0, { timeout: 20_000 });
  await expect(warning).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  await expect(invitationRow).toContainText('Révoquée');
  const calls = mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation');
  expect(calls.map((call) => call.body)).toEqual(Array(3).fill({ p_invitation_id: INVITATION }));
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('révocation en vol : le marqueur précède la réponse et survit au rechargement', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Réponse retenue');
  await invite.getByLabel('Adresse e-mail *').fill('en-vol@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  // Laisser le serveur fictif répondre mais retenir cette réponse dans la page,
  // pour recharger pendant que la commande attend toujours sa confirmation.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const result = await original(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/rpc/revoke_invitation')) {
        (window as unknown as { wgResponseHeld: boolean }).wgResponseHeld = true;
        await new Promise<void>(() => { /* libéré par la destruction du document */ });
      }
      return result;
    };
  });
  await page.getByRole('row').filter({ hasText: 'en-vol@example.invalid' }).getByTitle('Révoquer').click();
  const confirm = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await confirm.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { wgResponseHeld?: boolean }).wgResponseHeld))).toBe(true);
  await expect(confirm.getByRole('button', { name: 'Révocation en cours…' })).toBeDisabled();
  const storageKey = `washguard.pending-revocation.v1:${OWNER}:${COMPANY}`;
  const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? 'null'), storageKey);
  expect(saved.invitationId).toBe(INVITATION);
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(false);
  await page.reload();
  const warning = page.getByRole('alert').filter({ hasText: 'Révocation non confirmée' });
  await expect(warning).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  await warning.getByRole('button', { name: 'Reprendre la même révocation' }).click();
  await confirm.getByRole('button', { name: 'Vérifier / réessayer la même révocation' }).click();
  await expect(warning).toHaveCount(0, { timeout: 20_000 });
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation').map((call) => call.body))
    .toEqual([{ p_invitation_id: INVITATION }, { p_invitation_id: INVITATION }]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('révocation : refus initial confirmé, sans rappel résiduel', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Refus révocation');
  await invite.getByLabel('Adresse e-mail *').fill('refus-revoke@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  backend.rejectNextRevoke();
  await page.getByRole('row').filter({ hasText: 'refus-revoke@example.invalid' }).getByTitle('Révoquer').click();
  const confirm = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await confirm.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect(page.getByText('Permission retirée')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Révocation non confirmée' })).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `washguard.pending-revocation.v1:${OWNER}:${COMPANY}`)).toBeNull();
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(true);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('révocation : stockage indisponible, aucun envoi', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Stockage indisponible');
  await invite.getByLabel('Adresse e-mail *').fill('stockage-revoke@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('washguard.pending-revocation.v1:')) throw new DOMException('stockage indisponible', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('row').filter({ hasText: 'stockage-revoke@example.invalid' }).getByTitle('Révoquer').click();
  const confirm = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await confirm.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Stockage de session inaccessible : aucune révocation envoyée' })).toBeVisible();
  await expect(confirm).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(0);
  expect(backend.users.find((user) => user.id === INVITED_USER)?.active).toBe(true);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('révocation : marqueur illisible conservé au rechargement, actions bloquées', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  const storageKey = `washguard.pending-revocation.v1:${OWNER}:${COMPANY}`;
  await page.evaluate((key) => sessionStorage.setItem(key, '{tronqué'), storageKey);
  await page.goto('/app/employes');
  await expect(page.getByRole('alert').filter({ hasText: 'Tentative de révocation illisible' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBe('{tronqué');
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(0);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('un rappel d’un autre compte n’est ni affiché ni effacé', async ({ page }) => {
  const backend = invitationBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  const otherUser = '99999999-9999-4999-8999-999999999999';
  const otherKey = `washguard.pending-revocation.v1:${otherUser}:${COMPANY}`;
  const saved = JSON.stringify({ version: 1, userId: otherUser, companyId: COMPANY, invitationId: INVITATION, startedAt: '2026-11-12T12:00:00Z' });
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: otherKey, value: saved });
  await page.goto('/app/employes');
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Révocation non confirmée' })).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), otherKey)).toBe(saved);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('changement réel de compte et entreprise dans le même onglet : rappel isolé puis retrouvé', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = invitationBackend();
  const otherUser = '99999999-9999-4999-8999-999999999999';
  const otherCompany = '88888888-8888-4888-8888-888888888888';
  const otherStation = '77777777-7777-4777-8777-777777777777';
  const otherEmail = 'autre@test.invalid';
  let actor: 'first' | 'other' = 'first';
  const user = () => ({ id: actor === 'first' ? OWNER : otherUser, aud: 'authenticated', role: 'authenticated',
    email: actor === 'first' ? EMAIL : otherEmail, email_confirmed_at: new Date().toISOString(),
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
  const token = () => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({
    sub: user().id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')}.signature`;
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/auth/v1/token') {
      actor = call.body.email === otherEmail ? 'other' : 'first';
      return { data: { access_token: token(), token_type: 'bearer', expires_in: 3600, refresh_token: `refresh-${actor}`, user: user() } };
    }
    if (call.path === '/auth/v1/user') return { data: user() };
    if (actor === 'other') {
      if (call.path === '/rest/v1/rpc/my_context') return { data: {
        authenticated: true, profileReady: true, active: true, userId: otherUser, email: otherEmail,
        fullName: 'Autre propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: otherCompany,
        company: { id: otherCompany, name: 'Autre entreprise', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: new Date().toISOString() },
        stations: [{ id: otherStation, name: 'Autre station', city: 'Abidjan', activated: true, logoPath: null }],
        permissions: ['washes.view', 'employees.manage', 'employees.invite', 'employees.disable', 'employees.assign_stations'],
      } };
      if (call.path === '/rest/v1/rpc/my_subscription_access') return { data: fakeSubscriptionAccess(otherCompany) };
      if (call.path === '/rest/v1/rpc/my_company_users') return { data: [{ id: otherUser, fullName: 'Autre propriétaire', email: otherEmail, roleKey: 'owner', active: true, stationIds: [otherStation] }] };
      if (call.path === '/rest/v1/rpc/my_company_invitations') return { data: [] };
      if (call.path === '/rest/v1/rpc/my_station_setup') {
        const setup = fakeStationSetup();
        return { data: { ...setup, company: { ...setup.company, id: otherCompany, name: 'Autre entreprise' },
          station: { ...setup.station, id: otherStation, companyId: otherCompany, name: 'Autre station' }, categories: [], services: [], prices: [] } };
      }
    }
    return backend.handle(call);
  }, { stationIds: [otherStation] });
  const logout = async () => {
    await page.getByRole('button', { name: 'Menu du compte' }).click();
    const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/auth/v1/logout');
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await response;
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('sb-') && key.endsWith('-auth-token')))).toBe(false);
  };
  await signInFake(page);
  await page.goto('/app/employes');
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Compte isolé');
  await invite.getByLabel('Adresse e-mail *').fill('isole@example.invalid');
  await invite.getByLabel('Stations * (sélection multiple)').selectOption(STATION);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0, { timeout: 15_000 });
  backend.loseNextRevoke();
  await page.getByRole('row').filter({ hasText: 'isole@example.invalid' }).getByTitle('Révoquer').click();
  await page.getByRole('dialog', { name: 'Révoquer l’invitation' }).getByRole('button', { name: 'Révoquer et désactiver' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'Révocation non confirmée' });
  await expect(warning).toBeVisible();
  const firstKey = `washguard.pending-revocation.v1:${OWNER}:${COMPANY}`;
  const saved = await page.evaluate((key) => sessionStorage.getItem(key), firstKey);
  expect(saved).not.toBeNull();
  await logout();

  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(otherEmail);
  await page.getByLabel('Mot de passe', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: /Se connecter/ }).click();
  await page.waitForURL(/\/app\//);
  await page.goto('/app/employes');
  await expect(page.getByText(otherEmail, { exact: true }).first()).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeEnabled();
  await expect(page.getByText('isole@example.invalid', { exact: true })).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), firstKey)).toBe(saved);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `washguard.pending-revocation.v1:${otherUser}:${otherCompany}`)).toBeNull();
  await logout();

  await signInFake(page);
  await page.goto('/app/employes');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(INVITATION);
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), firstKey)).toBe(saved);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/revoke_invitation')).toHaveLength(1);
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
  await expect(page.getByText('Permission refusée')).toBeVisible();
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
