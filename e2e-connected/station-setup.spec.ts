import { expect, test } from '@playwright/test';
import type { Wash } from '../src/types';
import {
  CATEGORY, COMPANY, EMAIL, OWNER, SERVICE, STATION,
  fakeStationSetup, installFakeSupabase, signInFake,
} from './fixtures/mock-supabase';

// Toutes les réponses ci-dessous sont synthétiques : aucune connexion réelle
// à Supabase, et aucune preuve de déploiement ou de droits en production.
const OTHER_STATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const OTHER_CATEGORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccb';
const OTHER_SERVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddb';
const ADDED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function context(multiple = false) {
  return {
    authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
    fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
    company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: '2026-01-01T00:00:00Z' },
    stations: [
      { id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null },
      ...(multiple ? [{ id: OTHER_STATION, name: 'Station B', city: 'Bouaké', activated: true, logoPath: null }] : []),
    ],
    permissions: ['washes.view', 'washes.create', 'payments.create', 'expenses.create', 'settings.manage', 'catalog.manage'],
  };
}
function stationB() {
  const snapshot = fakeStationSetup();
  snapshot.station.id = OTHER_STATION;
  snapshot.station.name = 'Station B';
  snapshot.categories[0] = { id: OTHER_CATEGORY, station_id: OTHER_STATION, name: 'Moto', active: true };
  snapshot.services[0] = { id: OTHER_SERVICE, station_id: OTHER_STATION, name: 'Lavage moto', description: '', active: true };
  snapshot.prices[0] = { station_id: OTHER_STATION, service_id: OTHER_SERVICE, vehicle_category_id: OTHER_CATEGORY, price_minor: 4500, currency_code: 'XOF' };
  return snapshot;
}

async function openServices(page: import('@playwright/test').Page) {
  await signInFake(page);
  await page.goto('/app/prestations');
  await expect(page.getByRole('heading', { name: 'Prestations', exact: true })).toBeVisible();
}

test('prix connecté : brouillon, envoi unique, relecture et rechargement', async ({ page }) => {
  test.setTimeout(60_000);
  const snapshot = fakeStationSetup();
  const fake = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_context')) return { data: context() };
    if (call.path.endsWith('/my_station_setup')) return { data: snapshot };
    if (call.path.endsWith('/save_station_price')) {
      expect(call.body).toMatchObject({ p_station_id: STATION, p_service_id: SERVICE, p_category_id: CATEGORY });
      snapshot.prices[0].price_minor = Number(call.body.p_price_minor);
      return { data: null };
    }
  });
  await openServices(page);
  const price = page.getByLabel('Prix Lavage extérieur pour Berline');
  await expect(price).toHaveValue('3000');
  await price.fill('5000');
  expect(fake.calls.filter((c) => c.path.endsWith('/save_station_price'))).toHaveLength(0);
  await price.press('Enter');
  await expect.poll(() => fake.calls.filter((c) => c.path.endsWith('/save_station_price')).length).toBe(1);
  await expect(page.getByText('Berline : 5 000 FCFA')).toBeVisible();
  await expect.poll(() => fake.calls.filter((c) => c.path.endsWith('/my_station_setup')).length).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.getByLabel('Prix Lavage extérieur pour Berline')).toHaveValue('5000');
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
});

test('refus ou relecture manquante : pas de succès local, relecture explicite', async ({ page }) => {
  test.setTimeout(60_000);
  const snapshot = fakeStationSetup();
  let writeMode: 'refuse' | 'read-fail' = 'refuse';
  let failRead = false;
  const fake = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_context')) return { data: context() };
    if (call.path.endsWith('/my_station_setup')) {
      if (failRead) { failRead = false; return { status: 500, data: { message: 'Lecture interrompue' } }; }
      return { data: snapshot };
    }
    if (call.path.endsWith('/save_station_price')) {
      if (writeMode === 'refuse') return { status: 403, data: { code: '42501', message: 'Modification refusée' } };
      snapshot.prices[0].price_minor = Number(call.body.p_price_minor);
      failRead = true;
      return { data: null };
    }
  });
  await openServices(page);
  let price = page.getByLabel('Prix Lavage extérieur pour Berline');
  await price.fill('6000'); await price.press('Enter');
  await expect(page.getByText(/Écriture non confirmée/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prestations', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Relire et vérifier la station' }).click();
  price = page.getByLabel('Prix Lavage extérieur pour Berline');
  await expect(price).toHaveValue('3000');
  expect(snapshot.prices[0].price_minor).toBe(3000);

  writeMode = 'read-fail';
  await price.fill('6500'); await price.press('Enter');
  await expect(page.getByText(/Réglages indisponibles/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prestations', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Relire et vérifier la station' }).click();
  await expect(page.getByLabel('Prix Lavage extérieur pour Berline')).toHaveValue('6500');
  expect(fake.calls.filter((c) => c.path.endsWith('/save_station_price'))).toHaveLength(2);
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
});

