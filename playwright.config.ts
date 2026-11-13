import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER
  || 'VITE_DATA_SOURCE=local VITE_WG_TEST_AUTH=1 npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Les tests fonctionnels ne doivent pas attendre Google Fonts : ce service
    // tiers peut être inaccessible. Le navigateur utilise la police de repli.
    // Secours local : un binaire Chromium peut être fourni par l'environnement.
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: [
        '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? [
          '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
          '--disable-site-isolation-trials', '--disable-web-security',
          '--allow-running-insecure-content',
          '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
          // Ce Chromium de secours se fige à la fermeture de certains contextes
          // avec SwiftShader ; le rendu logiciel sans GPU conserve les captures.
          '--enable-features=SharedArrayBuffer', '--disable-gpu',
        ] : []),
      ],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    // Par défaut, refuser un serveur déjà présent plutôt que d'exécuter des
    // mutations sur une instance dont la source de données est inconnue.
    // Réutilisation réservée à un serveur de test local explicitement choisi.
    reuseExistingServer: !process.env.CI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1',
    timeout: 120_000,
  },
});
