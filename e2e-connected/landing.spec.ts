import { expect, test } from '@playwright/test';
import { installFakeSupabase } from './fixtures/mock-supabase';

const dbPlan = {
  id: 'standard', name: 'Standard test', price_monthly_minor: 16000, currency_code: 'XOF', trial_days: 0,
  sort_order: 1, features: ['Avantage servi par la base'],
  plan_limits: [{ key: 'stations', value_int: 2 }, { key: 'employees', value_int: 12 }, { key: 'washes_per_month', value_int: 900 }],
};

test('vitrine connectée simulée : chargement sans repli, tarif et limites du serveur, navigation réelle', async ({ page }) => {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const mock = await installFakeSupabase(page, async (call) => {
    if (call.path === '/rest/v1/plans') { markStarted(); await gate; return { data: [dbPlan] }; }
    return undefined;
  });
  try {
    await page.goto('/');
    await started;
    const pricing = page.locator('#tarifs');
    await expect(pricing.getByRole('status')).toContainText('Chargement des formules');
    await expect(pricing).not.toContainText('15 000 FCFA');
    await expect(pricing).not.toContainText('16 000 FCFA');
  } finally {
    release();
  }
  const pricing = page.locator('#tarifs');
  await expect(pricing).toContainText('16 000 FCFA');
  await expect(pricing).toContainText('2 station(s)');
  await expect(pricing).toContainText('12 collaborateur(s)');
  await expect(pricing).toContainText('Avantage servi par la base');
  await expect(pricing).not.toContainText('15 000 FCFA');
  await expect(page.getByText('Aperçu d’une station — données fictives')).toBeVisible();
  await expect(page.getByText(/Témoignages Clients/)).toHaveCount(0);
  for (const href of await page.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
    expect(href).toBeTruthy();
    await expect(page.locator(href!)).toHaveCount(1);
  }
  await page.getByRole('link', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/inscription$/);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('vitrine connectée simulée : base indisponible, aucune formule locale de remplacement', async ({ page }) => {
  const mock = await installFakeSupabase(page, (call) => call.path === '/rest/v1/plans'
    ? { status: 503, headers: { 'retry-after': '0' }, data: { message: 'base indisponible' } }
    : undefined);
  await page.goto('/');
  const pricing = page.locator('#tarifs');
  // PostgREST peut retenter une réponse 503 avant de remonter l'erreur.
  await expect(pricing.getByRole('alert')).toContainText('Formules et tarifs indisponibles', { timeout: 15_000 });
  await expect(pricing).toContainText('Aucun prix local');
  await expect(pricing).not.toContainText('15 000 FCFA');
  await expect(pricing).not.toContainText('16 000 FCFA');
  await expect(pricing.getByRole('link', { name: 'Créer un compte' })).toHaveCount(0);
  expect(mock.calls.filter((call) => call.path === '/rest/v1/plans').length).toBeGreaterThan(1);
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});

test('vitrine connectée simulée : table des formules vide traitée comme indisponible', async ({ page }) => {
  const mock = await installFakeSupabase(page, (call) => call.path === '/rest/v1/plans' ? { data: [] } : undefined);
  await page.goto('/');
  const pricing = page.locator('#tarifs');
  await expect(pricing.getByRole('alert')).toContainText('Formules et tarifs indisponibles');
  await expect(pricing).not.toContainText('15 000 FCFA');
  await expect(pricing).not.toContainText('16 000 FCFA');
  expect(mock.unexpected).toEqual([]);
  expect(mock.blocked).toEqual([]);
});
