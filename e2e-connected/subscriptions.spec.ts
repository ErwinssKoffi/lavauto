import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { CATEGORY, COMPANY, EMAIL, OWNER, SERVICE, STATION, fakeStationSetup, fakeSubscriptionAccess, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

// Toutes les requêtes sont interceptées dans le navigateur. Ces parcours ne
// créent pas de compte, ne déclenchent aucun e-mail et ne touchent pas à Supabase.
const REQUEST = '99999999-9999-4999-8999-999999999999';

test('choix Premium depuis la vitrine transmis à l’inscription sans activation ni paiement', async ({ page }) => {
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/auth/v1/signup') return { data: { id: OWNER, email: 'signup@test.invalid', user_metadata: {} } };
    return undefined;
  });
  await page.goto('/');
  await expect(page.locator('#tarifs')).toContainText('une validation anticipée met fin à l’essai immédiatement');
  await page.getByRole('link', { name: 'Choisir Premium' }).click();
  await expect(page).toHaveURL(/\/inscription\?plan=premium/);
  await expect(page.locator('input[name="plan"][value="premium"]')).toBeChecked();
  await expect(page.getByText(/sont des demandes, activées seulement après validation/)).toBeVisible();
  await expect(page.getByText(/validation payante anticipée met fin immédiatement à l’essai/)).toBeVisible();
  await page.locator('#companyName').fill('Entreprise Test');
  await page.locator('#stationName').fill('Station Test');
  await page.locator('#phone').fill('+2250700000000');
  await page.locator('#city').fill('Abidjan');
  await page.locator('#ownerName').fill('Propriétaire Test');
  await page.locator('#email').fill('signup@test.invalid');
  await page.locator('#password').fill('motdepasse123');
  await page.locator('#confirm').fill('motdepasse123');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.getByText(/Après connexion, ouvrez Abonnement pour vérifier/)).toBeVisible();
  const signup = mock.calls.find((call) => call.path === '/auth/v1/signup');
  expect(signup?.body.data).toMatchObject({ requested_plan_id: 'premium', company_name: 'Entreprise Test', invitation: false });
  expect(mock.calls.some((call) => /payment|checkout|admin_decide_subscription/.test(call.path))).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

