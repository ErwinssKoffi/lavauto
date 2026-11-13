import { expect, test, type Page } from '@playwright/test';
import { COMPANY, EMAIL, OWNER, STATION, emptyFinanceBoard, fakeExpiredTrialAccess, fakeStationSetup, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

// Serveur entièrement simulé : ces scénarios ne valident ni Supabase distant,
// ni la livraison réseau réelle, ni la coordination entre plusieurs appareils.
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const EXPENSE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PREFIX = 'washguard.pending-expense.v1';

function context(multiple = false) {
  return {
    authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
    fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
    company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: '2026-01-01T00:00:00Z' },
    stations: [
      { id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null },
      ...(multiple ? [{ id: OTHER, name: 'Station B', city: 'Bouaké', activated: true, logoPath: null }] : []),
    ],
    permissions: ['washes.view', 'expenses.create', 'expenses.cancel', 'settings.manage'],
  };
}

function backend(multiple = false) {
  const expenses: Record<string, unknown>[] = [];
  const seen = new Map<string, { payload: string; id: string }>();
  let lose = false;
  let reject = false;
  let failRead = false;
  let malformedRead = false;
  let wrongRead = false;
  let readAfterWrite: 'fail' | 'malformed' | 'wrong' | null = null;
  let waitWrite: Promise<void> | null = null;
  const handle = async (call: Call) => {
    if (call.path.endsWith('/my_context')) return { data: context(multiple) };
    if (call.path.endsWith('/my_station_setup')) {
      const snapshot = fakeStationSetup();
      if (call.body.p_station_id === OTHER) {
        snapshot.station.id = OTHER; snapshot.station.name = 'Station B';
        snapshot.categories[0].station_id = OTHER; snapshot.services[0].station_id = OTHER; snapshot.prices[0].station_id = OTHER;
      }
      return { data: snapshot };
    }
    if (call.path.endsWith('/my_station_finance_board')) {
      if (failRead) { failRead = false; return { status: 503, data: { message: 'Relecture interrompue' } }; }
      let rows = expenses.filter((e) => e.stationId === call.body.p_station_id);
      if (malformedRead) { malformedRead = false; rows = rows.map((e) => { const copy = { ...e }; delete copy.status; return copy; }); }
      if (wrongRead) { wrongRead = false; rows = rows.map((e) => ({ ...e, amount: Number(e.amount) + 1 })); }
      return { data: { ...emptyFinanceBoard(), expenses: rows } };
    }
    if (call.path.endsWith('/record_expense_by_key')) {
      if (waitWrite) await waitWrite;
      if (reject) { reject = false; return { status: 403, data: { code: '42501', message: 'Dépense refusée en test' } }; }
      const key = String(call.body.p_idempotency_key);
      const body = JSON.stringify(call.body);
      const previous = seen.get(key);
      if (previous) {
        if (previous.payload !== body) return { status: 409, data: { code: '23505', message: 'Clé déjà utilisée' } };
        return { data: previous.id };
      }
      expenses.push({
        id: EXPENSE, stationId: call.body.p_station_id, amount: call.body.p_amount_minor,
        category: call.body.p_category_name, reason: call.body.p_reason, supplier: call.body.p_supplier,
        date: call.body.p_spent_at, method: call.body.p_method_key === 'cash' ? 'especes' : call.body.p_method_key,
        cashSessionId: null, status: 'enregistree', cancelReason: null, createdBy: 'Propriétaire',
        createdAt: new Date().toISOString(), idempotencyKey: key, purchaseOrderId: null,
      });
      seen.set(key, { payload: body, id: EXPENSE });
      if (readAfterWrite === 'fail') failRead = true;
      if (readAfterWrite === 'malformed') malformedRead = true;
      if (readAfterWrite === 'wrong') wrongRead = true;
      readAfterWrite = null;
      if (lose) { lose = false; return { status: 503, data: { message: 'Réponse perdue après écriture' } }; }
      return { data: EXPENSE };
    }
  };
  return {
    handle, expenses,
    lose: () => { lose = true; },
    reject: () => { reject = true; },
    afterWrite: (mode: 'fail' | 'malformed' | 'wrong') => { readAfterWrite = mode; },
    hold: (p: Promise<void>) => { waitWrite = p; },
  };
}

async function openExpense(page: Page) {
  await signInFake(page);
  await page.goto('/app/depenses');
  await expect(page.getByRole('heading', { name: 'Dépenses', exact: true })).toBeVisible();
  const button = page.getByRole('button', { name: 'Nouvelle dépense' });
  await expect(button).toBeEnabled();
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle dépense' });
  await dialog.getByLabel('Montant (FCFA) *').fill('2400');
  await dialog.getByLabel('Motif *').fill('Shampoing test');
  await dialog.getByLabel('Fournisseur').fill('Fournisseur test');
  await dialog.getByLabel('Moyen de paiement *').selectOption('wave');
  return dialog;
}
const writes = (calls: Call[]) => calls.filter((c) => c.path.endsWith('/record_expense_by_key'));
const pendingKeys = (page: Page) => page.evaluate((prefix) => Object.keys(sessionStorage).filter((k) => k.startsWith(prefix)), PREFIX);

