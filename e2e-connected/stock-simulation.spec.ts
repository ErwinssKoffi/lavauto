import { expect, test, type Route } from '@playwright/test';
import { fakePlanRows, fakeStationSetup, fakeSubscriptionAccess } from './fixtures/mock-supabase';

// Tous les appels sont interceptés : ce parcours n'écrit sur aucun projet Supabase.
const company = '11111111-1111-4111-8111-111111111111';
const station = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const email = 'owner@test.invalid';
const now = new Date().toISOString();
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: now, app_metadata: {}, user_metadata: {}, created_at: now };
const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

async function json(route: Route, data: unknown) {
  await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) });
}

function stockBoard(empty: boolean) {
  return {
    productCategories: [], suppliers: [], purchaseOrders: [], purchaseOrderItems: [],
    stockMovements: [], inventorySessions: [], inventoryItems: [], services: [],
    serviceConsumptions: [], receiptEvents: [], consumptionRuns: [], costCertifications: [],
    products: empty ? [] : [{
      id: productId, stationId: station, categoryId: null, sku: 'SH-1', name: 'Shampoing serveur',
      category: 'Consommables', unit: 'L', reorderLevel: 3, averageCostMinor: 100, active: true,
    }],
    stockLevels: empty ? [] : [{
      productId, stationId: station, name: 'Shampoing serveur', unit: 'L', reorderLevel: 3,
      qtyOnHand: 2, averageCostMinor: 100, valueMinor: 200,
    }],
    alerts: [], valuation: {}, rules: {},
  };
}

test('aucun ajustement simulé ni seuil local modifiable en mode connecté', async ({ page }) => {
  let empty = false;
  let stockReads = 0;
  const stockWrites: string[] = [];
  const mutations = new Set([
    'save_product', 'save_supplier', 'create_purchase_order', 'receive_purchase_lines',
    'start_inventory_session', 'record_inventory_count', 'close_inventory_session',
    'save_service_consumption', 'consume_products_for_wash',
  ]);
  await page.route('https://logo-test.supabase.invalid/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/auth/v1/token') return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, refresh_token: 'refresh-test', user });
    if (url.pathname === '/auth/v1/user') return json(route, user);
    if (url.pathname === '/rest/v1/plans') return json(route, fakePlanRows());
    if (url.pathname === '/rest/v1/rpc/my_subscription_access') return json(route, fakeSubscriptionAccess(company));
    if (url.pathname === '/rest/v1/rpc/my_context') return json(route, {
      authenticated: true, profileReady: true, active: true, userId, email, fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false,
      companyId: company, company: { id: company, name: 'Entreprise', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: now },
      stations: [{ id: station, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['settings.manage', 'washes.view', 'inventory.view', 'inventory.receive', 'inventory.adjust'],
    });
    if (url.pathname === '/rest/v1/rpc/my_station_setup') return json(route, fakeStationSetup());
    if (url.pathname === '/rest/v1/rpc/my_company_users') return json(route, [{ id: userId, fullName: 'Propriétaire', email, roleKey: 'owner', active: true, stationIds: [station] }]);
    if (url.pathname === '/rest/v1/rpc/my_company_invitations') return json(route, []);
    if (url.pathname === '/rest/v1/rpc/my_station_stock_board') {
      stockReads += 1;
      return json(route, stockBoard(empty));
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop() ?? '';
      if (mutations.has(name)) stockWrites.push(name);
      if (name.startsWith('my_wash_') || name === 'my_company_clients') return json(route, []);
      return json(route, {});
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(route, []);
    return json(route, {});
  });

  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: /Se connecter/ }).click();
  await page.waitForURL(/\/app\//);
  await page.goto('/app/parametres');

  const settings = page.locator('#stock');
  await expect(settings.getByText('Shampoing serveur')).toBeVisible();
  await expect(settings.getByText(/Seuils en lecture seule/)).toBeVisible();
  await expect(settings.locator('input[type="number"]')).toHaveCount(0);
  await expect(settings.locator('button[aria-label^="Simuler"]')).toHaveCount(0);
  const banner = page.getByRole('alert').filter({ hasText: 'Alerte stock critique' });
  await banner.getByRole('button', { name: /Voir les niveaux/ }).click();
  await expect(banner.getByText('Voir le seuil')).toBeVisible();
  await expect(banner.locator('button[aria-label^="Simuler"]')).toHaveCount(0);
  await banner.getByRole('link', { name: 'Gérer le stock' }).click();
  await expect(page.getByRole('heading', { name: 'Stocks & achats' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouveau produit' })).toBeEnabled();
  expect(stockWrites).toEqual([]);

  empty = true;
  const beforeReload = stockReads;
  await page.goto('/app/parametres');
  await page.reload();
  await expect.poll(() => stockReads).toBeGreaterThan(beforeReload);
  await expect(settings.getByText('Aucun produit configuré.')).toBeVisible();
  await expect(settings.getByText('Shampoing serveur')).toHaveCount(0);
  await expect(settings.getByText('Shampoing carrosserie moussant')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Alerte stock critique' })).toHaveCount(0);
  expect(stockWrites).toEqual([]);
});
