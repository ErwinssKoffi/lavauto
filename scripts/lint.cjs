/* ───────────────────────────────────────────────────────────────────────────
   WashGuard — lint statique sans dépendance (TD-29 traité au Prompt 04).
   ESLint/Prettier n'étant pas installés, `npm run lint` applique les garde-fous
   non négociables du cahier des charges. Les contrôles fonctionnels restent
   dans `npm run check` ; TypeScript reste dans `npm run typecheck`.
   ─────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const srcFiles = walk(path.join(ROOT, 'src'));
const src = srcFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
const types = read('src/types.ts');
const store = read('src/lib/store.tsx');
const signIn = read('src/pages/auth/SignIn.tsx');
const signUp = read('src/pages/auth/SignUp.tsx');
const employees = read('src/pages/Employees.tsx');
const landing = read('src/pages/Landing.tsx');
const authAdapter = read('src/services/auth/SupabaseAuthAdapter.ts');
const metrics = read('src/lib/metrics.ts');
const financeState = read('src/lib/financeState.ts');
const uiPages = ['Dashboard', 'Reports', 'Commissions', 'Cash', 'Expenses', 'Washes']
  .map((f) => read('src/pages/' + f + '.tsx')).join('\n');

const rules = [
  ['aucun identifiant de tenant brut dans le frontend', () => !src.includes('company_id')],
  ['aucune clé de service exposée au bundle', () =>
    !src.includes('VITE_SUPABASE_SERVICE_ROLE') &&
    !read('.env.example').includes('VITE_SUPABASE_SERVICE_ROLE') &&
    !/(sb_secret_|service_role\s*[=:]\s*['"][^'"]+)/.test(src)],
  ['AppState et store sans mots de passe', () =>
    !/passwords\s*:/.test(types) && !/passwords\s*:/.test(store) &&
    !/passwords\s*:/.test(employees)],
  ['plus de session forgeable ni de support démo', () =>
    !src.includes('signInSupportDemo') && !/export function fetchMeOnce/.test(store) &&
    !/\.getSession\(\)/.test(authAdapter) &&
    /serializeDemoState\(state\)/.test(store) && /withDemoStorageLock/.test(store) && /onAuthStateChange/.test(store)],
  ['Auth vérifiée côté serveur', () => authAdapter.includes('auth.getUser()') &&
    authAdapter.includes("rpc('my_context')") && authAdapter.includes("rpc('my_company_users')")],
  ['mot de passe oublié réel, anciens textes retirés', () =>
    signIn.includes('/mot-de-passe-oublie') && signIn.includes('lien de réinitialisation') &&
    employees.includes('requestPasswordReset') && !employees.includes('Mot de passe provisoire') &&
    !signIn.includes('n’envoie aucun e-mail') && !signIn.includes('module Employés') &&
    !landing.includes('n’envoie aucun e-mail') && !signUp.includes('Session de 30 jours')],
  ['confirmation e-mail connectée et limites de la démo explicites', () =>
    signUp.includes('confirmationRequired') && signUp.includes('confirmation par e-mail') &&
    signUp.includes('Aucun e-mail n’est envoyé') && signUp.includes("authKind === 'local'") &&
    authAdapter.includes('emailRedirectTo') && !authAdapter.includes('mailer_autoconfirm=true')],
  ['UI pilotée par les permissions serveur', () =>
    exists('src/lib/usePermissions.ts') && read('src/lib/usePermissions.ts').includes('my_context()') &&
    read('src/components/navigation.tsx').includes('granted.includes(entry.permission)') &&
    read('src/App.tsx').includes('usePermissions') && read('src/App.tsx').includes('RoleRoute')],
  ['56 migrations locales numérotées, documentation et tests SQL en ROLLBACK', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f));
    return migrations.length === 56 && migrations.includes('057_subscription_entitlements.sql') && migrations.includes('056_station_setup_catalog.sql') && migrations.includes('052_atomic_wash_creation.sql') &&
      migrations.includes('053_whatsapp_wash_notifications.sql') &&
      migrations.includes('054_station_scope_and_metrics.sql') && migrations.includes('055_shared_form_validation.sql') &&
      exists('docs/auth-rbac.md') &&
      exists('docs/washes.md') && exists('docs/finance.md') && exists('docs/stock.md') &&
      exists('docs/crm.md') && exists('docs/analytics.md') &&
      exists('docs/installation.md') && exists('docs/architecture.md') &&
      exists('docs/security.md') && exists('docs/user-guide.md') &&
      exists('docs/deployment.md') && exists('docs/testing.md') &&
      exists('supabase/tests/p06_rollback.sql') && exists('supabase/tests/p07_rollback.sql') &&
      exists('supabase/tests/p08_rollback.sql') && exists('supabase/tests/p09_rollback.sql') &&
      exists('supabase/tests/p10_rollback.sql') && exists('supabase/tests/station_logo_rollback.sql') &&
      exists('supabase/tests/atomic_wash_rollback.sql') && exists('supabase/tests/whatsapp_wash_rollback.sql') &&
      /^BEGIN;/m.test(read('supabase/tests/station_scope_rollback.sql')) &&
      read('supabase/tests/station_scope_rollback.sql').trim().endsWith('ROLLBACK;') &&
      /^BEGIN;/m.test(read('supabase/tests/subscription_entitlements_rollback.sql')) &&
      read('supabase/tests/subscription_entitlements_rollback.sql').trim().endsWith('ROLLBACK;');
  }],
  ['P06 : aucun « Résultat simplifié » ni faux bénéfice net dans l’UI', () =>
    !uiPages.includes('Résultat simplifié') && !metrics.includes('result: collected - expenses') &&
    metrics.includes('partialBalance') && metrics.includes('netResult') &&
    financeState.includes('Couts manquants') === false &&
    read('src/lib/finance.ts').includes('resultat net non calculable avant P07')],
  ['P06 : finance par RPC, aucun tenant ni écriture directe côté frontend', () =>
    read('src/services/adapters/SupabaseFinanceCommands.ts').includes('SECURITY DEFINER') &&
    read('src/services/adapters/SupabaseFinanceCommands.ts').includes('this.client.rpc') &&
    !read('src/services/adapters/SupabaseFinanceCommands.ts').includes('company_id') &&
    !read('src/services/adapters/DataAdapter.ts').includes('company_id') &&
    read('src/lib/store.tsx').includes('financeRpc')],
  ['P06 : 029 utilise clock_timestamp() et filtre la période de réouverture', () =>
    read('supabase/migrations/029_finance_clock.sql').includes('clock_timestamp()') &&
    read('supabase/migrations/029_finance_clock.sql').includes('COALESCE(v_s.reopened_at, v_s.opened_at)') &&
    !read('supabase/migrations/025_finance_commands.sql').includes('SET DEFAULT 0')],
  ['Edge Function d’invitation sans secret versionné', () =>
    exists('supabase/functions/invite-user/index.ts') &&
    read('supabase/functions/invite-user/index.ts').includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')") &&
    !src.includes('SUPABASE_SERVICE_ROLE_KEY')],
  ['Aucun .env local suivi par Git', () => !exists('.env') && read('.gitignore').includes('.env.local')],
  ['P07 : stock par RPC, aucun identifiant de tenant ni écriture directe', () =>
    read('src/services/adapters/SupabaseStockCommands.ts').includes('this.client.rpc') &&
    !read('src/services/adapters/SupabaseStockCommands.ts').includes('company_id') &&
    !read('src/services/adapters/SupabaseStockCommands.ts').includes('.from(') &&
    read('src/lib/store.tsx').includes('stockRpc') &&
    read('src/services/adapters/SupabaseDataAdapter.ts').includes("'my_station_stock_board' : 'my_stock_board'") &&
    read('supabase/migrations/054_station_scope_and_metrics.sql').includes('PERFORM public.assert_my_station(p_station_id)')],
  ['P07 : coûts valorisés, certification obligatoire avant résultat net', () =>
    read('supabase/migrations/031_stock_commands.sql').includes('average_cost_minor') &&
    read('supabase/migrations/033_finance_cost_certification.sql').includes("'costsMissing', false") &&
    read('supabase/migrations/033_finance_cost_certification.sql').includes("'result', NULL") &&
    read('src/pages/Reports.tsx').includes('certifyCosts') &&
    read('src/pages/Reports.tsx').includes('PAS un bénéfice net') &&
    read('src/lib/finance.ts').includes('resultat net non calculable avant P07')],
  ['P07 : 2 routes réelles, plus aucune entrée « step 07 » à venir', () =>
    read('src/components/navigation.tsx').includes("to: '/app/stock'") &&
    read('src/components/navigation.tsx').includes("to: '/app/consommations'") &&
    !read('src/components/navigation.tsx').includes("upcoming: { step: '07'") &&
    read('src/App.tsx').includes('<Stock />') && read('src/App.tsx').includes('<Consumptions />')],
  ['P07 : test distant en ROLLBACK et immutabilité des relevés', () => {
    const t = read('supabase/tests/p07_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('certify_profitability_period') && t.includes('my_stock_board()') &&
      read('supabase/migrations/030_stock_foundation.sql').includes('REVOKE INSERT, UPDATE, DELETE') &&
      read('supabase/migrations/033_finance_cost_certification.sql').includes('Periode deja certifiee');
  }],
  ['P08 : CRM par RPC, aucun identifiant de tenant ni écriture directe', () =>
    read('src/services/adapters/SupabaseCrmCommands.ts').includes('this.client.rpc') &&
    !read('src/services/adapters/SupabaseCrmCommands.ts').includes('company_id') &&
    !read('src/services/adapters/SupabaseCrmCommands.ts').includes('.from(') &&
    read('src/lib/store.tsx').includes('crmRpc') &&
    read('src/services/adapters/SupabaseDataAdapter.ts').includes("'my_station_crm_board' : 'my_crm_board'") &&
    read('src/lib/permissionCatalog.ts').includes("'/app/fidelisation': 'crm.view'")],
  ['P08 : 2 routes réelles et fiche client enrichie, plus aucune entrée « step 08 »', () =>
    read('src/components/navigation.tsx').includes("to: '/app/fidelisation'") &&
    read('src/components/navigation.tsx').includes("to: '/app/flottes'") &&
    !read('src/components/navigation.tsx').includes("upcoming: { step: '08'") &&
    read('src/App.tsx').includes('<Fidelisation />') && read('src/App.tsx').includes('<Flottes />') &&
    read('src/pages/Clients.tsx').includes('Canal préféré') &&
    read('src/pages/Fidelisation.tsx').includes('aucun fournisseur')],
  ['P08 : promotion jamais appliquée deux fois, correctif 038 avant quota', () => {
    const s034 = read('supabase/migrations/034_crm_foundation.sql');
    const s038 = read('supabase/migrations/038_promotion_idempotency_order.sql');
    return !s034.includes('crm_idempotency_key') &&
      s038.includes('CREATE OR REPLACE FUNCTION public.apply_promotion_to_wash(') &&
      s038.indexOf('v_key := NULLIF') < s038.indexOf("RAISE EXCEPTION 'Quota") &&
      read('supabase/tests/p08_rollback.sql').includes('jamais appliquee deux fois');
  }],
  ['P08 : file de notifications sans fournisseur ni envoi simulé', () => {
    const s037 = read('supabase/migrations/037_crm_notifications.sql');
    const board = read('supabase/migrations/036_crm_board.sql');
    return s037.includes('aucun envoi') && !/sent_at|provider|sent_by|api_key/i.test(s037) &&
      board.includes('aucun envoi simule') && board.includes('STABLE SECURITY DEFINER') &&
      read('src/lib/crmState.ts').includes('cancelPendingNotificationLocal');
  }],
  ['P08 : test distant en ROLLBACK et 0 fixture', () => {
    const t = read('supabase/tests/p08_rollback.sql');
    return /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p08_result') &&
      t.includes('isolation A/B') && t.includes('my_crm_board()');
  }],
  ['P09 : analytics, quotas serveur, Recharts, back-office et test distant', () => {
    const nav = read('src/components/navigation.tsx');
    const app = read('src/App.tsx');
    const adapter = read('src/services/adapters/DataAdapter.ts');
    const commands = read('src/services/adapters/SupabaseAnalyticsCommands.ts');
    const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
      .filter((f) => f.startsWith('039_') || /^04[0-4]_/.test(f));
    const t = read('supabase/tests/p09_rollback.sql');
    return migrations.length === 6 &&
      nav.includes("to: '/app/consolidation'") && !nav.includes("upcoming: { step: '09'") &&
      app.includes('<Consolidation />') &&
      read('src/pages/Consolidation.tsx').includes("from 'recharts'") &&
      read('src/pages/Dashboard.tsx').includes("from 'recharts'") &&
      adapter.includes('listAnalyticsBoard') && adapter.includes('listPlatformBoard') &&
      commands.includes("this.call('admin_set_plan_limit'") &&
      commands.includes('this.client.rpc(name, args)') && !commands.includes('company_id') &&
      read('supabase/migrations/040_quota_guard.sql').includes('assert_subscription_limit') &&
      read('supabase/migrations/041_analytics_board.sql').includes("'grossMargin', NULL") &&
      read('src/pages/Platform.tsx').includes('hypothèses commerciales') &&
      /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p09_result') &&
      t.includes('quota : 3e lavage refuse 23514');
  }],
  ['WhatsApp : secrets serveur, RPC utilisateur, webhook HMAC et reçu local', () => {
    const wa = read('supabase/functions/_shared/whatsapp.ts');
    const commands = read('src/services/adapters/SupabaseWhatsappCommands.ts');
    const config = read('supabase/config.toml');
    return !/META_ACCESS_TOKEN|META_APP_SECRET|META_VERIFY_TOKEN|WHATSAPP_DISPATCH_SECRET/.test(src) &&
      commands.includes('this.client.rpc(name, args)') && !commands.includes('company_id') && !commands.includes('.from(') &&
      wa.includes('crypto.subtle.verify') && wa.includes("val(env, 'WHATSAPP_SEND_ENABLED') !== 'true'") &&
      config.includes('[functions.whatsapp-webhook]\nverify_jwt = false') &&
      config.includes('[functions.whatsapp-dispatch]\nverify_jwt = false') &&
      exists('public/fonts/DejaVuSans.ttf') && exists('docs/whatsapp-receipts.md') &&
      read('src/lib/receiptPdf.ts').includes("await import('jspdf')");
  }],
  ['P10 : QA, Storage privé, pagination, Playwright, CI/CD et 7 documents', () => {
    const nav = read('src/components/navigation.tsx');
    const app = read('src/App.tsx');
    const p10Migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
      .filter((f) => /^04(5|6|7|9)_|^050_/.test(f));
    const docs = ['installation', 'architecture', 'database', 'security', 'user-guide', 'deployment', 'testing'];
    const t = read('supabase/tests/p10_rollback.sql');
    return p10Migrations.length === 5 && docs.every((d) => exists('docs/' + d + '.md')) &&
      nav.includes("to: '/app/qualite'") && !nav.includes("upcoming: { step: '10'") &&
      app.includes('<Quality />') && app.includes('React.lazy') && app.includes('React.Suspense') &&
      read('src/lib/permissionCatalog.ts').includes("'/app/qualite': 'reports.view'") &&
      read('src/lib/network.ts').includes('withRetry') &&
      read('src/lib/qa.ts').includes('optimizeStationLogo') &&
      exists('src/lib/image.ts') && read('src/lib/image.ts').includes('LOGO_MAX_EDGE') &&
      !read('src/lib/qa.ts').includes('company_id') &&
      read('supabase/migrations/046_storage_foundation.sql').includes("'station-assets'") &&
      read('supabase/migrations/049_storage_rls_guard.sql').includes('p10_anon_objects_deny') &&
      read('supabase/migrations/050_storage_rls_restrictive.sql').includes('AS RESTRICTIVE') &&
      exists('playwright.config.ts') && exists('vitest.config.ts') &&
      exists('e2e/erp.spec.ts') && exists('vercel.json') &&
      exists('.github/workflows/ci.yml') && exists('.github/workflows/deploy.yml') &&
      /BEGIN;/.test(t) && t.trim().endsWith('ROLLBACK;') &&
      t.includes('SELECT label, ok, detail FROM p10_result');
  }],
];

let failures = 0;
console.log('[lint] Garde-fous statiques WashGuard');
for (const [label, predicate] of rules) {
  let ok = false;
  try { ok = Boolean(predicate()); } catch (error) { console.error('  ↳', error.message); }
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
}
if (failures) {
  console.error(`\n${failures} règle(s) en échec.`);
  process.exit(1);
}
console.log(`\n${rules.length} règles OK · P10 : QA, Storage, Playwright, CI/CD et déploiement.`);
