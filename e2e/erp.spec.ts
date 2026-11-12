import { expect, test, type Page } from '@playwright/test';
import { adminState, baseState } from './fixtures/state';

interface Bridge {
  __WG_TEST_SESSION__?: { session?: unknown };
}

async function seed(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((injected) => {
    localStorage.setItem('washguard.state.v1', JSON.stringify(injected));
    localStorage.setItem('washguard.theme', 'dark');
    (window as unknown as Bridge).__WG_TEST_SESSION__ = {
      session: (injected as { session?: unknown }).session ?? null,
    };
  }, state);
}

async function open(page: Page, route: string, state: Record<string, unknown> | null): Promise<void> {
  await seed(page, state ?? { ...baseState(), session: null });
  await page.goto(route, { waitUntil: 'domcontentloaded' });
}

test('01 — Vitrine publique et CTA', async ({ page }) => {
  await open(page, '/', null);
  await expect(page.getByRole('heading', { level: 1, name: /Pilotez vos lavages, vos stocks et vos équipes/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /connexion/i }).first()).toHaveAttribute('href', '/connexion');
  const register = page.getByRole('link', { name: 'Créer mon compte' });
  await expect(register).toHaveAttribute('href', '/inscription');
  await expect(page.locator('#tarifs')).toContainText('15 000 FCFA');
  await expect(page.getByText('Aperçu d’une station — données fictives')).toBeVisible();
  await expect(page.getByText('Témoignages Clients')).toHaveCount(0);
  await register.click();
  await expect(page).toHaveURL(/\/inscription$/);
});

test('02 — Connexion', async ({ page }) => {
  await open(page, '/connexion', null);
  await expect(page.getByText('Bonjour').first()).toBeVisible();
});

test('03 — Inscription en deux temps', async ({ page }) => {
  await open(page, '/inscription', null);
  await expect(page.getByText('Votre entreprise et sa station').first()).toBeVisible();
});

test('04 — Tableau de bord station', async ({ page }) => {
  await open(page, '/app/tableau-de-bord', baseState());
  await expect(page.getByText('Tableau de bord').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /consolidation/i }).first()).toBeVisible();
});

test('05 — Mise en route constatée', async ({ page }) => {
  await open(page, '/app/mise-en-route', baseState());
  await expect(page.getByText('Mise en route').first()).toBeVisible();
});

test('06 — File de lavages', async ({ page }) => {
  await open(page, '/app/lavages', baseState());
  await expect(page.getByText('File d’attente par statut').first()).toBeVisible();
});

test('07 — Grille tarifaire', async ({ page }) => {
  await open(page, '/app/prestations', baseState());
  await expect(page.getByText('Grille tarifaire').first()).toBeVisible();
});

test('08 — Fiche client', async ({ page }) => {
  await open(page, '/app/clients', baseState());
  await expect(page.getByText('Client Test').first()).toBeVisible();
});

test('09 — Employés et rôles', async ({ page }) => {
  await open(page, '/app/employes', baseState());
  await expect(page.getByText('Employés').first()).toBeVisible();
});

test('10 — Caisse et clôture', async ({ page }) => {
  await open(page, '/app/caisse', baseState());
  await expect(page.getByText('Historique des caisses').first()).toBeVisible();
});

test('11 — Dépenses', async ({ page }) => {
  await open(page, '/app/depenses', baseState());
  await expect(page.getByText('Dépenses').first()).toBeVisible();
});

test('12 — Rapports et export CSV', async ({ page }) => {
  await open(page, '/app/rapports', baseState());
  await expect(page.getByText('Rapports').first()).toBeVisible();
});

test('13 — Consolidation multi-stations', async ({ page }) => {
  await open(page, '/app/consolidation', baseState());
  await expect(page.getByText('Consolidation multi-stations').first()).toBeVisible();
  await expect(page.getByText('Comparaison des périodes').first()).toBeVisible();
});

test('14 — Qualité & déploiement', async ({ page }) => {
  await open(page, '/app/qualite', baseState());
  await expect(page.getByText('Qualité & déploiement').first()).toBeVisible();
  await expect(page.getByText('22 parcours E2E').first()).toBeVisible();
});

test('15 — Back-office super admin', async ({ page }) => {
  await open(page, '/app/plateforme', adminState());
  await expect(page.getByText('Espace plateforme').first()).toBeVisible();
  await expect(page.getByText('Formules et limites administrables').first()).toBeVisible();
});

test('16 — Logo privé : mode local et parcours de mise en route', async ({ page }) => {
  await open(page, '/app/parametres', baseState());
  const picker = page.getByLabel('Choisir un fichier logo');
  await expect(picker).toBeDisabled();
  await expect(picker).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
  await expect(page.getByText(/indisponible en mode local/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le logo' })).toBeDisabled();
  await expect(page.locator('input[type="url"]')).toHaveCount(0);

  await page.goto('/app/mise-en-route');
  await page.getByRole('button', { name: /Logo de la station/ }).click();
  await expect(page.getByLabel('Choisir un fichier logo')).toBeDisabled();
  await expect(page.locator('input[type="url"]')).toHaveCount(0);
});

test('17 — Simulations de stock identifiées et limitées au navigateur local', async ({ page }) => {
  const product = {
    id: 'product-1', stationId: 'st1', categoryId: null, sku: 'SH-1', name: 'Shampoing test',
    category: 'Consommables', unit: 'L', reorderLevel: 3, averageCostMinor: 100, active: true,
  };
  const level = {
    productId: product.id, stationId: 'st1', name: product.name, unit: product.unit,
    reorderLevel: 3, qtyOnHand: 2, averageCostMinor: 100, valueMinor: 200,
  };
  await open(page, '/app/parametres', {
    ...baseState(), demoMode: false, products: [product], stockLevels: [level], stockMovements: [],
  });
  const settings = page.locator('#stock');
  await expect(settings.getByText(/Démonstration locale/)).toBeVisible();
  await expect(settings.getByText(/Aucun mouvement n’est envoyé au serveur/)).toBeVisible();
  await settings.getByRole('button', { name: 'Simuler une consommation de 1 L pour Shampoing test' }).click();
  await expect(settings.getByText('1 L', { exact: true }).first()).toBeVisible();

  const banner = page.getByRole('alert').filter({ hasText: 'Alerte stock critique' });
  await banner.getByRole('button', { name: /Voir les niveaux/ }).click();
  await expect(banner.getByText(/simulation locale/)).toBeVisible();
  await banner.getByRole('button', { name: 'Simuler un réapprovisionnement de 5 L pour Shampoing test' }).click();
  await expect(banner).toHaveCount(0);
  await expect(settings.getByText('6 L', { exact: true })).toBeVisible();

  const threshold = settings.getByLabel('Seuil critique (L)');
  await threshold.fill('8');
  await threshold.blur();
  await expect(page.getByRole('alert').filter({ hasText: 'Alerte stock critique' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('washguard.state.v1')!);
    return {
      qty: saved.stockLevels[0].qtyOnHand,
      threshold: saved.products[0].reorderLevel,
      references: saved.stockMovements.map((movement: { referenceType: string }) => movement.referenceType),
    };
  })).toEqual({ qty: 6, threshold: 8, references: ['quick_adjustment', 'quick_adjustment'] });
});
