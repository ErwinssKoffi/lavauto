import type { Page, Route } from '@playwright/test';

// Serveur entièrement fictif, conservé dans le processus Playwright et remis à
// zéro à chaque test. Le routage bloque toute autre origine que le preview.
export const FAKE_ORIGIN = 'https://logo-test.supabase.invalid';
export const COMPANY = '11111111-1111-4111-8111-111111111111';
export const STATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const CATEGORY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const SERVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const EMAIL = 'owner@test.invalid';

export function fakePlanRows() {
  const rights = (enabled: boolean) => ['stock', 'loyalty', 'fleets', 'consolidation', 'audit']
    .map((feature_key) => ({ feature_key, enabled }));
  return [
    { id: 'essai', name: 'Essai', price_monthly_minor: 0, currency_code: 'XOF', trial_days: 14, sort_order: 1, features: [],
      plan_limits: [{ key: 'stations', value_int: 1 }, { key: 'employees', value_int: 3 }, { key: 'washes_per_month', value_int: 100 }], plan_entitlements: rights(true) },
    { id: 'standard', name: 'Standard', price_monthly_minor: 15000, currency_code: 'XOF', trial_days: 0, sort_order: 2, features: [],
      plan_limits: [{ key: 'stations', value_int: 1 }, { key: 'employees', value_int: 10 }, { key: 'washes_per_month', value_int: 1000 }], plan_entitlements: rights(false) },
    { id: 'premium', name: 'Premium', price_monthly_minor: 35000, currency_code: 'XOF', trial_days: 0, sort_order: 3, features: [],
      plan_limits: [{ key: 'stations', value_int: 5 }, { key: 'employees', value_int: 50 }, { key: 'washes_per_month', value_int: 100000 }], plan_entitlements: rights(true) },
  ];
}

export function fakeSubscriptionAccess(companyId = COMPANY) {
  const now = Date.now();
  return {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', companyId, planId: 'essai', planName: 'Essai', status: 'trial',
    startedAt: new Date(now).toISOString(), trialEndsAt: new Date(now + 14 * 86400000).toISOString(),
    currentPeriodEnd: new Date(now + 30 * 86400000).toISOString().slice(0, 10),
    serverTime: new Date(now).toISOString(), pendingPlanId: null, canWrite: true, reason: null,
    features: { stock: true, loyalty: true, fleets: true, consolidation: true, audit: true },
  };
}

export function fakeExpiredTrialAccess(companyId = COMPANY) {
  const access = fakeSubscriptionAccess(companyId);
  return { ...access, trialEndsAt: new Date(Date.now() - 1000).toISOString(), canWrite: false, reason: 'trial_expired' };
}

