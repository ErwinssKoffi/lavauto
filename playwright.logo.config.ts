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
  webServer: {
    command: 'VITE_DATA_SOURCE=supabase VITE_SUPABASE_URL=https://logo-test.supabase.invalid VITE_SUPABASE_ANON_KEY=public-test-key VITE_SUPABASE_STORAGE_BUCKET=station-assets VITE_WG_TEST_AUTH= npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