function subscriptionBackend() {
  let actor: 'owner' | 'admin' = 'owner';
  let access: Omit<ReturnType<typeof fakeSubscriptionAccess>, 'reason'> & { reason: string | null } = fakeSubscriptionAccess();
  let pending: string | null = null;
  let decisions = 0;
  const context = () => {
    const admin = actor === 'admin';
    return {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: admin ? 'Administrateur' : 'Propriétaire', roleKey: admin ? 'super_admin' : 'owner',
      isPlatformAdmin: admin, companyId: admin ? null : COMPANY,
      company: admin ? null : { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: new Date().toISOString() },
      stations: admin ? [] : [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: admin ? ['platform.view', 'platform.companies.manage', 'platform.plans.manage', 'platform.quotas.manage']
        : ['subscription.manage', 'washes.view', 'washes.create', 'washes.assign', 'washes.update_status', 'washes.quality',
          'payments.create', 'payments.cancel', 'customers.view', 'customers.manage',
          'settings.manage', 'catalog.manage', 'cash.open', 'cash.close', 'expenses.create', 'expenses.cancel',
          'employees.manage', 'employees.invite', 'employees.disable', 'users.reset_password', 'commissions.view', 'commissions.validate',
          'reports.view', 'inventory.view', 'inventory.consume', 'loyalty.view', 'crm.view', 'fleets.view', 'analytics.view'],
    };
  };
  const handle = (call: Call) => {
    if (call.path === '/rest/v1/rpc/my_context') return { data: context() };
    if (call.path === '/rest/v1/rpc/my_subscription_access') return { data: { ...access, pendingPlanId: pending, serverTime: new Date().toISOString() } };
    if (call.path === '/rest/v1/rpc/request_subscription_plan') {
      pending = String(call.body.p_plan);
      return { data: REQUEST };
    }
    if (call.path === '/rest/v1/rpc/admin_subscription_requests') return { data: pending ? [{
      id: REQUEST, companyId: COMPANY, companyName: 'Entreprise test', fromPlanId: access.planId,
      toPlanId: pending, toPlanName: pending === 'premium' ? 'Premium' : 'Standard', requestedAt: new Date().toISOString(),
    }] : [] };
    if (call.path === '/rest/v1/rpc/admin_decide_subscription_request') {
      if (call.body.p_approve && pending) {
        const premium = pending === 'premium';
        access = { ...access, planId: pending, planName: premium ? 'Premium' : 'Standard', status: 'active',
          currentPeriodEnd: new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10),
          canWrite: true, reason: null, features: { stock: premium, loyalty: premium, fleets: premium, consolidation: premium, audit: premium } };
      }
      decisions += 1;
      pending = null;
      return { data: null };
    }
    if (call.path === '/rest/v1/rpc/my_platform_board') return { data: {
      companies: [], plans: [], planLimits: [], subscriptionUsage: [], auditLogs: [], stats: {}, rules: {},
    } };
    if (call.path === '/rest/v1/rpc/my_station_profitability' && !access.features.stock) return { data: {
      stationId: STATION, periodStart: call.body.p_start, periodEnd: call.body.p_end,
      revenue: 12000, collected: 9000, receivables: 3000, expenses: 4000, commissions: 500, partialBalance: 5000,
      purchases: null, consumptions: null, operatingExpenses: null, fixedCosts: null, grossMargin: null, result: null,
      costsMissing: true, certified: false, certifiedAt: null, attestation: null,
      label: 'Coûts de stock et certification non disponibles dans cette formule', missing: ['Module stock non inclus'], definitions: {},
    } };
    return undefined;
  };
  return {
    handle,
    asAdmin: () => { actor = 'admin'; },
    asOwner: () => { actor = 'owner'; },
    expirePaid: () => { access = { ...access, status: 'active', planId: 'standard', planName: 'Standard',
      currentPeriodEnd: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      canWrite: false, reason: 'period_expired',
      features: { stock: false, loyalty: false, fleets: false, consolidation: false, audit: false } }; },
    expirePremium: () => { access = { ...access, status: 'active', planId: 'premium', planName: 'Premium',
      currentPeriodEnd: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      canWrite: false, reason: 'period_expired',
      features: { stock: true, loyalty: true, fleets: true, consolidation: true, audit: true } }; },
    getAccess: () => access,
    getPending: () => pending,
    getDecisions: () => decisions,
  };
}

