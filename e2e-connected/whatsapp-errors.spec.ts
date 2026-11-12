import { expect as baseExpect, test } from '@playwright/test';
import { CATEGORY, COMPANY, EMAIL, OWNER, SERVICE, STATION, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

test.use({ reducedMotion: 'reduce' });
test.setTimeout(60_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const CUSTOMER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WASH = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const NOTIFICATION = '66666666-7777-4888-8999-000000000000';
const now = '2026-11-12T10:00:00.000Z';

function server(scenario: 'lost-response' | 'no-consent' | 'missing-journal' | 'unknown' | 'malformed-response' | 'missing-after-enqueue') {
  let pending = scenario === 'unknown';
  let requests = 0;
  return (call: Call) => {
    if (call.path === '/rest/v1/rpc/my_context') return { data: {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
      company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: now },
      stations: [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['washes.view', 'customers.manage', 'notifications.enqueue'],
    } };
    if (call.path === '/rest/v1/rpc/my_station_wash_board') return { data: [{
      id: WASH, stationId: STATION, number: 'L-ERREUR', clientId: CUSTOMER, clientName: 'Client test',
      vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: '', employeeId: OWNER,
      assignedUserIds: [OWNER], postId: null, items: [{ serviceId: SERVICE, serviceName: 'Lavage', unitPrice: 3000, qty: 1 }],
      discount: 0, total: 3000, paid: 0, status: 'ready', createdAt: now, finishedAt: now,
      deliveredAt: null, cancelledReason: null, payments: [], history: [], qualityResult: 'approved', qualityNotes: null,
    }] };
    if (call.path === '/rest/v1/rpc/my_wash_whatsapp_journal') {
      if (scenario === 'missing-journal') return { status: 404, data: { code: 'PGRST202', message: 'Could not find the function' } };
      if (scenario === 'missing-after-enqueue' && pending && requests === 1) return { data: [] };
      return { data: pending ? [{ id: NOTIFICATION, origin: 'manual', status: scenario === 'unknown' ? 'unknown' : 'pending',
        reason: scenario === 'unknown' ? 'network_uncertain' : null, providerMessageId: null, createdAt: now, updatedAt: now, events: [] }] : [] };
    }
    if (call.path === '/rest/v1/rpc/enqueue_wash_whatsapp') {
      requests++;
      if (scenario === 'no-consent') return { status: 400, data: { code: '23514', message: 'Accord WhatsApp explicite absent' } };
      pending = true; // Simule le commit puis une réponse perdue, sans réseau Meta.
      if (scenario === 'lost-response' && requests === 1) return { status: 503, data: { message: 'Réponse perdue après enregistrement simulé' } };
      if (scenario === 'malformed-response' && requests === 1) return { data: null };
      return { data: NOTIFICATION };
    }
    return undefined;
  };
}

async function openWash(page: import('@playwright/test').Page) {
  await signInFake(page);
  await page.goto('/app/lavages');
  await page.getByRole('row').filter({ hasText: 'L-ERREUR' }).getByRole('button', { name: 'Détails →' }).click();
  return page.getByRole('dialog', { name: 'Fiche L-ERREUR' }).getByRole('region', { name: 'Notifications WhatsApp' });
}

test('WhatsApp simulé : réponse perdue, même clé au nouvel essai', async ({ page }) => {
  const mock = await installFakeSupabase(page, server('lost-response'));
  const panel = await openWash(page);
  const button = panel.getByRole('button', { name: 'Demander l’envoi WhatsApp' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(panel).toContainText('Demande non confirmée');
  await expect(panel).toContainText('Actualisez le journal avant une nouvelle demande');
  await expect(panel).not.toContainText('En attente d’expédition');
  await button.click();
  await expect(panel.getByText('En attente d’expédition', { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  const calls = mock.calls.filter((call) => call.path.endsWith('/enqueue_wash_whatsapp'));
  expect(calls).toHaveLength(2);
  expect(calls[0].body.p_idempotency_key).toEqual(calls[1].body.p_idempotency_key);
  expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
});

for (const scenario of ['malformed-response', 'missing-after-enqueue'] as const) {
  test(`WhatsApp simulé : ${scenario}, pas de confirmation sans relecture cohérente`, async ({ page }) => {
    const mock = await installFakeSupabase(page, server(scenario));
    const panel = await openWash(page);
    const button = panel.getByRole('button', { name: 'Demander l’envoi WhatsApp' });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(panel).toContainText('Demande non confirmée');
    await expect(panel).not.toContainText('Demande enregistrée ou déjà existante');
    await expect(panel).not.toContainText('En attente d’expédition');
    await button.click();
    await expect(panel.getByText('En attente d’expédition', { exact: true })).toBeVisible();
    const calls = mock.calls.filter((call) => call.path.endsWith('/enqueue_wash_whatsapp'));
    expect(calls).toHaveLength(2);
    expect(calls[0].body.p_idempotency_key).toEqual(calls[1].body.p_idempotency_key);
    expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
  });
}

test('WhatsApp simulé : absence de consentement est un refus, pas un envoi', async ({ page }) => {
  const mock = await installFakeSupabase(page, server('no-consent'));
  const panel = await openWash(page);
  await panel.getByRole('button', { name: 'Demander l’envoi WhatsApp' }).click();
  await expect(panel).toContainText('Accord WhatsApp explicite absent');
  await expect(panel).toContainText('Demande non confirmée');
  await expect(panel).not.toContainText('En attente d’expédition');
  expect(mock.calls.filter((call) => call.path.endsWith('/enqueue_wash_whatsapp'))).toHaveLength(1);
  expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
});

test('WhatsApp simulé : migration absente interdit une demande', async ({ page }) => {
  const mock = await installFakeSupabase(page, server('missing-journal'));
  const panel = await openWash(page);
  await expect(panel).toContainText('Fonction WhatsApp indisponible');
  await expect(panel.getByRole('button', { name: 'Demander l’envoi WhatsApp' })).toBeDisabled();
  expect(mock.calls.filter((call) => call.path.endsWith('/enqueue_wash_whatsapp'))).toHaveLength(0);
  expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
});

test('WhatsApp simulé : le résultat incertain reste explicitement bloqué', async ({ page }) => {
  const mock = await installFakeSupabase(page, server('unknown'));
  const panel = await openWash(page);
  await expect(panel).toContainText('Résultat incertain — ne pas renvoyer');
  await expect(panel).toContainText('Réponse réseau incertaine : vérifier auprès de Meta.');
  await expect(panel.getByRole('button', { name: 'Demander l’envoi WhatsApp' })).toBeDisabled();
  expect(mock.calls.filter((call) => call.path.endsWith('/enqueue_wash_whatsapp'))).toHaveLength(0);
  expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
});
