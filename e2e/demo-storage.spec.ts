import { expect, test, type Page } from '@playwright/test';

const STATE = 'washguard.state.v1';
const PASSWORDS = 'washguard.demo-passwords.v1';

async function fill(page: Page, company: string, email = 'owner@test.invalid') {
  await page.locator('#companyName').fill(company);
  await page.locator('#stationName').fill('Station Cocody');
  await page.locator('#phone').fill('+225 0700000000');
  await page.locator('#city').fill('Abidjan');
  await page.locator('#ownerName').fill('Propriétaire Test');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('motdepasse-test-123');
  await page.locator('#confirm').fill('motdepasse-test-123');
}
async function register(page: Page) {
  await page.goto('/inscription'); await fill(page, 'Entreprise conservée');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page).toHaveURL(/\/app\/mise-en-route$/);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').company?.name, STATE)).toBe('Entreprise conservée');
}

test('stockage inaccessible : la page reste utilisable et aucune inscription n’est ouverte', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('interdit', 'SecurityError'); } });
  });
  await page.goto('/inscription');
  await expect(page.getByText(/Le stockage de ce navigateur est inaccessible/)).toBeVisible();
  await fill(page, 'Ne pas créer');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.getByText(/Aucune inscription n’a été créée/)).toBeVisible();
  await expect(page).toHaveURL(/\/inscription$/);
  await page.getByRole('button', { name: 'Télécharger une copie des données locales' }).click();
  await expect(page.getByText(/Copie impossible/)).toBeVisible();
});

test('quota au moment de l’inscription : aucune session ni empreinte orpheline', async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) throw new DOMException('quota simulé', 'QuotaExceededError');
      return original.call(this, k, value);
    };
  }, STATE);
  await page.goto('/inscription'); await fill(page, 'Ne pas créer');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.getByText(/Impossible de conserver l’inscription/)).toBeVisible();
  expect(await page.evaluate(({ state, passwords }) => ({ state: localStorage.getItem(state), passwords: localStorage.getItem(passwords) }),
    { state: STATE, passwords: PASSWORDS })).toEqual({ state: null, passwords: null });
  await expect(page).toHaveURL(/\/inscription$/);
});

test('sans Web Locks, l’inscription est refusée avant toute écriture', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); });
  await page.goto('/inscription'); await fill(page, 'Ne pas créer');
  await page.getByRole('button', { name: 'Créer mon espace' }).click();
  await expect(page.getByText(/Protection multi-onglets indisponible/)).toBeVisible();
  expect(await page.evaluate(({ state, passwords }) => [localStorage.getItem(state), localStorage.getItem(passwords)],
    { state: STATE, passwords: PASSWORDS })).toEqual([null, null]);
});

test('deux onglets inscrits simultanément ne remplacent pas le premier espace', async ({ page, context }) => {
  test.setTimeout(60_000);
  const other = await context.newPage();
  await Promise.all([page.goto('/inscription'), other.goto('/inscription')]);
  await Promise.all([fill(page, 'Première entreprise', 'first@test.invalid'), fill(other, 'Seconde entreprise', 'second@test.invalid')]);
  await Promise.all([
    page.getByRole('button', { name: 'Créer mon espace' }).click(),
    other.getByRole('button', { name: 'Créer mon espace' }).click(),
  ]);
  await expect.poll(() => [page.url(), other.url()].filter((url) => url.includes('/app/')).length).toBe(1);
  const loser = page.url().includes('/app/') ? other : page;
  await expect(loser.locator('form').getByText(/Un espace de démonstration existe déjà|Les données ont changé dans un autre onglet/)).toBeVisible();
  const winnerName = page.url().includes('/app/') ? 'Première entreprise' : 'Seconde entreprise';
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').company?.name, STATE)).toBe(winnerName);
  const state = await page.evaluate(({ sk, pk }) => ({ state: JSON.parse(localStorage.getItem(sk) ?? '{}'), passwords: JSON.parse(localStorage.getItem(pk) ?? '{}') }), { sk: STATE, pk: PASSWORDS });
  expect(state.state.company.name).toBe(winnerName);
  expect(Object.keys(state.passwords)).toHaveLength(1);
  expect(state.state.users).toHaveLength(1);
});