export interface Call {
  path: string;
  method: string;
  body: Record<string, unknown>;
}
interface Reply { data: unknown; status?: number; headers?: Record<string, string> }
type Handler = (call: Call) => Reply | undefined | Promise<Reply | undefined>;

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  // Permet au client PostgREST de lire le Retry-After simulé en CORS réel.
  'access-control-expose-headers': 'retry-after',
};
async function json(route: Route, data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Promise<void> {
  await route.fulfill({ status, headers: { ...headers, ...extraHeaders }, contentType: 'application/json', body: JSON.stringify(data) });
}

export function fakeStationSetup(logoPath: string | null = null) {
  return {
    company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', createdAt: '2026-11-12T00:00:00Z', suspended: false },
    station: { id: STATION, companyId: COMPANY, name: 'Station A', address: '', city: 'Abidjan', phone: '',
      hours: [], logoPath, paymentMethods: ['especes', 'mobile_money', 'wave', 'orange_money', 'mtn_momo', 'carte', 'virement'],
      commissionRate: 0, monthlyTarget: 0, activated: true, activatedAt: null },
    categories: [{ id: CATEGORY, station_id: STATION, name: 'Berline', active: true }],
    services: [{ id: SERVICE, station_id: STATION, name: 'Lavage extérieur', description: '', active: true }],
    prices: [{ station_id: STATION, service_id: SERVICE, vehicle_category_id: CATEGORY, price_minor: 3000, currency_code: 'XOF' }],
  };
}

export function emptyFinanceBoard() {
  return {
    paymentMethods: [], cashSessions: [], cashMovements: [], cashClosures: [], expenses: [],
    reconciliations: [], commissionPeriods: [], commissionLines: [], commissionPayouts: [], paymentCancellations: [],
  };
}

export async function installFakeSupabase(page: Page, custom: Handler, options: { stationIds?: string[] } = {}) {
  const calls: Call[] = [];
  const blocked: string[] = [];
  const unexpected: Call[] = [];
  const now = new Date().toISOString();
  const user = { id: OWNER, aud: 'authenticated', role: 'authenticated', email: EMAIL,
    email_confirmed_at: now, app_metadata: {}, user_metadata: {}, created_at: now };
  const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: OWNER, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4174') return route.continue();
    // La vitrine importe une feuille de polices externe : la remplacer par une
    // feuille vide garde ces parcours hors réseau, sans dépendance visuelle.
    if (url.origin === 'https://fonts.googleapis.com' && url.pathname === '/css2') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    if (url.origin !== FAKE_ORIGIN) {
      blocked.push(url.origin + url.pathname);
      return route.abort();
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const call: Call = {
      path: url.pathname, method: request.method(),
      body: request.postData() ? request.postDataJSON() as Record<string, unknown> : {},
    };
    calls.push(call);
    // Les lectures de la nouvelle API doivent toujours porter la station active.
    if (call.path.startsWith('/rest/v1/rpc/my_station_') && ![STATION, ...(options.stationIds ?? [])].includes(String(call.body.p_station_id))) {
      return json(route, { code: '42501', message: 'Station inaccessible en test' }, 403);
    }
    const result = await custom(call);
    if (result) return json(route, result.data, result.status, result.headers);

    if (call.path === '/auth/v1/token') return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, refresh_token: 'refresh-test', user });
    if (call.path === '/auth/v1/user') return json(route, user);
    if (call.path === '/rest/v1/plans') return json(route, fakePlanRows());
    if (call.path === '/rest/v1/rpc/my_subscription_access') return json(route, fakeSubscriptionAccess());
    if (call.path === '/rest/v1/vehicle_categories') return json(route, [{ id: CATEGORY, station_id: STATION, name: 'Berline', active: true, sort_order: 1 }]);
    if (call.path === '/rest/v1/services') return json(route, [{ id: SERVICE, station_id: STATION, name: 'Lavage extérieur', description: '', active: true, sort_order: 1 }]);
    if (call.path === '/rest/v1/service_prices') return json(route, [{ station_id: STATION, service_id: SERVICE, vehicle_category_id: CATEGORY, price_minor: 3000, currency_code: 'XOF' }]);
    if (call.path === '/rest/v1/rpc/my_context') return json(route, {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
      company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: now },
      stations: [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['washes.view', 'washes.create', 'washes.assign', 'payments.create', 'cash.open', 'cash.close', 'employees.manage', 'employees.invite', 'employees.disable', 'employees.assign_stations'],
    });
    if (call.path === '/rest/v1/rpc/my_station_setup') return json(route, fakeStationSetup());
    if (call.path === '/rest/v1/rpc/my_company_users') return json(route, [{ id: OWNER, fullName: 'Propriétaire', email: EMAIL, roleKey: 'owner', active: true, stationIds: [STATION] }]);
    if (call.path === '/rest/v1/rpc/my_company_invitations') return json(route, []);
    if (['/rest/v1/rpc/my_wash_board', '/rest/v1/rpc/my_wash_posts', '/rest/v1/rpc/my_company_clients',
      '/rest/v1/rpc/my_station_wash_board', '/rest/v1/rpc/my_station_wash_posts', '/rest/v1/rpc/my_station_clients',
      '/rest/v1/rpc/my_wash_whatsapp_journal'].includes(call.path)) return json(route, []);
    if (call.path === '/rest/v1/rpc/my_station_assignable_users') return json(route, [{ id: OWNER, name: 'Propriétaire', roleKey: 'owner' }]);
    if (call.path === '/rest/v1/rpc/my_customer_whatsapp_consent') return json(route, { granted: false, phone: null, at: null, history: [] });
    if (call.path === '/rest/v1/rpc/accept_my_invitations') return json(route, null);
    if (['/rest/v1/rpc/my_finance_board', '/rest/v1/rpc/my_station_finance_board'].includes(call.path)) return json(route, emptyFinanceBoard());
    if (call.path === '/rest/v1/rpc/my_profitability' || call.path === '/rest/v1/rpc/my_station_profitability') return json(route, {
      stationId: STATION, periodStart: call.body.p_start, periodEnd: call.body.p_end,
      revenue: 0, collected: 0, receivables: 0, expenses: 0, purchases: 0, consumptions: 0,
      commissions: 0, fixedCosts: 0, partialBalance: 0, grossMargin: null, result: null,
      costsMissing: true, missing: [], definitions: {}, operatingExpenses: 0, certified: false,
      certifiedAt: null, attestation: null,
    });
    if (call.path === '/rest/v1/rpc/my_station_metrics') return json(route, {
      stationId: STATION, periodStart: call.body.p_start, periodEnd: call.body.p_end,
      financeAvailable: true, trend: [], byMethod: [], byDayMethod: [], topServices: [], byEmployee: [], bestClients: [],
    });
    if (['/rest/v1/rpc/my_stock_board', '/rest/v1/rpc/my_station_stock_board'].includes(call.path)) return json(route, {
      productCategories: [], suppliers: [], products: [], purchaseOrders: [], purchaseOrderItems: [],
      stockLevels: [], stockMovements: [], inventorySessions: [], inventoryItems: [], services: [],
      serviceConsumptions: [], receiptEvents: [], consumptionRuns: [], costCertifications: [], alerts: [], valuation: {}, rules: {},
    });
    if (['/rest/v1/rpc/my_crm_board', '/rest/v1/rpc/my_station_crm_board'].includes(call.path)) return json(route, {
      clients: [], vehicles: [], loyaltyPrograms: [], loyaltyCards: [], loyaltyTransactions: [], packagePlans: [],
      customerPackages: [], packageUsages: [], promotions: [], promotionUsages: [], fleets: [], fleetContracts: [],
      fleetVehicles: [], fleetReceivables: [], notificationOutbox: [], stats: {}, rules: {},
    });
    if (['/rest/v1/rpc/my_analytics_board', '/rest/v1/rpc/my_accessible_analytics_board'].includes(call.path)) return json(route, {
      periodStart: call.body.p_start, periodEnd: call.body.p_end, period: {}, compare: null,
      stations: [], rankings: [], trend: [], definitions: {}, stats: {}, rules: {},
    });
    if (call.path === '/rest/v1/rpc/my_subscription_usage') return json(route, {
      periodStart: call.body.p_period_start, usage: { stations: 1, employees: 1, washes: 0 },
      limits: { stations: 1, employees: 3, washesPerMonth: 100 }, rows: [], rules: {},
    });
    unexpected.push(call);
    return json(route, { message: 'Route absente du serveur simulé' }, 404);
  });
  return { calls, blocked, unexpected };
}

export async function signInFake(page: Page) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByLabel('Mot de passe', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: /Se connecter/ }).click();
  await page.waitForURL(/\/app\//);
}
