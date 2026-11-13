import { expect, test } from '@playwright/test';
import { CATEGORY, OWNER, SERVICE, STATION, emptyFinanceBoard, fakeExpiredTrialAccess, installFakeSupabase, signInFake, type Call } from './fixtures/mock-supabase';

// Serveur fictif : aucune opération réelle, aucun compte Auth ou argent en jeu.
test('paiement incertain puis expiration : même clé conservée jusqu’à réactivation', async ({ page }) => {
  test.setTimeout(90_000);
  const washId = '22222222-aaaa-4222-8222-222222222222';
  const paymentId = '33333333-aaaa-4333-8333-333333333333';
  const at = new Date().toISOString();
  let expired = false;
  let paid = 0;
  let acceptedKey: string | null = null;
  let paymentPayload: string | null = null;
  let payments = 0;
  let movements = 0;
  const handle = (call: Call) => {
    if (expired && call.path.endsWith('/my_subscription_access')) return { data: fakeExpiredTrialAccess() };
    if (call.path.endsWith('/my_station_finance_board')) return { data: {
      ...emptyFinanceBoard(), cashSessions: [{ id: 'cash-1', stationId: STATION, number: 'C-1',
        openedBy: 'Propriétaire', openedAt: at, openingFloat: 10000, closedAt: null, countedAmount: null,
        closedBy: null, status: 'ouverte', reopenReason: null, reopenedAt: null }],
    } };
    if (call.path.endsWith('/my_station_wash_board')) return { data: [{
      id: washId, stationId: STATION, number: 'L-PAY', clientId: null, clientName: null,
      vehicleCategoryId: CATEGORY, vehicleLabel: 'Berline', plate: '5555 AB 01', employeeId: OWNER,
      assignedUserIds: [OWNER], postId: null, items: [{ serviceId: SERVICE, serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
      discount: 0, total: 3000, paid, status: 'assigned', createdAt: at, finishedAt: null, deliveredAt: null,
      cancelledReason: null, payments: acceptedKey ? [{ id: paymentId, amount: 3000, method: 'especes', at,
        byUserId: OWNER, idempotencyKey: acceptedKey }] : [], history: [], qualityResult: null, qualityNotes: null,
    }] };
    if (call.path.endsWith('/record_wash_payment_by_key')) {
      const key = String(call.body.p_idempotency_key);
      if (acceptedKey) {
        if (key !== acceptedKey || JSON.stringify(call.body) !== paymentPayload) return { status: 409, data: { code: '23505', message: 'Paiement différent' } };
        return { data: paymentId };
      }
      acceptedKey = key; paymentPayload = JSON.stringify(call.body); paid = 3000; payments += 1; movements += 1;
      return { status: 503, data: { message: 'Réponse perdue après enregistrement' } };
    }
    return undefined;
  };
  const mock = await installFakeSupabase(page, handle);
  await signInFake(page);
  await page.goto('/app/lavages');
  const row = page.getByRole('row').filter({ hasText: 'L-PAY' });
  await row.getByRole('button', { name: 'Détails →' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche L-PAY' });
  await dialog.getByRole('button', { name: 'Encaisser', exact: true }).click();
  await expect(dialog.getByText(/Résultat incertain ou lecture non confirmée/)).toBeVisible();
  const key = `washguard.pending-payment.v1:${OWNER}:${STATION}:${washId}`;
  const raw = await page.evaluate((k) => sessionStorage.getItem(k), key);
  expect(raw).toBeTruthy();
  const writes = () => mock.calls.filter((call) => call.path.endsWith('/record_wash_payment_by_key'));
  expect(writes()).toHaveLength(1);

  expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(dialog.getByText(/reprise est suspendue en lecture seule/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Vérifier le paiement' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'L-PAY' }).getByRole('button', { name: 'Détails →' }).click();
  await expect(dialog.getByRole('button', { name: 'Vérifier le paiement' })).toBeDisabled();
  await expect(dialog.getByText('3 000 FCFA').first()).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBe(raw);
  expect(writes()).toHaveLength(1);

  expired = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const retry = dialog.getByRole('button', { name: 'Vérifier le paiement' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(dialog.getByText(/Résultat incertain ou lecture non confirmée/)).toHaveCount(0);
  expect(writes()).toHaveLength(2);
  expect(writes()[1].body).toEqual(writes()[0].body);
  expect(payments).toBe(1);
  expect(movements).toBe(1);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
