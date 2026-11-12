import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CashClosure, CashMovement, CashSession, Wash } from '../src/types';
import { CATEGORY, OWNER, SERVICE, STATION, emptyFinanceBoard, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

const CASH = '11111111-aaaa-4111-8111-111111111111';
const WASH = '22222222-aaaa-4222-8222-222222222222';
const PAYMENT = '33333333-aaaa-4333-8333-333333333333';
const MOVEMENT = '44444444-aaaa-4444-8444-444444444444';
const CLOSURE = '55555555-aaaa-4555-8555-555555555555';

async function expectMetric(root: Page | Locator, label: string, value: string) {
  await expect(root.getByText(label, { exact: true }).locator('..')).toContainText(value);
}

// Les tableaux suivants sont des réponses HTTP fictives, pas une implantation
// des règles SQL. Le test vérifie le câblage et les erreurs côté navigateur.
function operationsBackend() {
  const sessions: CashSession[] = [];
  const movements: CashMovement[] = [];
  const closures: CashClosure[] = [];
  const washes: Wash[] = [];
  let rejectPayment = true;
  let rejectClose = true;
  let loseNextResponse = false;
  let rejectNextCreate = false;
  let failReadAfterCreate = false;
  let failNextBoard = false;
  const creations = new Map<string, { payload: string; id: string }>();
  const handle = (call: Call) => {
    if (call.path === '/rest/v1/rpc/my_station_finance_board') return { data: { ...emptyFinanceBoard(), cashSessions: sessions, cashMovements: movements, cashClosures: closures } };
    if (call.path === '/rest/v1/rpc/my_station_wash_board') {
      if (failNextBoard) { failNextBoard = false; return { status: 503, data: { message: 'Lecture indisponible en test' } }; }
      return { data: washes };
    }
    if (call.path === '/rest/v1/rpc/open_cash_session') {
      sessions.push({
        id: CASH, stationId: STATION, openedBy: 'Propriétaire', openedAt: new Date().toISOString(),
        openingFloat: Number(call.body.p_opening_float_minor), closedAt: null, countedAmount: null,
        closedBy: null, status: 'ouverte', reopenReason: null, reopenedAt: null,
      });
      return { data: CASH };
    }
    if (call.path === '/rest/v1/rpc/create_wash_atomic') {
      const payload = call.body.p_payload as Record<string, unknown>;
      const key = String(payload.idempotency_key);
      const initial = payload.initial_payment as { amount_minor: number; method_key: string } | null;
      if (rejectNextCreate) { rejectNextCreate = false; return { status: 403, data: { code: '42501', message: 'Permission refusée pendant la reprise' } }; }
      const previous = creations.get(key);
      if (previous) {
        if (previous.payload !== JSON.stringify(payload)) return { status: 409, data: { code: '23505', message: 'Clé déjà utilisée' } };
        return { data: previous.id };
      }
      if (initial && rejectPayment) return { status: 403, data: { code: '42501', message: 'Paiement refusé en test' } };
      if (initial?.method_key === 'cash' && !sessions.some((session) => session.status === 'ouverte')) {
        return { status: 400, data: { code: '23514', message: 'Caisse fermée' } };
      }
      const at = new Date().toISOString();
      const amount = initial ? Number(initial.amount_minor) : 0;
      washes.push({
        id: WASH, stationId: STATION, number: 'L-0001', clientId: null, clientName: null,
        vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: String(payload.plate), employeeId: OWNER,
        assignedUserIds: [OWNER], postId: null, items: [{ serviceId: SERVICE, serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
        discount: 0, total: 3000, paid: amount, status: 'assigned', createdAt: at,
        finishedAt: null, deliveredAt: null, cancelledReason: null,
        payments: initial ? [{ id: PAYMENT, amount, method: initial.method_key === 'cash' ? 'especes' : 'mobile_money', at, byUserId: OWNER }] : [],
        history: [], qualityResult: null, qualityNotes: null,
      });
      if (initial?.method_key === 'cash') movements.push({
        id: MOVEMENT, stationId: STATION, cashSessionId: CASH, kind: 'payment_in', amount,
        uiMethod: 'especes', paymentId: PAYMENT, expenseId: null, reference: 'Fiche',
        idempotencyKey: `cash:atomic:${key}`, createdAt: at,
      });
      creations.set(key, { payload: JSON.stringify(payload), id: WASH });
      if (failReadAfterCreate) { failReadAfterCreate = false; failNextBoard = true; }
      if (loseNextResponse) { loseNextResponse = false; return { status: 503, data: { message: 'Réponse perdue en test' } }; }
      return { data: WASH };
    }
    if (call.path === '/rest/v1/rpc/record_wash_payment_by_key') {
      if (rejectPayment) return { status: 403, data: { code: '42501', message: 'Paiement refusé en test' } };
      const at = new Date().toISOString();
      const amount = Number(call.body.p_amount_minor);
      washes[0].paid = amount;
      washes[0].payments.push({ id: PAYMENT, amount, method: 'especes', at, byUserId: OWNER,
        idempotencyKey: String(call.body.p_idempotency_key) });
      movements.push({ id: MOVEMENT, stationId: STATION, cashSessionId: CASH, kind: 'payment_in', amount,
        uiMethod: 'especes', paymentId: PAYMENT, expenseId: null, reference: 'Fiche',
        idempotencyKey: `cash:${String(call.body.p_idempotency_key)}`, createdAt: at });
      return { data: PAYMENT };
    }
    if (call.path === '/rest/v1/rpc/close_cash_session') {
      if (rejectClose) return { status: 403, data: { code: '42501', message: 'Clôture refusée en test' } };
      const at = new Date().toISOString();
      const counted = Number(call.body.p_counted_minor);
      const theoretical = sessions[0].openingFloat + movements.reduce((sum, m) => sum + m.amount, 0);
      sessions[0] = { ...sessions[0], status: 'cloturee', closedAt: at, countedAmount: counted, closedBy: 'Propriétaire' };
      closures.push({ id: CLOSURE, stationId: STATION, cashSessionId: CASH, counted, theoretical,
        difference: counted - theoretical, closedBy: 'Propriétaire', createdAt: at });
      return { data: null };
    }
    return undefined;
  };
  return {
    handle, sessions, movements, closures, washes,
    acceptPayment: () => { rejectPayment = false; },
    acceptClose: () => { rejectClose = false; },
    loseNextResponse: () => { loseNextResponse = true; },
    rejectNextCreate: () => { rejectNextCreate = true; },
    failReadAfterCreate: () => { failReadAfterCreate = true; },
  };
}

test('caisse et lavage connectés simulés : RPC, refus, nouvelle lecture et clôture', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = operationsBackend();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await page.goto('/app/caisse');
  await page.getByRole('button', { name: 'Ouvrir la caisse', exact: true }).first().click();
  const opening = page.getByRole('dialog', { name: 'Ouvrir la caisse' });
  await opening.getByLabel('Fond de caisse (FCFA) *').fill('10000');
  await opening.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(opening).toHaveCount(0);
  await expectMetric(page, 'Fond de caisse', '10 000 FCFA');

  await page.goto('/app/lavages');
  // En mode connecté le store métier ne persiste plus dans localStorage :
  // attendre et sélectionner les options exposées par le formulaire.
  await page.getByRole('button', { name: 'Nouvelle fiche' }).click();
  const create = page.getByRole('dialog', { name: 'Nouvelle fiche de lavage' });
  await create.getByLabel('Catégorie de véhicule *').selectOption(CATEGORY);
  await create.getByRole('checkbox', { name: /Propriétaire/ }).check();
  await create.getByLabel('Plaque (facultative)').fill('2222 AB 01');
  await create.getByRole('checkbox', { name: 'Sélectionner Lavage extérieur' }).check();
  await expectMetric(create, 'Total estimé de la fiche', '3 000 FCFA');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: '2222 AB 01' });
  await expect(row).toContainText('3 000 FCFA');
  await row.getByRole('button', { name: 'Détails →' }).click();
  const detail = page.getByRole('dialog', { name: 'Fiche L-0001' });
  await expectMetric(detail, 'Reste à payer', '3 000 FCFA');

  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expect(page.getByText(/Paiement refusé en test/)).toBeVisible();
  await expectMetric(detail, 'Reste à payer', '3 000 FCFA');
  expect(backend.washes[0].payments).toHaveLength(0);
  expect(backend.movements).toHaveLength(0);
  backend.acceptPayment();
  await detail.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expectMetric(detail, 'Reste à payer', '0 FCFA');
  await expectMetric(detail, 'Encaissé', '3 000 FCFA');

  await page.goto('/app/caisse');
  await expectMetric(page, 'Théorique en caisse', '13 000 FCFA');
  await page.getByRole('button', { name: 'Clôturer avec comptage' }).click();
  const closing = page.getByRole('dialog', { name: 'Clôturer la caisse avec comptage' });
  await closing.getByLabel('Montant physique compté (FCFA) *').fill('12900');
  await expectMetric(closing, 'Écart au comptage', '-100 FCFA');
  await closing.getByRole('button', { name: 'Sceller et clôturer' }).click();
  await expect(page.getByText(/Clôture refusée en test/)).toBeVisible();
  await expect(closing).toBeVisible();
  expect(backend.closures).toHaveLength(0);
  expect(backend.sessions[0].status).toBe('ouverte');
  backend.acceptClose();
  await closing.getByRole('button', { name: 'Sceller et clôturer' }).click();
  await expect(closing).toHaveCount(0);
  const closures = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Écart conservé' }) });
  await expect(closures.getByRole('row').nth(1)).toContainText('-100 FCFA');
  await page.reload(); // relecture du faux backend, pas d'une base réelle
  await expect(page.getByText('Aucune caisse ouverte')).toBeVisible();
  await expect(closures.getByRole('row').nth(1)).toContainText('12 900 FCFA');

  const calls = (name: string) => mock.calls.filter((call) => call.path === `/rest/v1/rpc/${name}`);
  expect(calls('open_cash_session').map((call) => call.body)).toEqual([{ p_station_id: STATION, p_opening_float_minor: 10000, p_number: '' }]);
  const creates = calls('create_wash_atomic');
  expect(creates).toHaveLength(1);
  expect(creates[0].body).toEqual({ p_payload: {
    station_id: STATION, category_id: CATEGORY, plate: '2222 AB 01', customer_id: null, customer_name: '',
    discount_minor: 0, items: [{ serviceId: SERVICE, qty: 1 }], employee_ids: [OWNER], post_id: null,
    idempotency_key: expect.stringMatching(/^ui-/), initial_payment: null,
  } });
  const payments = calls('record_wash_payment_by_key');
  expect(payments).toHaveLength(2); // premier refus, puis succès simulé
  for (const call of payments) expect(call.body).toEqual({
    p_wash_id: WASH, p_amount_minor: 3000, p_method_key: 'cash', p_reference: '',
    p_idempotency_key: expect.stringMatching(/^pay-/),
  });
  expect(calls('close_cash_session').map((call) => call.body)).toEqual([
    { p_session_id: CASH, p_counted_minor: 12900 },
    { p_session_id: CASH, p_counted_minor: 12900 },
  ]);
  expect(backend.washes[0].payments).toHaveLength(1);
  expect(backend.movements).toHaveLength(1);
  expect(backend.closures[0]).toMatchObject({ cashSessionId: CASH, theoretical: 13000, counted: 12900, difference: -100 });
  expect(JSON.stringify([...creates, ...payments, ...calls('open_cash_session'), ...calls('close_cash_session')])).not.toMatch(/company_id|companyId|price_minor/i);
  expect(mock.calls.filter((call) => call.path.startsWith('/rest/v1/') && !call.path.startsWith('/rest/v1/rpc/') && call.method !== 'GET')).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

async function prepareCreate(page: Page, plate: string) {
  await page.goto('/app/lavages');
  await page.getByRole('button', { name: 'Nouvelle fiche' }).click();
  const create = page.getByRole('dialog', { name: 'Nouvelle fiche de lavage' });
  await create.getByLabel('Catégorie de véhicule *').selectOption(CATEGORY);
  await create.getByRole('checkbox', { name: /Propriétaire/ }).check();
  await create.getByLabel('Plaque (facultative)').fill(plate);
  await create.getByRole('checkbox', { name: 'Sélectionner Lavage extérieur' }).check();
  return create;
}

async function openCashForCreate(page: Page) {
  await page.goto('/app/caisse');
  await page.getByRole('button', { name: 'Ouvrir la caisse', exact: true }).first().click();
  const opening = page.getByRole('dialog', { name: 'Ouvrir la caisse' });
  await opening.getByLabel('Fond de caisse (FCFA) *').fill('10000');
  await opening.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(opening).toHaveCount(0);
}

test('paiement initial connecté simulé : un refus laisse zéro fiche, puis une seule réussite', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = operationsBackend(); // premier paiement refusé par le faux serveur
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await openCashForCreate(page);
  const create = await prepareCreate(page, '3333 CD 01');
  await create.getByLabel('Montant encaissé (FCFA)').fill('1000');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(page.getByText(/Paiement refusé en test/)).toBeVisible();
  await expect(create).toBeVisible();
  await expect(create.getByLabel('Montant encaissé (FCFA)')).toBeEditable();
  expect(backend.washes).toHaveLength(0);
  expect(backend.movements).toHaveLength(0);

  backend.acceptPayment();
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '3333 CD 01' })).toContainText('1 000 FCFA');
  expect(backend.washes).toHaveLength(1);
  expect(backend.washes[0].paid).toBe(1000);
  expect(backend.washes[0].payments).toHaveLength(1);
  expect(backend.movements).toHaveLength(1);
  expect(backend.movements[0]).toMatchObject({ cashSessionId: CASH, paymentId: PAYMENT, amount: 1000 });

  const creates = mock.calls.filter((call) => call.path === '/rest/v1/rpc/create_wash_atomic');
  expect(creates).toHaveLength(2);
  const payloads = creates.map((call) => call.body.p_payload as Record<string, unknown>);
  for (const payload of payloads) {
    expect(payload.initial_payment).toEqual({ amount_minor: 1000, method_key: 'cash' });
    expect(payload.idempotency_key).toMatch(/^ui-/);
  }
  expect(payloads[0].idempotency_key).not.toBe(payloads[1].idempotency_key); // refus explicite : transaction annulée
  expect(mock.calls.filter((call) => /\/rpc\/(create_wash_full|record_wash_payment_by_key)$/.test(call.path))).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('réponse perdue puis rechargement : même commande, refus ultérieur conservé et aucun doublon', async ({ page }) => {
  test.setTimeout(90_000);
  const backend = operationsBackend();
  backend.acceptPayment();
  backend.loseNextResponse(); // le faux serveur écrit, mais répond 503
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  await openCashForCreate(page);
  const create = await prepareCreate(page, '4444 EF 01');
  await create.getByLabel('Montant encaissé (FCFA)').fill('1000');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create.getByText(/Résultat incertain/)).toBeVisible();
  await expect(create.getByLabel('Montant encaissé (FCFA)')).toHaveCount(0);
  expect(backend.washes).toHaveLength(1);
  expect(backend.washes[0].payments).toHaveLength(1);
  expect(backend.movements).toHaveLength(1);
  const pendingKey = `washguard.pending-wash.v1:${OWNER}:${STATION}`;
  expect(await page.evaluate((key) => Boolean(sessionStorage.getItem(key)), pendingKey)).toBe(true);

  await create.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Vérifier la création' })).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier la création' }).click();
  await expect(create.getByText('4444 EF 01')).toBeVisible();
  backend.rejectNextCreate(); // par exemple permission retirée après le commit initial
  await create.getByRole('button', { name: 'Vérifier / réessayer la même opération' }).click();
  await expect(page.getByText(/Permission refusée pendant la reprise/)).toBeVisible();
  await expect(create.getByText(/Résultat incertain/)).toBeVisible();
  expect(await page.evaluate((key) => Boolean(sessionStorage.getItem(key)), pendingKey)).toBe(true);
  await create.getByRole('button', { name: 'Vérifier / réessayer la même opération' }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '4444 EF 01' })).toContainText('1 000 FCFA');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBeNull();

  const creates = mock.calls.filter((call) => call.path === '/rest/v1/rpc/create_wash_atomic');
  expect(creates).toHaveLength(3);
  expect(creates[1].body).toEqual(creates[0].body);
  expect(creates[2].body).toEqual(creates[0].body);
  expect(backend.washes).toHaveLength(1);
  expect(backend.washes[0].payments).toHaveLength(1);
  expect(backend.movements).toHaveLength(1);
  expect(mock.calls.filter((call) => /\/rpc\/(create_wash_full|record_wash_payment_by_key)$/.test(call.path))).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('création confirmée mais relecture en erreur : ne pas proposer une nouvelle soumission', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = operationsBackend();
  backend.failReadAfterCreate();
  const mock = await installFakeSupabase(page, backend.handle);
  await signInFake(page);
  const create = await prepareCreate(page, '5555 GH 01');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByText(/Fiche enregistrée, mais actualisation des lavages impossible/)).toBeVisible();
  expect(backend.washes).toHaveLength(1);
  await page.getByRole('button', { name: 'Actualiser' }).click();
  await expect(page.getByRole('row').filter({ hasText: '5555 GH 01' })).toBeVisible();
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/create_wash_atomic')).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('soumission en cours : clé conservée avant envoi et double clic bloqué', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = operationsBackend();
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const mock = await installFakeSupabase(page, async (call) => {
    if (call.path === '/rest/v1/rpc/create_wash_atomic') { markStarted(); await gate; }
    return backend.handle(call);
  });
  await signInFake(page);
  const create = await prepareCreate(page, '6666 JK 01');
  try {
    await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
    await started;
    await expect(create.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();
    expect(await page.evaluate((key) => Boolean(sessionStorage.getItem(key)),
      `washguard.pending-wash.v1:${OWNER}:${STATION}`)).toBe(true);
    await create.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(create).toBeVisible();
    await create.getByRole('button', { name: 'Enregistrement…' }).evaluate((button) => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  } finally {
    release();
  }
  await expect(create).toHaveCount(0);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/create_wash_atomic')).toHaveLength(1);
  expect(backend.washes).toHaveLength(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('migration 052 absente : erreur explicite, aucun repli vers les anciennes RPC', async ({ page }) => {
  test.setTimeout(60_000);
  const backend = operationsBackend();
  const mock = await installFakeSupabase(page, (call) => call.path === '/rest/v1/rpc/create_wash_atomic'
    ? { status: 404, data: { code: 'PGRST202', message: 'function not found' } }
    : backend.handle(call));
  await signInFake(page);
  const create = await prepareCreate(page, '7777 LM 01');
  await create.getByRole('button', { name: 'Enregistrer la fiche' }).click();
  await expect(page.getByText(/appliquez la migration 052/)).toBeVisible();
  await expect(create.getByLabel('Plaque (facultative)')).toBeEditable();
  expect(backend.washes).toHaveLength(0);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/rpc/create_wash_atomic')).toHaveLength(1);
  expect(mock.calls.filter((call) => /\/rpc\/(create_wash_full|record_wash_payment_by_key)$/.test(call.path))).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), `washguard.pending-wash.v1:${OWNER}:${STATION}`)).toBeNull();
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
