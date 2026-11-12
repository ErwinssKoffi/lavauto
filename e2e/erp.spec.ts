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
  await expect(page.getByText('Boilerplate Code for Your Next.js Project with Tailwind CSS').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /connexion/i }).first()).toBeVisible();
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
  await expect(page.getByText('15 parcours E2E').first()).toBeVisible();
});

test('15 — Back-office super admin', async ({ page }) => {
  await open(page, '/app/plateforme', adminState());
  await expect(page.getByText('Espace plateforme').first()).toBeVisible();
  await expect(page.getByText('Formules et limites administrables').first()).toBeVisible();
});
