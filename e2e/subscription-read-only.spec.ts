import { expect, test } from '@playwright/test';
import { journeyState, savedState, seedJourney } from './fixtures/journey';
import { baseState } from './fixtures/state';

test('quota local d’essai : trois comptes avec le propriétaire, pas de quatrième', async ({ page }) => {
  test.setTimeout(60_000);
  await seedJourney(page, journeyState()); // Propriétaire + un collaborateur actifs.
  await page.goto('/app/employes');
  await expect(page.getByPlaceholder('Barème station').first()).toBeEnabled();
  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un employé' });
  await invite.getByLabel('Nom complet *').fill('Troisième compte');
  await invite.getByLabel('Adresse e-mail *').fill('troisieme@test.invalid');
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0);
  await expect.poll(async () => (await savedState(page)).users.filter((u) => u.active).length).toBe(3);

  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  await invite.getByLabel('Nom complet *').fill('Quatrième compte');
  await invite.getByLabel('Adresse e-mail *').fill('quatrieme@test.invalid');
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByText('Quota de comptes actifs atteint (propriétaire inclus).')).toBeVisible();
  await expect(invite).toBeVisible();
  expect((await savedState(page)).users.filter((u) => u.active)).toHaveLength(3);
  await invite.getByRole('button', { name: 'Annuler' }).click();
  await expect(invite).toHaveCount(0);

  // Retenir la sauvegarde permet de vérifier que le succès de révocation n'est
  // pas annoncé avant la confirmation du stockage local.
  await expect(page.getByText('Enregistrement local en cours')).toHaveCount(0);
  await page.evaluate(() => {
    const hooks = window as unknown as { wgLockHeld?: boolean; wgReleaseLock?: () => void };
    void navigator.locks.request('washguard.demo-storage.v1', async () => {
      hooks.wgLockHeld = true;
      await new Promise<void>((resolve) => { hooks.wgReleaseLock = resolve; });
    });
  });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { wgLockHeld?: boolean }).wgLockHeld))).toBe(true);
  const invitations = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Expire le' }) });
  await invitations.getByRole('row').filter({ hasText: 'troisieme@test.invalid' }).getByTitle('Révoquer').click();
  const confirmation = page.getByRole('dialog', { name: 'Révoquer l’invitation' });
  await expect(confirmation).toContainText('désactive aussi son accès');
  await confirmation.getByRole('button', { name: 'Révoquer et désactiver' }).click();
  await expect(page.getByText('Enregistrement local en cours')).toBeVisible();
  expect((await savedState(page)).users.find((u) => u.email === 'troisieme@test.invalid')?.active).toBe(true);
  // Le dialogue peut se fermer sur la mise à jour optimiste, mais le succès
  // ne doit être annoncé qu'après confirmation effective du stockage.
  await expect(page.getByText('Invitation révoquée et accès du compte désactivé.')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { wgReleaseLock: () => void }).wgReleaseLock());
  await expect.poll(() => page.evaluate(async () => {
    const locks = await navigator.locks.query();
    return [...(locks.held ?? []), ...(locks.pending ?? [])].filter((lock) => lock.name === 'washguard.demo-storage.v1').length;
  })).toBe(0);
  await expect(confirmation).toHaveCount(0);
  await expect.poll(async () => (await savedState(page)).users.find((u) => u.email === 'troisieme@test.invalid')?.active).toBe(false);
  await expect(page.getByText('Invitation révoquée et accès du compte désactivé.')).toBeVisible();
  await expect(invitations.getByRole('row').filter({ hasText: 'troisieme@test.invalid' })).toContainText('Révoquée');

  await page.getByRole('button', { name: 'Inviter un employé' }).click();
  await invite.getByLabel('Nom complet *').fill('Quatrième compte');
  await invite.getByLabel('Adresse e-mail *').fill('quatrieme@test.invalid');
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(invite).toHaveCount(0);
  await expect.poll(async () => (await savedState(page)).users.filter((u) => u.active).length).toBe(3);
  expect((await savedState(page)).users.find((u) => u.email === 'troisieme@test.invalid')?.active).toBe(false);
  await expect(page.getByText('Enregistrement local en cours')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const locks = await navigator.locks.query();
    return { held: locks.held?.length ?? 0, pending: locks.pending?.length ?? 0 };
  })).toEqual({ held: 0, pending: 0 });
});

