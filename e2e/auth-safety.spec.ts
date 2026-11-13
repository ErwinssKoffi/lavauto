import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// Parcours sur le serveur Vite de test et un profil navigateur vierge. Il ne
// vérifie pas le routeur Vercel déployé ni une authentification/e-mail réel.
async function fillRegistration(page: Page, company = 'Station de test', password = 'motdepasse-test-123') {
  await page.locator('#companyName').fill(company);
  await page.locator('#stationName').fill('Station Cocody');
  await page.locator('#phone').fill('+225 0700000000');
  await page.locator('#city').fill('Abidjan');
  await page.locator('#ownerName').fill('Propriétaire Test');
  await page.locator('#email').fill('owner@test.invalid');
  await page.locator('#password').fill(password);
  await page.locator('#confirm').fill(password);
}

const stateKey = 'washguard.state.v1';
const passwordKey = 'washguard.demo-passwords.v1';

test('routes directes et rechargements sur la build locale', async ({ page }) => {
  const routes = [
    ['/connexion', 'Bonjour'], ['/inscription', 'Créer mon espace'],
    ['/mot-de-passe-oublie', 'Mot de passe oublié ?'],
    ['/reinitialiser-mot-de-passe', 'Définir un mot de passe'],
  ] as const;
  for (const [path, heading] of routes) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect((await page.reload())?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByLabel('Avertissement de démonstration')).toBeVisible();
  }
  const appResponse = await page.goto('/app/lavages');
  expect(appResponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/connexion$/);
  const callbackResponse = await page.goto('/auth/callback');
  expect(callbackResponse?.status()).toBe(200);
  await expect(page).toHaveURL(/\/connexion$/);
});

test('inscription, conservation, copie/restauration isolée et connexion locale', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.goto('/inscription');
  await expect(page.getByText('Aucun e-mail n’est envoyé ni vérifié')).toBeVisible();
  await fillRegistration(page);
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page).toHaveURL(/\/app\/mise-en-route$/);
  await expect(page.getByRole('heading', { name: 'Mise en route', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').company?.name, stateKey)).toBe('Station de test');

  // Le téléchargement est une copie, pas une réinitialisation. Il inclut les
  // empreintes faibles nécessaires à la démo mais pas le mot de passe en clair.
  const before = await page.evaluate(({ stateKey, passwordKey }) => ({
    state: localStorage.getItem(stateKey), passwords: localStorage.getItem(passwordKey),
  }), { stateKey, passwordKey });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger une copie des données locales' }).click(),
  ]);
  const text = await readFile((await download.path())!, 'utf8');
  const backup = JSON.parse(text) as { entries: Record<string, string | null> };
  expect(backup.entries[stateKey]).toBe(before.state);
  expect(backup.entries[passwordKey]).toBe(before.passwords);
  expect(text).not.toContain('motdepasse-test-123');
  expect(await page.evaluate(({ stateKey, passwordKey }) => ({
    state: localStorage.getItem(stateKey), passwords: localStorage.getItem(passwordKey),
  }), { stateKey, passwordKey })).toEqual(before);

  // Une session locale n'est pas restaurée après rechargement : les données,
  // elles, restent présentes et nécessitent le mot de passe existant.
  await page.reload();
  await expect(page).toHaveURL(/\/connexion$/);
  await page.goto('/inscription');
  await fillRegistration(page, 'Ne pas remplacer', 'mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.getByText(/Un espace de démonstration existe déjà/)).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').company.name, stateKey)).toBe('Station de test');
  expect(await page.evaluate((key) => localStorage.getItem(key), passwordKey)).toBe(before.passwords);

  await page.goto('/connexion');
  await page.locator('#email').fill('owner@test.invalid');
  await page.locator('#password').fill('mauvais-mot-de-passe');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByText('Adresse e-mail ou mot de passe incorrect.')).toBeVisible();
  await page.locator('#password').fill('motdepasse-test-123');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/mise-en-route$/);

  // Restauration uniquement dans un second contexte vierge : on ne touche pas
  // au profil d'origine et on vérifie que la connexion retrouve le même espace.
  const isolated = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  try {
    await isolated.addInitScript(({ entries, stateKey: sk, passwordKey: pk }) => {
      if (!sessionStorage.getItem('wg.backup.restored')) {
        if (localStorage.getItem(sk) !== null || localStorage.getItem(pk) !== null) throw new Error('Profil non vierge');
        for (const key of [sk, pk]) if (entries[key] !== null) localStorage.setItem(key, entries[key]!);
        sessionStorage.setItem('wg.backup.restored', '1');
      }
    }, { entries: backup.entries, stateKey, passwordKey });
    const restored = await isolated.newPage();
    await restored.goto('/connexion');
    await restored.locator('#email').fill('owner@test.invalid');
    await restored.locator('#password').fill('motdepasse-test-123');
    await restored.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(restored).toHaveURL(/\/app\/mise-en-route$/);
    expect(await restored.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').company.name, stateKey)).toBe('Station de test');
  } finally { await isolated.close(); }
});

test('réinitialisation de mot de passe : aucun e-mail promis ou envoyé en local', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (/\/auth\/v1\//.test(request.url())) requests.push(request.url()); });
  await page.goto('/mot-de-passe-oublie');
  await expect(page.getByText(/Aucun e-mail n’est envoyé en démonstration/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recevoir le lien' })).toHaveCount(0);
  await page.goto('/reinitialiser-mot-de-passe');
  await expect(page.getByText(/ne dispose pas de lien de réinitialisation/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le mot de passe' })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('un état local corrompu reste intact et peut être exporté', async ({ page }) => {
  const raw = '{état-tronqué';
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: stateKey, value: raw });
  await page.goto('/inscription');
  await expect(page.getByText(/Les données locales sont illisibles/)).toBeVisible();
  await fillRegistration(page);
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.locator('form').getByText(/Aucune inscription n’a été créée|Stockage local illisible ou inaccessible/)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), stateKey)).toBe(raw);
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger une copie des données locales' }).click(),
  ]);
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8')) as { entries: Record<string, string> };
  expect(backup.entries[stateKey]).toBe(raw);
  await page.reload();
  expect(await page.evaluate((key) => localStorage.getItem(key), stateKey)).toBe(raw);
});
