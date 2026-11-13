import { defineConfig } from '@playwright/test';

// Le serveur utilise un faux hôte Supabase intercepté par Playwright : aucune
// requête, session, fixture ou donnée n'est créée sur un projet distant.
export default defineConfig({
  testDir: './e2e-connected',
  outputDir: './test-results',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  // Les échecs restent lisibles dans les annotations GitHub même lorsque les
  // journaux d'exécution ne peuvent pas être téléchargés depuis le sandbox.
  reporter: process.env.GITHUB_ACTIONS ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    // Ne pas dépendre du réseau Google Fonts dans les parcours fonctionnels.
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: [
        '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? [
          '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
          '--disable-site-isolation-trials', '--disable-web-security',
          '--allow-running-insecure-content',
          '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
          // Le binaire de secours se fige parfois avec SwiftShader ; le rendu
          // logiciel sans GPU conserve les captures et la séparation des tests.
          '--enable-features=SharedArrayBuffer', '--disable-gpu',
        ] : []),
      ],
    },
  },
  webServer: {
    command: 'VITE_DATA_SOURCE=supabase VITE_SUPABASE_URL=https://logo-test.supabase.invalid VITE_SUPABASE_ANON_KEY=public-test-key VITE_SUPABASE_STORAGE_BUCKET=station-assets VITE_WG_TEST_AUTH= npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