async function clean(fake: { blocked: string[]; unexpected: Call[] }) {
  expect(fake.blocked).toEqual([]);
  expect(fake.unexpected).toEqual([]);
}

test('double action : une seule dépense et succès seulement après relecture', async ({ page }) => {
  test.setTimeout(60_000);
  const b = backend();
  let release!: () => void;
  b.hold(new Promise<void>((resolve) => { release = resolve; }));
  const fake = await installFakeSupabase(page, b.handle);
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).dblclick();
  await expect.poll(() => writes(fake.calls).length).toBe(1);
  await expect(page.getByText('Dépense enregistrée et relue.')).toHaveCount(0);
  expect(await pendingKeys(page)).toHaveLength(1);
  release();
  await expect(page.getByText('Dépense enregistrée et relue.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Shampoing test' })).toContainText('2 400 FCFA');
  expect(b.expenses).toHaveLength(1);
  expect(await pendingKeys(page)).toEqual([]);
  await clean(fake);
});

test('réponse perdue : conservation après reload et rejeu identique', async ({ page }) => {
  test.setTimeout(60_000);
  const b = backend(); b.lose();
  const fake = await installFakeSupabase(page, b.handle);
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog.getByText(/Résultat incertain ou relecture non confirmée/)).toBeVisible();
  expect(writes(fake.calls)).toHaveLength(1);
  expect(b.expenses).toHaveLength(1);
  expect(await pendingKeys(page)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nouvelle dépense' })).toBeDisabled();
  await page.getByRole('button', { name: 'Vérifier la même dépense' }).click();
  await expect(page.getByText('Dépense enregistrée et relue.')).toBeVisible();
  expect(writes(fake.calls)).toHaveLength(2);
  expect(writes(fake.calls)[1].body).toEqual(writes(fake.calls)[0].body);
  expect(b.expenses).toHaveLength(1);
  expect(await pendingKeys(page)).toEqual([]);
  await clean(fake);
});

test('relecture échouée puis refus lors du rejeu : la tentative reste conservée', async ({ page }) => {
  test.setTimeout(60_000);
  const b = backend(); b.afterWrite('fail');
  const fake = await installFakeSupabase(page, b.handle);
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog.getByText(/Résultat incertain ou relecture non confirmée/)).toBeVisible();
  await expect(page.getByText('Dépense enregistrée et relue.')).toHaveCount(0);
  b.reject();
  await dialog.getByRole('button', { name: 'Vérifier la même dépense' }).click();
  await expect(page.getByText(/Dépense refusée en test/)).toBeVisible();
  expect(await pendingKeys(page)).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Vérifier la même dépense' }).click();
  await expect(page.getByText('Dépense enregistrée et relue.')).toBeVisible();
  expect(writes(fake.calls)).toHaveLength(3);
  expect(writes(fake.calls).map((c) => c.body)).toEqual([writes(fake.calls)[0].body, writes(fake.calls)[0].body, writes(fake.calls)[0].body]);
  expect(b.expenses).toHaveLength(1);
  await clean(fake);
});

for (const mode of ['malformed', 'wrong'] as const) {
  test(`relecture ${mode === 'malformed' ? 'malformée' : 'non conforme'} : aucune fausse confirmation`, async ({ page }) => {
    test.setTimeout(60_000);
    const b = backend(); b.afterWrite(mode);
    const fake = await installFakeSupabase(page, b.handle);
    const dialog = await openExpense(page);
    await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(dialog.getByText(/Résultat incertain ou relecture non confirmée/)).toBeVisible();
    await expect(page.getByText('Dépense enregistrée et relue.')).toHaveCount(0);
    expect(await pendingKeys(page)).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Vérifier la même dépense' }).click();
    await expect(page.getByText('Dépense enregistrée et relue.')).toBeVisible();
    expect(b.expenses).toHaveLength(1);
    await clean(fake);
  });
}

test('stockage de session plein : la commande n’est pas envoyée', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript((prefix) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix)) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, PREFIX);
  const b = backend(); const fake = await installFakeSupabase(page, b.handle);
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog.getByText(/Stockage de session indisponible/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
  expect(writes(fake.calls)).toHaveLength(0);
  await clean(fake);
});

