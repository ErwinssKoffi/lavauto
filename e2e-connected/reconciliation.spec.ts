import { expect, test } from '@playwright/test';
import { CATEGORY, OWNER, SERVICE, STATION, emptyFinanceBoard, installFakeSupabase, signInFake } from './fixtures/mock-supabase';

test('rapprochement connecté simulé : estimation signalée, comptage saisi et attendu relu du serveur', async ({ page }) => {
  const at = new Date().toISOString();
  const wave = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  const reconciliations: Record<string, unknown>[] = [];
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path === '/rest/v1/rpc/my_station_wash_board') return { data: [{
      id: 'wash-test', stationId: STATION, number: 'L-0001', clientId: null, clientName: null,
      vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: '', employeeId: OWNER,
      assignedUserIds: [OWNER], postId: null, items: [{ serviceId: SERVICE, serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
      discount: 0, total: 3000, paid: 1000, status: 'assigned', createdAt: at,
      finishedAt: null, deliveredAt: null, cancelledReason: null,
      payments: [{ id: 'pay-test', amount: 1000, method: 'wave', at, byUserId: OWNER }],
      history: [], qualityResult: null, qualityNotes: null,
    }] };
    if (call.path === '/rest/v1/rpc/my_station_finance_board') return { data: {
      ...emptyFinanceBoard(),
      paymentMethods: [{ id: wave, stationId: STATION, key: 'wave', label: 'Wave', uiMethod: 'wave', affectsCash: false, active: true }],
      reconciliations,
    } };
    if (call.path === '/rest/v1/rpc/reconcile_channel') {
      // Le faux serveur voit davantage que les fiches chargées dans l'UI.
      reconciliations.push({ id: 'rec-test', stationId: STATION, methodId: wave, uiMethod: 'wave',
        start: call.body.p_start, end: call.body.p_end, expected: 2000, counted: call.body.p_counted_minor,
        difference: Number(call.body.p_counted_minor) - 2000, frozen: true, validatedAt: at });
      return { data: null };
    }
    return undefined;
  });
  await signInFake(page);
  await page.goto('/app/caisse');
  const count = page.getByLabel('Compté Wave (FCFA)');
  const card = count.locator('../../..');
  await expect(card).toContainText('Estimation sur les fiches chargées : 1 000 FCFA');
  await expect(page.getByText(/200 au maximum/)).toBeVisible();
  await expect(count).toHaveValue('');
  await expect(card.getByRole('button', { name: 'Figer' })).toBeDisabled();
  await count.fill('800.5');
  await expect(card.getByRole('button', { name: 'Figer' })).toBeDisabled();
  await count.fill('800');
  await expect(card.getByRole('button', { name: 'Figer' })).toBeEnabled();
  const start = page.getByLabel('Début de la période');
  const today = await start.inputValue();
  await start.fill('2000-01-01');
  await expect(count).toHaveValue('');
  await expect(card.getByRole('button', { name: 'Figer' })).toBeDisabled();
  await start.fill(today);
  await count.fill('800');
  await card.getByRole('button', { name: 'Figer' }).click();
  await expect(card).toContainText('Attendu sur la période : 2 000 FCFA');
  await expect(count).toHaveValue('800');
  await expect(count).toBeDisabled();
  const calls = mock.calls.filter((call) => call.path === '/rest/v1/rpc/reconcile_channel');
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toMatchObject({ p_method_id: wave, p_counted_minor: 800 });
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