test('une sauvegarde locale en attente est signalée avant rechargement', async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').products?.length ?? 0, STATE)).toBeGreaterThan(0);
  await expect(page.getByText(/Enregistrement local en cours/)).toHaveCount(0);
  // Retenir le même verrou que l'application, afin de contrôler la fenêtre
  // entre le rendu React et la sauvegarde sous Web Locks.
  await page.evaluate(() => {
    const hooks = window as unknown as { wgLockHeld?: boolean; wgReleaseLock?: () => void };
    void navigator.locks.request('washguard.demo-storage.v1', async () => {
      hooks.wgLockHeld = true;
      await new Promise<void>((resolve) => { hooks.wgReleaseLock = resolve; });
    });
  });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { wgLockHeld?: boolean }).wgLockHeld))).toBe(true);
  await page.getByRole('button', { name: /Identité de la station/ }).click();
  await page.getByLabel('Nom de la station *').fill('Station après sauvegarde');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText(/Enregistrement local en cours/)).toBeVisible();
  await expect(page.getByText('Identité de la station enregistrée.')).toHaveCount(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').station?.name, STATE)).toBe('Station Cocody');
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  await page.evaluate(() => (window as unknown as { wgReleaseLock: () => void }).wgReleaseLock());
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').station?.name, STATE)).toBe('Station après sauvegarde');
  await expect(page.getByText(/Enregistrement local en cours/)).toHaveCount(0);
  await expect(page.getByText('Identité de la station enregistrée.')).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test('échec de persistance après modification : avertissement durable, données précédentes conservées', async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  await page.getByRole('button', { name: /Identité de la station/ }).click();
  const before = await page.evaluate((key) => localStorage.getItem(key), STATE);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) throw new DOMException('quota simulé', 'QuotaExceededError');
      return original.call(this, k, value);
    };
  }, STATE);
  await page.getByLabel('Nom de la station *').fill('Station non conservée');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText(/Écriture locale impossible.*modifications récentes ne sont pas conservées/)).toBeVisible();
  await expect(page.getByText('Identité de la station enregistrée.')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STATE)).toBe(before);
});

test('un changement dans un second onglet bloque les écritures de l’onglet périmé', async ({ page, context }) => {
  test.setTimeout(60_000);
  await register(page);
  const other = await context.newPage();
  await other.goto('/connexion');
  await other.locator('#email').fill('owner@test.invalid');
  await other.locator('#password').fill('motdepasse-test-123');
  await other.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(other).toHaveURL(/\/app\//);
  await page.getByRole('button', { name: /Identité de la station/ }).click();
  await page.getByLabel('Nom de la station *').fill('Station mise à jour');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Identité de la station enregistrée.')).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').station?.name, STATE)).toBe('Station mise à jour');
  await expect(other.getByText(/Les données ont changé dans un autre onglet/)).toBeVisible();
  await expect(other.getByText(/changements restés en mémoire/)).toBeVisible();
  expect(await other.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').station?.name, STATE)).toBe('Station mise à jour');
});

test('réinitialisation locale confirmée : les deux clés sont effacées sans réécriture tardive', async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').products?.length ?? 0, STATE)).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Paramètres', exact: true }).click();
  await page.getByRole('button', { name: 'Réinitialiser la démonstration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Effacer les données de démonstration ?' });
  await expect(dialog.getByText(/Téléchargez et vérifiez d’abord une copie/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Tout effacer' }).click();
  await expect(page).toHaveURL(/\/(?:connexion)?$/);
  await expect.poll(() => page.evaluate(({ state, passwords }) => [localStorage.getItem(state), localStorage.getItem(passwords)],
    { state: STATE, passwords: PASSWORDS })).toEqual([null, null]);
  await page.reload();
  expect(await page.evaluate(({ state, passwords }) => [localStorage.getItem(state), localStorage.getItem(passwords)],
    { state: STATE, passwords: PASSWORDS })).toEqual([null, null]);
});

test('réinitialisation interrompue : pas de faux succès et octets précédents restaurés', async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').products?.length ?? 0, STATE)).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Paramètres', exact: true }).click();
  const before = await page.evaluate(({ state, passwords }) => [localStorage.getItem(state), localStorage.getItem(passwords)],
    { state: STATE, passwords: PASSWORDS });
  await page.evaluate((key) => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      if (k === key) throw new DOMException('interdit', 'SecurityError');
      return original.call(this, k);
    };
  }, PASSWORDS);
  await page.getByRole('button', { name: 'Réinitialiser la démonstration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Effacer les données de démonstration ?' });
  await dialog.getByRole('button', { name: 'Tout effacer' }).click();
  await expect(page.getByText(/Réinitialisation non confirmée/)).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Données locales de démonstration effacées.')).toHaveCount(0);
  expect(await page.evaluate(({ state, passwords }) => [localStorage.getItem(state), localStorage.getItem(passwords)],
    { state: STATE, passwords: PASSWORDS })).toEqual(before);
});
