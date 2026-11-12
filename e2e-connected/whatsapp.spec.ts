import { expect as baseExpect, test } from '@playwright/test';
import type { WhatsappJournalEntry } from '../src/services/adapters/SupabaseWhatsappCommands';
import { CATEGORY, COMPANY, EMAIL, OWNER, SERVICE, STATION, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

// Évite que les animations du navigateur sous charge retardent les clics ;
// les assertions attendent réellement les réponses simulées, jamais un sleep.
test.use({ reducedMotion: 'reduce' });
test.setTimeout(60_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const CUSTOMER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WASH = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const AUTO = '11111111-2222-4333-8444-555555555555';
const MANUAL = '66666666-7777-4888-8999-000000000000';
const now = '2026-11-12T10:00:00.000Z';

// Faux backend intercepté : il ne teste pas le SQL, n'appelle pas Meta et ne
// crée aucune donnée distante. Le SQL et le worker sont testés séparément.
function backend() {
  let granted = false;
  let source = '';
  let state: 'none' | 'pending' | 'accepted' | 'delivered' = 'none';
  const handle = (call: Call) => {
    if (call.path === '/rest/v1/rpc/my_context') return { data: {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
      company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: now },
      stations: [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['washes.view', 'customers.view', 'customers.manage', 'crm.view', 'notifications.view', 'notifications.enqueue'],
    } };
    if (call.path === '/rest/v1/rpc/my_station_clients') return { data: [{
      id: CUSTOMER, stationId: STATION, name: 'Client Exemple', phone: '+2250700000000', plate: '', notes: '', createdAt: now,
    }] };
    if (call.path === '/rest/v1/rpc/my_station_crm_board') return { data: {
      clients: [{ id: CUSTOMER, stationId: STATION, name: 'Client Exemple', phone: '+2250700000000', email: '', plate: '', notes: '', createdAt: now, customerType: 'individual', preferredChannel: 'whatsapp', loyaltyOptIn: true, fleetId: null }],
      vehicles: [], loyaltyPrograms: [], loyaltyCards: [], loyaltyTransactions: [], packagePlans: [], customerPackages: [], packageUsages: [], promotions: [], promotionUsages: [], fleets: [], fleetContracts: [], fleetVehicles: [], fleetReceivables: [], notificationOutbox: [], stats: {}, rules: {},
    } };
    if (call.path === '/rest/v1/rpc/my_station_wash_board') return { data: [{
      id: WASH, stationId: STATION, number: 'L-2026', clientId: CUSTOMER, clientName: 'Client Exemple',
      vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: '1234 AB 01', employeeId: OWNER,
      assignedUserIds: [OWNER], postId: null, items: [{ serviceId: SERVICE, serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
      discount: 0, total: 3000, paid: 0, status: 'ready', createdAt: now, finishedAt: now,
      deliveredAt: null, cancelledReason: null, payments: [], history: [], qualityResult: 'approved', qualityNotes: null,
    }] };
    if (call.path === '/rest/v1/rpc/my_customer_whatsapp_consent') return { data: {
      granted, phone: granted ? '+2250700000000' : null, at: source ? now : null,
      history: source ? [{ kind: granted ? 'granted' : 'revoked', phone: '+2250700000000', source, at: now, actor: 'Propriétaire' }] : [],
    } };
    if (call.path === '/rest/v1/rpc/save_customer_whatsapp_consent') {
      granted = call.body.p_granted === true; source = String(call.body.p_source); return { data: AUTO };
    }
    if (call.path === '/rest/v1/rpc/my_wash_whatsapp_journal') {
      const entries: WhatsappJournalEntry[] = [{ id: AUTO, origin: 'automatic', status: 'blocked', reason: 'no_consent', providerMessageId: null, createdAt: now, updatedAt: now,
        events: [{ kind: 'blocked', reason: 'no_consent', at: now, providerAt: null }] }];
      if (state !== 'none') entries.unshift({ id: MANUAL, origin: 'manual', status: state, reason: null,
        providerMessageId: state === 'pending' ? null : 'wamid.simule', createdAt: now, updatedAt: now,
        events: [{ kind: state, reason: null, at: now, providerAt: state === 'delivered' ? now : null }] });
      return { data: entries };
    }
    if (call.path === '/rest/v1/rpc/enqueue_wash_whatsapp') {
      if (!granted) return { status: 400, data: { code: '23514', message: 'Accord WhatsApp explicite absent' } };
      state = 'pending'; return { data: MANUAL };
    }
    return undefined;
  };
  return { handle, advance: (next: 'accepted' | 'delivered') => { state = next; } };
}

test('WhatsApp simulé : consentement séparé, demande manuelle et statuts honnêtes', async ({ page }) => {
  const fake = backend(); const mock = await installFakeSupabase(page, fake.handle);
  await signInFake(page);
  await page.goto('/app/clients');
  await page.getByText('Client Exemple', { exact: true }).click();
  const client = page.getByRole('dialog', { name: 'Client Exemple' });
  const consent = client.getByRole('region', { name: 'Consentement WhatsApp' });
  await expect(consent.getByText('Aucun accord actif')).toBeVisible();
  await expect(consent).toContainText('distinct du canal préféré et de la fidélité');
  const grant = consent.getByRole('button', { name: 'Enregistrer l’accord WhatsApp' });
  await expect(grant).toBeDisabled();
  await consent.getByLabel('Origine / preuve de l’accord ou du retrait *').fill('Accord oral au comptoir le 12 novembre');
  await consent.getByRole('checkbox', { name: /Je confirme que le client/ }).check();
  await grant.click();
  await expect(consent.getByText('Accord enregistré', { exact: true })).toBeVisible();
  await expect(consent).toContainText('fiche déjà prête doit être demandée manuellement');

  await page.goto('/app/lavages');
  await page.getByRole('row').filter({ hasText: 'L-2026' }).getByRole('button', { name: 'Détails →' }).click();
  const detail = page.getByRole('dialog', { name: 'Fiche L-2026' });
  const panel = detail.getByRole('region', { name: 'Notifications WhatsApp' });
  await expect(panel).toContainText('Aucun accord WhatsApp explicite.');
  const send = panel.getByRole('button', { name: 'Demander l’envoi WhatsApp' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(panel.getByText('En attente d’expédition', { exact: true })).toBeVisible();
  await expect(panel).toContainText('livraison de cette demande n’est pas encore confirmée');
  await expect(send).toBeDisabled();
  fake.advance('accepted');
  await panel.getByRole('button', { name: 'Actualiser le journal' }).click();
  await expect(panel.getByText('Accepté par Meta, livraison non confirmée', { exact: true })).toBeVisible();
  fake.advance('delivered');
  await panel.getByRole('button', { name: 'Actualiser le journal' }).click();
  await expect(panel.getByText('Livré, confirmé par Meta', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();

  await page.goto('/app/clients');
  await page.getByText('Client Exemple', { exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Client Exemple' }).getByRole('region', { name: 'Consentement WhatsApp' });
  await again.getByLabel('Origine / preuve de l’accord ou du retrait *').fill('Retrait demandé par le client');
  await again.getByRole('button', { name: 'Retirer l’accord WhatsApp' }).click();
  await expect(again.getByText('Aucun accord actif')).toBeVisible();
  await expect(again).toContainText('demandes non encore en cours sont annulées');

  const calls = mock.calls.filter((call) => /whatsapp/.test(call.path));
  expect(calls.find((call) => call.path.endsWith('/save_customer_whatsapp_consent'))?.body).toEqual({
    p_customer_id: CUSTOMER, p_granted: true, p_source: 'Accord oral au comptoir le 12 novembre', p_expected_phone: '+2250700000000',
  });
  expect(calls.filter((call) => call.path.endsWith('/enqueue_wash_whatsapp'))).toHaveLength(1);
  expect(calls.find((call) => call.path.endsWith('/enqueue_wash_whatsapp'))?.body).toEqual({ p_wash_id: WASH, p_idempotency_key: expect.any(String) });
  expect(JSON.stringify(calls)).not.toMatch(/company_id|service_role|access_token/i);
  expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
});

test('WhatsApp simulé : consentement relu après réponse invalide ou changement concurrent', async ({ page }) => {
  const fake = backend();
  let saves = 0;
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/rest/v1/rpc/save_customer_whatsapp_consent') {
      saves++;
      if (saves === 1) {
        fake.handle(call); // Accord enregistré côté faux serveur, réponse invalide.
        return { data: null };
      }
      // Un autre accord est rétabli avant la relecture du retrait simulé.
      return { data: AUTO };
    }
    return fake.handle(call);
  });
  await signInFake(page);
  await page.goto('/app/clients');
  await page.getByText('Client Exemple', { exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Client Exemple' }).getByRole('region', { name: 'Consentement WhatsApp' });
  await expect(panel.getByText('Aucun accord actif')).toBeVisible();
  await panel.getByLabel('Origine / preuve de l’accord ou du retrait *').fill('Accord oral au comptoir');
  await panel.getByRole('checkbox', { name: /Je confirme que le client/ }).check();
  await panel.getByRole('button', { name: 'Enregistrer l’accord WhatsApp' }).click();
  await expect(panel).toContainText('Enregistrement non confirmé');
  await expect(panel.getByRole('button', { name: 'Enregistrer l’accord WhatsApp' })).toHaveCount(0);
  await expect(panel).not.toContainText('Accord WhatsApp enregistré.');
  await panel.getByRole('button', { name: 'Actualiser le consentement' }).click();
  await expect(panel.getByText('Accord enregistré', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Origine / preuve de l’accord ou du retrait *')).toHaveValue('');
  await panel.getByLabel('Origine / preuve de l’accord ou du retrait *').fill('Retrait demandé au comptoir');
  await panel.getByRole('button', { name: 'Retirer l’accord WhatsApp' }).click();
  await expect(panel).toContainText('L’état du consentement a changé depuis la demande');
  await expect(panel.getByText('Accord enregistré', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('Accord retiré ;');
  const calls = mock.calls.filter((call) => call.path.endsWith('/save_customer_whatsapp_consent'));
  expect(calls).toHaveLength(2);
  expect(calls[0].body.p_expected_phone).toBe('+2250700000000');
  expect(calls[1].body.p_expected_phone).toBeNull();
  expect(mock.unexpected).toEqual([]); expect(mock.blocked).toEqual([]);
});