test('tentative illisible : aucune nouvelle commande', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(({ prefix, user, station }) => {
    sessionStorage.setItem(`${prefix}:${user}:${station}`, '{tronqué');
  }, { prefix: PREFIX, user: OWNER, station: STATION });
  const b = backend(); const fake = await installFakeSupabase(page, b.handle);
  await signInFake(page); await page.goto('/app/depenses');
  await expect(page.getByText(/Tentative de dépense illisible/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouvelle dépense' })).toBeDisabled();
  expect(writes(fake.calls)).toHaveLength(0);
  await clean(fake);
});

test('réponse tardive après changement de station : reprise dans la station d’origine', async ({ page }) => {
  test.setTimeout(60_000);
  const b = backend(true);
  let release!: () => void;
  b.hold(new Promise<void>((resolve) => { release = resolve; }));
  const fake = await installFakeSupabase(page, b.handle, { stationIds: [OTHER] });
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect.poll(() => writes(fake.calls).length).toBe(1);
  await page.getByLabel('Station active').selectOption(OTHER);
  release();
  await expect.poll(() => b.expenses.length).toBe(1);
  expect(await pendingKeys(page)).toHaveLength(1);
  await page.getByLabel('Station active').selectOption(STATION);
  const verify = page.getByRole('button', { name: 'Vérifier la même dépense' });
  await expect(verify).toBeVisible();
  await verify.click();
  await expect(page.getByText('Dépense enregistrée et relue.')).toBeVisible();
  expect(writes(fake.calls)).toHaveLength(2);
  expect(writes(fake.calls)[1].body).toEqual(writes(fake.calls)[0].body);
  expect(b.expenses).toHaveLength(1);
  await clean(fake);
});

test('refus explicite dès la première commande : la tentative est libérée sans dépense', async ({ page }) => {
  test.setTimeout(60_000);
  const b = backend(); b.reject();
  const fake = await installFakeSupabase(page, b.handle);
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText(/Dépense refusée en test/)).toBeVisible();
  await expect(dialog.getByLabel('Montant (FCFA) *')).toBeVisible();
  expect(await pendingKeys(page)).toEqual([]);
  expect(b.expenses).toHaveLength(0);
  expect(writes(fake.calls)).toHaveLength(1);
  await clean(fake);
});

test('getter du stockage de session inaccessible : la création est bloquée', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('interdit', 'SecurityError'); } });
  });
  const b = backend(); const fake = await installFakeSupabase(page, b.handle);
  await signInFake(page); await page.goto('/app/depenses');
  await expect(page.getByText(/Stockage de session indisponible/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouvelle dépense' })).toBeDisabled();
  expect(writes(fake.calls)).toHaveLength(0);
  await clean(fake);
});

for (const lostResponse of [false, true]) {
  test(`stockage effacé pendant la commande ${lostResponse ? 'à réponse perdue' : 'confirmée'} : aucun nouveau paiement aveugle`, async ({ page }) => {
    test.setTimeout(60_000);
    const b = backend();
    if (lostResponse) b.lose();
    let release!: () => void;
    b.hold(new Promise<void>((resolve) => { release = resolve; }));
    const fake = await installFakeSupabase(page, b.handle);
    const dialog = await openExpense(page);
    await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => writes(fake.calls).length).toBe(1);
    const keys = await pendingKeys(page);
    expect(keys).toHaveLength(1);
    await page.evaluate((key) => sessionStorage.removeItem(key), keys[0]);
    release();
    await expect(dialog.getByText(/conservation de la tentative n’est plus confirmée/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Vérifier la même dépense' })).toBeDisabled();
    await expect(page.getByText('Dépense enregistrée et relue.')).toHaveCount(0);
    await dialog.getByText('Fermer', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nouvelle dépense' })).toBeDisabled();
    await expect(page.getByText(/conservation dans cet onglet n’est plus confirmée/)).toBeVisible();
    expect(writes(fake.calls)).toHaveLength(1);
    expect(b.expenses).toHaveLength(1);
    await clean(fake);
  });
}

test('dépense incertaine puis expiration : tentative conservée, reprise seulement après réactivation', async ({ page }) => {
  test.setTimeout(90_000);
  const b = backend(); b.lose();
  let expired = false;
  const fake = await installFakeSupabase(page, (call) => {
    if (expired && call.path.endsWith('/my_subscription_access')) return { data: fakeExpiredTrialAccess() };
    return b.handle(call);
  });
  const dialog = await openExpense(page);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog.getByText(/Résultat incertain ou relecture non confirmée/)).toBeVisible();
  const key = `${PREFIX}:${OWNER}:${STATION}`;
  const raw = await page.evaluate((k) => sessionStorage.getItem(k), key);
  expect(raw).toBeTruthy();
  expect(writes(fake.calls)).toHaveLength(1);

  expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(dialog.getByText(/reprise est suspendue en lecture seule/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Vérifier la même dépense' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Vérifier la même dépense' })).toBeDisabled();
  await expect(page.getByRole('row').filter({ hasText: 'Shampoing test' })).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBe(raw);
  expect(writes(fake.calls)).toHaveLength(1);

  expired = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const retry = page.getByRole('button', { name: 'Vérifier la même dépense' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByText('Dépense enregistrée et relue.')).toBeVisible();
  expect(writes(fake.calls)).toHaveLength(2);
  expect(writes(fake.calls)[1].body).toEqual(writes(fake.calls)[0].body);
  expect(b.expenses).toHaveLength(1);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await clean(fake);
});