test('réponse de création perdue : aucune répétition automatique, puis relecture', async ({ page }) => {
  test.setTimeout(60_000);
  const snapshot = fakeStationSetup();
  const fake = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_context')) return { data: context() };
    if (call.path.endsWith('/my_station_setup')) return { data: snapshot };
    if (call.path.endsWith('/save_station_category')) {
      snapshot.categories.push({ id: ADDED, station_id: STATION, name: String(call.body.p_name), active: true });
      return { status: 503, data: { message: 'Réponse perdue après validation' } };
    }
  });
  await signInFake(page);
  await page.goto('/app/mise-en-route');
  await page.getByRole('button', { name: /Catégories de véhicules/ }).click();
  await page.getByPlaceholder('Nom d’une catégorie').fill('Camionnette');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText(/Écriture non confirmée/)).toBeVisible();
  expect(fake.calls.filter((c) => c.path.endsWith('/save_station_category'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Relire et vérifier la station' }).click();
  await page.getByRole('button', { name: /Catégories de véhicules/ }).click();
  await expect(page.getByText('Camionnette', { exact: true })).toBeVisible();
  expect(snapshot.categories.filter((c) => c.name === 'Camionnette')).toHaveLength(1);
  expect(fake.calls.filter((c) => c.path.endsWith('/save_station_category'))).toHaveLength(1);
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
});

test('double action pendant une création : une seule commande, aucun succès prématuré', async ({ page }) => {
  test.setTimeout(60_000);
  const snapshot = fakeStationSetup();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const fake = await installFakeSupabase(page, async (call) => {
    if (call.path.endsWith('/my_context')) return { data: context() };
    if (call.path.endsWith('/my_station_setup')) return { data: snapshot };
    if (call.path.endsWith('/save_station_service')) {
      await held;
      snapshot.services.push({ id: ADDED, station_id: STATION, name: String(call.body.p_name), description: String(call.body.p_description), active: true });
      return { data: ADDED };
    }
  });
  await openServices(page);
  await page.getByRole('button', { name: 'Nouvelle prestation' }).click();
  await page.getByLabel('Nom de la prestation *').fill('Lavage spécial');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).dblclick();
  await expect.poll(() => fake.calls.filter((c) => c.path.endsWith('/save_station_service')).length).toBe(1);
  await expect(page.getByText('Prestation ajoutée.')).toHaveCount(0);
  release();
  await expect(page.getByText('Prestation ajoutée.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lavage spécial' })).toBeVisible();
  expect(fake.calls.filter((c) => c.path.endsWith('/save_station_service'))).toHaveLength(1);
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
});

test('réponse tardive après changement de station : aucune écriture de A affichée sur B', async ({ page }) => {
  test.setTimeout(60_000);
  const a = fakeStationSetup();
  const b = stationB();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const fake = await installFakeSupabase(page, async (call) => {
    if (call.path.endsWith('/my_context')) return { data: context(true) };
    if (call.path.endsWith('/my_station_setup')) return { data: call.body.p_station_id === STATION ? a : b };
    if (call.path.endsWith('/save_station_price')) {
      expect(call.body.p_station_id).toBe(STATION);
      a.prices[0].price_minor = Number(call.body.p_price_minor);
      await held;
      return { data: null };
    }
  }, { stationIds: [OTHER_STATION] });
  await openServices(page);
  const priceA = page.getByLabel('Prix Lavage extérieur pour Berline');
  await priceA.fill('7200'); await priceA.press('Enter');
  await expect.poll(() => fake.calls.filter((c) => c.path.endsWith('/save_station_price')).length).toBe(1);
  await page.getByLabel('Station active').selectOption(OTHER_STATION);
  await expect(page.getByLabel('Prix Lavage moto pour Moto')).toHaveValue('4500');
  release();
  await expect(page.getByLabel('Prix Lavage moto pour Moto')).toHaveValue('4500');
  await expect(page.getByLabel('Prix Lavage extérieur pour Berline')).toHaveCount(0);
  expect(a.prices[0].price_minor).toBe(7200);
  expect(b.prices[0].price_minor).toBe(4500);
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
});