test('essai local expiré : lecture conservée et choix sans activation', async ({ page }) => {
  test.setTimeout(60_000);
  const state = baseState();
  await seedJourney(page, { ...state, subscription: { ...(state.subscription as Record<string, unknown>),
    startedAt: '2026-01-01T00:00:00Z', trialEndsAt: '2026-01-15T00:00:00Z' } });
  await page.goto('/app/clients');
  await expect(page.getByText('Abonnement en lecture seule.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nouveau client' })).toBeDisabled();
  await page.getByText('Client Test', { exact: true }).click();
  const client = page.getByRole('dialog', { name: 'Client Test' });
  await expect(client.getByLabel('Nom', { exact: true })).toHaveValue('Client Test');
  await expect(client.getByLabel('Nom', { exact: true })).toBeDisabled();
  await expect(client.getByRole('button', { name: 'Enregistrer la fiche' })).toBeDisabled();

  await page.goto('/app/lavages');
  await expect(page.getByRole('button', { name: 'Nouvelle fiche' })).toBeDisabled();
  await expect(page.getByRole('row').filter({ hasText: '1234 AB 01' })).toContainText('L-0001');
  await page.goto('/app/caisse');
  await expect(page.getByRole('button', { name: 'Clôturer avec comptage' })).toBeDisabled();
  await page.goto('/app/depenses');
  await expect(page.getByRole('button', { name: 'Nouvelle dépense' })).toBeDisabled();
  await expect(page.getByText('Shampoing', { exact: true })).toBeVisible();

  await page.goto('/app/abonnement');
  await expect(page.getByText('Essai expiré · lecture seule').first()).toBeVisible();
  await page.getByRole('button', { name: 'Noter Standard localement' }).click();
  await expect(page.getByText(/Choix local non transmis/)).toBeVisible();
  await expect.poll(async () => (await savedState(page)).subscription?.pendingPlanId).toBe('standard');
  await page.reload();
  await expect(page.getByText('Essai expiré · lecture seule').first()).toBeVisible();
  const saved = await savedState(page);
  expect(saved.subscription?.planId).toBe('essai');
  expect(saved.subscription?.pendingPlanId).toBe('standard');
  expect(saved.clients).toHaveLength(1);
  expect(saved.washes).toHaveLength(1);
  expect(saved.expenses).toHaveLength(1);
});

test('alerte de stock et activation restent consultables sans modification après expiration', async ({ page }) => {
  const state = baseState();
  await seedJourney(page, { ...state,
    station: { ...(state.station as Record<string, unknown>), activated: false, activatedAt: null },
    subscription: { ...(state.subscription as Record<string, unknown>), trialEndsAt: '2026-01-15T00:00:00Z' },
    products: [{ id: 'prod1', stationId: 'st1', name: 'Shampoing test', sku: 'TEST', category: '', unit: 'Litre', reorderLevel: 10, averageCostMinor: 1000, active: true }],
    stockLevels: [{ productId: 'prod1', stationId: 'st1', name: 'Shampoing test', unit: 'Litre', reorderLevel: 10, qtyOnHand: 4, averageCostMinor: 1000, valueMinor: 4000 }],
  });
  await page.goto('/app/mise-en-route');
  const banner = page.getByRole('alert').filter({ hasText: 'Alerte stock critique' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /Voir les niveaux/ }).click();
  await expect(banner.getByText('Shampoing test', { exact: true })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Simuler un réapprovisionnement de 5 Litre pour Shampoing test' })).toBeDisabled();
  await expect(banner.getByRole('link', { name: 'Gérer le stock' })).toBeVisible();
  await page.getByRole('button', { name: /Activation de la station/ }).click();
  await expect(page.getByText('Les sept étapes obligatoires sont constatées sur vos données.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activer la station' })).toBeDisabled();
  const saved = await savedState(page);
  expect(saved.station?.activated).toBe(false);
  expect(saved.stockLevels?.find((level) => level.productId === 'prod1')?.qtyOnHand).toBe(4);
});
