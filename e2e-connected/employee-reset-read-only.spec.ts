import { expect, test } from '@playwright/test';
import { COMPANY, EMAIL, OWNER, STATION, fakeExpiredTrialAccess, fakeSubscriptionAccess, installFakeSupabase } from './fixtures/mock-supabase';
import { signInFake } from './fixtures/mock-supabase';

// Auth et e-mail sont simulés : aucune demande externe n'est envoyée.
test('lien employé préparé puis expiration : envoi suspendu même si le dialogue reste ouvert', async ({ page }) => {
  let expired = false;
  const mock = await installFakeSupabase(page, (call) => {
    if (call.path.endsWith('/my_context')) return { data: {
      authenticated: true, profileReady: true, active: true, userId: OWNER, email: EMAIL,
      fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false, companyId: COMPANY,
      company: { id: COMPANY, name: 'Entreprise test', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: new Date().toISOString() },
      stations: [{ id: STATION, name: 'Station A', city: 'Abidjan', activated: true, logoPath: null }],
      permissions: ['employees.view', 'employees.manage', 'users.reset_password', 'subscription.manage'],
    } };
    if (call.path.endsWith('/my_subscription_access')) return { data: expired ? fakeExpiredTrialAccess() : fakeSubscriptionAccess() };
    return undefined;
  });
  await signInFake(page);
  await page.goto('/app/employes');
  const reset = page.getByTitle('Envoyer un lien de réinitialisation').first();
  await expect(reset).toBeEnabled();
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Lien de réinitialisation' });
  await expect(dialog.getByRole('button', { name: 'Envoyer le lien' })).toBeEnabled();
  expired = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(dialog.getByText(/Chaque utilisateur peut toujours récupérer son propre accès/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Envoyer le lien' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(reset).toBeDisabled();
  expect(mock.calls.filter((call) => call.path === '/auth/v1/recover')).toEqual([]);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('récupération autonome du compte accessible sans abonnement vérifié', async ({ page }) => {
  const mock = await installFakeSupabase(page, (call) => call.path === '/auth/v1/recover' ? { data: {} } : undefined);
  await page.goto('/mot-de-passe-oublie');
  await page.getByLabel('Adresse e-mail').fill(EMAIL);
  await page.getByRole('button', { name: 'Recevoir le lien' }).click();
  await expect(page.getByText(/Si cette adresse correspond à un compte/)).toBeVisible();
  expect(mock.calls.filter((call) => call.path === '/auth/v1/recover')).toHaveLength(1);
  expect(mock.calls.some((call) => call.path.endsWith('/my_subscription_access'))).toBe(false);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