test('moyens acceptés relus : seuls les canaux configurés sont proposés aux opérations', async ({ page }) => {
  test.setTimeout(90_000);
  const snapshot = fakeStationSetup();
  const existing: Wash = {
    id: '22222222-aaaa-4222-8222-222222222222', stationId: STATION, number: 'L-0001',
    clientId: null, clientName: null, vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: '2222 AB 01',
    employeeId: OWNER, assignedUserIds: [OWNER], postId: null,
    items: [{ serviceId: SERVICE, serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
    discount: 0, total: 3000, paid: 0, status: 'assigned', createdAt: '2026-11-12T12:00:00Z',
    finishedAt: null, deliveredAt: null, cancelledReason: null, payments: [], history: [], qualityResult: null, qualityNotes: null,
  };
  const fake = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_context')) return { data: context() };
    if (call.path.endsWith('/my_station_setup')) return { data: snapshot };
    if (call.path.endsWith('/my_station_wash_board')) return { data: [existing] };
    if (call.path.endsWith('/record_wash_payment_by_key')) {
      expect(call.body).toMatchObject({ p_wash_id: existing.id, p_amount_minor: 1000, p_method_key: 'wave' });
      existing.paid += 1000;
      existing.payments.push({ id: ADDED, amount: 1000, method: 'wave', at: '2026-11-12T12:05:00Z', byUserId: OWNER,
        idempotencyKey: String(call.body.p_idempotency_key) });
      return { data: ADDED };
    }
    if (call.path.endsWith('/save_station_setup')) {
      const patch = call.body.p_patch as { paymentMethods: string[] };
      expect(patch.paymentMethods).toEqual(['wave']);
      snapshot.station.paymentMethods = [...patch.paymentMethods];
      return { data: null };
    }
  });
  await signInFake(page);
  await page.goto('/app/mise-en-route');
  await page.getByRole('button', { name: /Moyens de paiement/ }).click();
  for (const label of ['Espèces', 'Mobile Money', 'Orange Money', 'MTN MoMo', 'Carte bancaire', 'Virement bancaire']) {
    await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
  }
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Moyens de paiement enregistrés.')).toBeVisible();
  expect(snapshot.station.paymentMethods).toEqual(['wave']);

  await page.goto('/app/depenses');
  await page.getByRole('button', { name: 'Nouvelle dépense' }).click();
  const expense = page.getByRole('dialog', { name: 'Nouvelle dépense' });
  await expect(expense.getByLabel('Moyen de paiement *')).toHaveValue('wave');
  await expect(expense.getByLabel('Moyen de paiement *').locator('option')).toHaveCount(1);

  await page.goto('/app/lavages');
  await page.getByRole('button', { name: 'Nouvelle fiche' }).click();
  const wash = page.getByRole('dialog', { name: 'Nouvelle fiche de lavage' });
  await expect(wash.getByLabel('Moyen de paiement')).toHaveValue('wave');
  await expect(wash.getByLabel('Moyen de paiement').locator('option')).toHaveCount(1);
  await wash.getByRole('button', { name: 'Annuler', exact: true }).click();

  const row = page.getByRole('row').filter({ hasText: '2222 AB 01' });
  await row.getByRole('button', { name: 'Détails →' }).click();
  const detail = page.getByRole('dialog', { name: 'Fiche L-0001' });
  await expect(detail.getByLabel('Moyen de paiement')).toHaveValue('wave');
  await expect(detail.getByLabel('Moyen de paiement').locator('option')).toHaveCount(1);
  await detail.getByLabel('Montant à encaisser (FCFA)').fill('1000');
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expect(detail.getByText('Encaissé', { exact: true }).locator('..')).toContainText('1 000 FCFA');
  expect(fake.calls.filter((c) => c.path.endsWith('/record_wash_payment_by_key'))).toHaveLength(1);
  expect(fake.calls.filter((c) => c.path.endsWith('/save_station_setup'))).toHaveLength(1);
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
});
