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
    // Secours local : permet d'utiliser un binaire Chromium fourni par
    // l'environnement quand le telechargement Playwright est bloque.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
      args: [
        '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
        '--disable-site-isolation-trials', '--disable-web-security',
        '--allow-running-insecure-content',
        '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
        '--enable-features=SharedArrayBuffer', '--ignore-gpu-blocklist',
        '--in-process-gpu', '--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    } : undefined,
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