test('quotas : une relecture en échec ne présente pas un ancien relevé comme actuel', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = subscriptionBackend();
  let failUsage = false;
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/rest/v1/rpc/my_subscription_usage' && failUsage) {
      return { status: 503, data: { message: 'Relevé indisponible' } };
    }
    return backend.handle(call);
  });
  await signInFake(page);
  await page.goto('/app/abonnement');
  await expect(page.getByText('Comptes actifs et invitations réservées (propriétaire inclus)')).toBeVisible();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
  failUsage = true;
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.getByRole('link', { name: 'Abonnement', exact: true }).click();
  await expect(page.getByText('Compteurs et limites indisponibles pour le moment.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1 / 3', { exact: true })).toHaveCount(0);
  failUsage = false;
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.getByRole('link', { name: 'Abonnement', exact: true }).click();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('demande, confirmation administrateur et droits Standard puis Premium', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = subscriptionBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/abonnement');
  await expect(page.getByText('Essai en cours').first()).toBeVisible();
  await page.getByRole('button', { name: 'Demander Standard' }).click();
  await expect(page.getByText(/Demande en attente de validation/)).toBeVisible();
  expect(backend.getAccess().planId).toBe('essai');
  expect(backend.getPending()).toBe('standard');
  await page.reload();
  await expect(page.getByText(/Demande en attente de validation/)).toBeVisible();

  backend.asAdmin();
  await page.goto('/app/plateforme');
  await expect(page.getByText('Entreprise test · Standard')).toBeVisible();
  await page.getByRole('button', { name: 'Valider la formule' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Valider cette formule ?' });
  await expect(confirmation).toContainText('mettra fin à un éventuel essai en cours');
  await expect(confirmation).toContainText('Aucun paiement n’est enregistré');
  await confirmation.getByRole('button', { name: 'Annuler' }).click();
  expect(backend.getDecisions()).toBe(0);
  await page.getByRole('button', { name: 'Valider la formule' }).click();
  await confirmation.getByRole('button', { name: 'Confirmer la validation' }).click();
  await expect(page.getByText('Aucune demande en attente.')).toBeVisible();
  expect(backend.getDecisions()).toBe(1);
  expect(backend.getAccess().planId).toBe('standard');

  backend.asOwner();
  await page.goto('/app/abonnement');
  await expect(page.getByRole('heading', { name: 'Standard', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Formule active').first()).toBeVisible();
  await expect(page.getByText(/Si elle intervient avant les 14 jours, l’essai prend fin immédiatement/)).toBeVisible();
  await page.goto('/app/stock');
  await expect(page.getByText('Module non inclus dans la formule active')).toBeVisible();
  await page.goto('/app/abonnement');
  await page.getByRole('button', { name: 'Demander Premium' }).click();
  await expect(page.getByText(/Demande en attente de validation/)).toBeVisible();
  expect(backend.getAccess().planId).toBe('standard');

  backend.asAdmin();
  await page.goto('/app/plateforme');
  await expect(page.getByText('Entreprise test · Premium')).toBeVisible();
  await page.getByRole('button', { name: 'Valider la formule' }).click();
  await page.getByRole('dialog', { name: 'Valider cette formule ?' }).getByRole('button', { name: 'Confirmer la validation' }).click();
  await expect(page.getByText('Aucune demande en attente.')).toBeVisible();
  backend.asOwner();
  await page.goto('/app/stock');
  await expect(page.getByRole('heading', { name: 'Stocks & achats' })).toBeVisible();
  expect(backend.getAccess().planId).toBe('premium');
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('plateforme : échéance et quotas indisponibles ne sont pas présentés comme actifs ou illimités', async ({ page }) => {
  const backend = subscriptionBackend();
  backend.expirePaid();
  backend.asAdmin();
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/rest/v1/rpc/my_platform_board') return { data: {
      companies: [{ companyId: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', suspended: false,
        status: 'lecture seule', planId: 'standard', planName: 'Standard', subscriptionStatus: 'active',
        subscriptionStartedAt: '2026-01-01', subscriptionReason: 'period_expired',
        stationCount: 1, employeeCount: 3, washesMonth: 2, monthlyRevenue: 2000,
        companyCreatedAt: '2026-01-01', limits: { stations: 1, employees: null, washesPerMonth: 1000 },
        quota: { stationsUsed: 1, employeesUsed: 3, washesMonthUsed: 2, quotaExceeded: false } }],
      plans: [], planLimits: [], subscriptionUsage: [], auditLogs: [], stats: {}, rules: {},
    } };
    return backend.handle(call);
  });
  await signInFake(page);
  await page.goto('/app/plateforme');
  const company = page.getByRole('row').filter({ hasText: 'Entreprise test' });
  await expect(company).toContainText('Période expirée · lecture seule');
  await expect(company).toContainText('3 / indisponible');
  await expect(company).toContainText('Limite indisponible');
  await expect(company).not.toContainText('∞');
  await expect(page.getByText(/comptes utilisés comprennent le propriétaire/)).toBeVisible();
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('expiration payante : lecture conservée, nouvelle fiche bloquée et renouvellement demandé', async ({ page }) => {
  const backend = subscriptionBackend();
  backend.expirePaid();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/lavages');
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lavages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouvelle fiche' })).toBeDisabled();
  await page.goto('/app/abonnement');
  await expect(page.getByText('Période expirée · lecture seule').first()).toBeVisible();
  await page.getByRole('button', { name: 'Renouveler Standard' }).click();
  await expect(page.getByText(/Demande en attente de validation/)).toBeVisible();
  expect(backend.getAccess().canWrite).toBe(false);
  expect(backend.getPending()).toBe('standard');
  expect(mock.calls.some((call) => call.path === '/rest/v1/rpc/create_wash_atomic')).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('rapport Standard : coûts indisponibles dans la page et dans l’export, sans faux zéros', async ({ page }) => {
  const backend = subscriptionBackend();
  backend.expirePaid();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/rapports');
  await expect(page.getByRole('heading', { name: 'Rapports' })).toBeVisible();
  await expect(page.getByText('Les coûts de stock et le résultat certifié sont indisponibles', { exact: false })).toBeVisible();
  for (const label of ['Achats valorisés', 'Consommations valorisées', 'Charges d’exploitation', 'Charges fixes']) {
    await expect(page.getByRole('row').filter({ hasText: label })).toContainText('Non disponible');
  }
  await expect(page.getByRole('row').filter({ hasText: 'Dépenses constatées' })).toContainText('4 000 FCFA');
  await expect(page.getByRole('button', { name: 'Certification entreprise' })).toBeDisabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter en CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toMatch(/Achats valorisés;[^\r\n]*;Non disponible/);
  expect(csv).toMatch(/Consommations valorisées;[^\r\n]*;Non disponible/);
  expect(csv).toMatch(/Dépenses constatées;[^\r\n]*;4000/);
  expect(mock.calls.some((call) => call.path === '/rest/v1/rpc/certify_profitability_period')).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('Premium expiré : les écrans restent lisibles mais les commandes sont désactivées', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = subscriptionBackend();
  backend.expirePremium();
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/rest/v1/rpc/my_station_crm_board') return { data: {
      clients: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', stationId: STATION, name: 'Cliente conservée',
        phone: '', email: '', plate: '', notes: 'Donnée préservée', createdAt: new Date().toISOString() }],
      vehicles: [], loyaltyPrograms: [], loyaltyCards: [], loyaltyTransactions: [], packagePlans: [],
      customerPackages: [], packageUsages: [], promotions: [], promotionUsages: [], fleets: [], fleetContracts: [],
      fleetVehicles: [], fleetReceivables: [], notificationOutbox: [], stats: {}, rules: {},
    } };
    return backend.handle(call);
  });
  await signInFake(page);

  await page.goto('/app/clients');
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouveau client' })).toBeDisabled();
  await page.getByText('Cliente conservée', { exact: true }).click();
  const client = page.getByRole('dialog', { name: 'Cliente conservée' });
  await expect(client.getByLabel('Nom', { exact: true })).toHaveValue('Cliente conservée');
  await expect(client.getByLabel('Nom', { exact: true })).toBeDisabled();
  await expect(client.getByRole('button', { name: 'Enregistrer la fiche' })).toBeDisabled();
  const consent = client.getByRole('region', { name: 'Consentement WhatsApp' });
  await expect(consent.getByText(/Après expiration, vous pouvez demander le retrait/)).toBeVisible();
  await expect(consent.getByLabel('Origine / preuve de l’accord ou du retrait *')).toBeDisabled();
  await expect(consent.getByRole('button', { name: 'Enregistrer l’accord WhatsApp' })).toBeDisabled();

  await page.goto('/app/caisse');
  await expect(page.getByRole('button', { name: 'Ouvrir la caisse' }).first()).toBeDisabled();
  await page.goto('/app/depenses');
  await expect(page.getByRole('button', { name: 'Nouvelle dépense' })).toBeDisabled();
  await page.goto('/app/employes');
  await expect(page.getByRole('button', { name: 'Inviter un employé' })).toBeDisabled();
  await page.goto('/app/prestations');
  await expect(page.getByRole('button', { name: 'Nouvelle prestation' })).toBeDisabled();
  await expect(page.getByLabel('Prix Lavage extérieur pour Berline')).toBeDisabled();
  await page.goto('/app/commissions');
  await expect(page.getByRole('button', { name: 'Créer un brouillon' })).toBeDisabled();
  await page.goto('/app/parametres');
  await expect(page.getByLabel('Nom', { exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enregistrer les horaires' })).toBeDisabled();
  await page.goto('/app/mise-en-route');
  await page.getByRole('button', { name: /Identité de l’entreprise/ }).click();
  await expect(page.getByLabel('Nom de l’entreprise *')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();

  await page.goto('/app/stock');
  await expect(page.getByRole('heading', { name: 'Stocks & achats' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouveau produit' })).toBeDisabled();
  await page.goto('/app/fidelisation');
  await expect(page.getByRole('button', { name: 'Créer le programme' })).toBeDisabled();
  await page.goto('/app/flottes');
  await expect(page.getByRole('button', { name: 'Créer la flotte' })).toBeDisabled();
  const writes = new Set(['save_customer_profile', 'save_customer_vehicle', 'open_cash_session', 'record_expense_by_key',
    'save_product', 'save_station_setup', 'certify_profitability_period', 'create_loyalty_program', 'save_fleet']);
  expect(mock.calls.filter((call) => writes.has(call.path.split('/').pop() ?? ''))).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('expiration pendant la saisie d’un client : brouillon conservé, aucune création', async ({ page }) => {
  const backend = subscriptionBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/clients');
  await page.getByRole('button', { name: 'Nouveau client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau client' });
  await dialog.getByLabel('Nom *').fill('Brouillon conservé');
  await expect(dialog.getByRole('button', { name: 'Créer la fiche' })).toBeEnabled();
  backend.expirePremium();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(dialog.getByLabel('Nom *')).toHaveValue('Brouillon conservé');
  await expect(dialog.getByLabel('Nom *')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Créer la fiche' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  expect(mock.calls.some((call) => call.path.endsWith('/save_customer_profile'))).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('expiration pendant l’annulation d’un lavage : paiement et confirmation bloqués, lecture disponible', async ({ page }) => {
  const backend = subscriptionBackend();
  const washId = '22222222-2222-4222-8222-222222222222';
  const now = new Date().toISOString();
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_station_wash_board')) return { data: [{
      id: washId, stationId: STATION, number: 'L-EXP', clientId: null, clientName: null,
      vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: '4567 AB 01', employeeId: OWNER,
      assignedUserIds: [OWNER], postId: null, items: [{ serviceId: SERVICE, serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
      discount: 0, total: 3000, paid: 0, status: 'assigned', createdAt: now, finishedAt: null,
      deliveredAt: null, cancelledReason: null, payments: [], history: [], qualityResult: null, qualityNotes: null,
    }] };
    return backend.handle(call);
  });
  await signInFake(page);
  await page.goto('/app/lavages');
  await page.getByRole('row').filter({ hasText: 'L-EXP' }).getByRole('button', { name: 'Détails →' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche L-EXP' });
  await expect(dialog.getByRole('button', { name: 'Encaisser', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await dialog.getByLabel('Motif de l’annulation *').fill('Motif conservé');
  await expect(dialog.getByRole('button', { name: 'Confirmer l’annulation' })).toBeEnabled();
  backend.expirePremium();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(dialog.getByLabel('Motif de l’annulation *')).toHaveValue('Motif conservé');
  await expect(dialog.getByLabel('Motif de l’annulation *')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Confirmer l’annulation' })).toBeDisabled();
  await expect(dialog.getByLabel('Montant à encaisser (FCFA)')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Encaisser', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Reçu client' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: /Historique du véhicule/ })).toBeEnabled();
  expect(mock.calls.filter((call) => /\/(record_wash_payment_by_key|transition_wash_status|cancel_wash_payment)$/.test(call.path))).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('logo en lecture seule : modifier est bloqué, relire l’aperçu reste possible', async ({ page }) => {
  const backend = subscriptionBackend();
  backend.expirePremium();
  const path = `${COMPANY}/logo-existant.png`;
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_station_setup')) return { data: fakeStationSetup(path) };
    if (call.path.startsWith('/storage/v1/object/sign/station-assets/')) return { status: 503, data: { message: 'Signature momentanément indisponible' } };
    return backend.handle(call);
  });
  await signInFake(page);
  await page.goto('/app/mise-en-route');
  await page.getByRole('button', { name: /Logo de la station/ }).click();
  const editor = page.getByRole('region', { name: 'Logo de la station' });
  await expect(editor.getByLabel('Choisir un fichier logo')).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Enregistrer le logo' })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Retirer le logo' })).toBeDisabled();
  const retry = editor.getByRole('button', { name: 'Réessayer l’aperçu' });
  await expect(retry).toBeEnabled();
  const signatures = () => mock.calls.filter((call) => call.path.startsWith('/storage/v1/object/sign/station-assets/')).length;
  const before = signatures();
  await retry.click();
  await expect.poll(signatures).toBeGreaterThan(before);
  expect(mock.calls.some((call) => call.path.endsWith('/save_station_logo') || call.path.startsWith('/storage/v1/object/station-assets/'))).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
