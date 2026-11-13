import { expect, test, type Route } from '@playwright/test';
import { fakePlanRows, fakeStationSetup, fakeSubscriptionAccess } from './fixtures/mock-supabase';

const company = '11111111-1111-4111-8111-111111111111';
const station = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const email = 'owner@test.invalid';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a/8AAAAASUVORK5CYII=', 'base64');
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
};
const now = new Date().toISOString();
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: now, app_metadata: {}, user_metadata: {}, created_at: now };
const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(data) });
}

test('un logo privé est associé, retrouvé après rechargement, remplacé et retiré', async ({ page }) => {
  let savedPath: string | null = null;
  let uploads = 0;
  let signatures = 0;
  let userReads = 0;
  let failUpload = false;
  let failSave = false;
  const objects = new Set<string>();

  await page.route('https://logo-test.supabase.invalid/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/auth/v1/token') {
      return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, refresh_token: 'refresh-test', user });
    }
    if (url.pathname === '/auth/v1/user') { userReads += 1; return json(route, user); }
    if (url.pathname === '/rest/v1/plans') return json(route, fakePlanRows());
    if (url.pathname === '/rest/v1/rpc/my_subscription_access') return json(route, fakeSubscriptionAccess(company));
    if (url.pathname === '/rest/v1/rpc/my_context') return json(route, {
      authenticated: true, profileReady: true, active: true, userId, email, fullName: 'Propriétaire', roleKey: 'owner', isPlatformAdmin: false,
      companyId: company, company: { id: company, name: 'Entreprise', city: 'Abidjan', phone: '', currency_code: 'XOF', suspended: false, created_at: now },
      stations: [{ id: station, name: 'Station A', city: 'Abidjan', activated: true, logoPath: savedPath }],
      permissions: ['settings.manage', 'washes.view', 'employees.manage'],
    });
    if (url.pathname === '/rest/v1/rpc/my_station_setup') return json(route, fakeStationSetup(savedPath));
    if (url.pathname === '/rest/v1/rpc/my_company_users') return json(route, [{ id: userId, fullName: 'Propriétaire', email, roleKey: 'owner', active: true, stationIds: [station] }]);
    if (url.pathname === '/rest/v1/rpc/my_company_invitations') return json(route, []);
    if (url.pathname === '/rest/v1/rpc/claim_rpc_idempotency') return json(route, { firstCall: true });
    if (url.pathname === '/rest/v1/rpc/station_asset_path') return json(route, `${company}/${request.postDataJSON().p_filename}`);
    if (url.pathname === '/rest/v1/rpc/save_station_logo') {
      if (failSave) return json(route, { code: '42501', message: 'Permission refusée' }, 403);
      const data = request.postDataJSON() as { p_station_id: string; p_path: string | null };
      expect(data.p_station_id).toBe(station);
      if (data.p_path !== null) expect(objects.has(data.p_path)).toBe(true);
      savedPath = data.p_path;
      return json(route, null);
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/station-assets/')) {
      if (request.method() === 'GET') return route.fulfill({ status: 200, headers, contentType: 'image/png', body: png });
      const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/station-assets/'.length));
      expect(objects.has(path)).toBe(true);
      expect(request.postDataJSON().expiresIn).toBe(3600);
      signatures += 1;
      return json(route, { signedURL: `/object/sign/station-assets/${path}?token=temporary-${signatures}` });
    }
    if (url.pathname.startsWith('/storage/v1/object/station-assets/')) {
      uploads += 1;
      if (failUpload) return json(route, { message: 'Upload refusé', statusCode: '403' }, 403);
      const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/station-assets/'.length));
      objects.add(path);
      return json(route, { Key: `station-assets/${path}` });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/my_wash_') || url.pathname === '/rest/v1/rpc/my_company_clients') return json(route, []);
    if (url.pathname.startsWith('/rest/v1/rpc/')) return json(route, {});
    if (url.pathname.startsWith('/rest/v1/')) return json(route, []);
    return json(route, {});
  });

  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: /Se connecter/ }).click();
  await page.waitForURL(/\/app\//);
  await page.goto('/app/parametres');

  const editor = page.getByRole('region', { name: 'Logo de la station' });
  const picker = editor.getByLabel('Choisir un fichier logo');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from('gif') });
  await expect(editor.getByRole('alert')).toContainText('PNG, JPEG ou WebP');
  expect(uploads).toBe(0);
  await picker.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Enregistrer le logo' }).click();
  await expect(page.getByAltText('Logo actuel de la station')).toBeVisible();
  expect(savedPath).toMatch(new RegExp(`^${company}/logo-[a-z0-9-]+\\.(png|webp)$`));
  const firstPath = savedPath;
  expect(signatures).toBeGreaterThan(0);
  // Supabase peut réémettre SIGNED_IN à la réapparition de l'onglet avec le
  // contexte initial en cache. Cela ne doit pas effacer le chemin enregistré.
  const readsBeforeFocus = userReads;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => userReads).toBeGreaterThan(readsBeforeFocus);
  await expect(page.getByAltText('Logo actuel de la station')).toBeVisible();
  expect(savedPath).toBe(firstPath);
  const countBeforeReload = signatures;
  await page.reload();
  await expect(page.getByAltText('Logo actuel de la station')).toBeVisible();
  expect(signatures).toBeGreaterThan(countBeforeReload);
  // Les données métier connectées et l'URL signée restent hors du cache local.
  expect(await page.evaluate(() => localStorage.getItem('washguard.state.v1'))).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('token=temporary');

  failUpload = true;
  await picker.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Enregistrer le logo' }).click();
  await expect(editor.getByRole('alert')).toContainText('Envoi du logo');
  expect(savedPath).toBe(firstPath);
  failUpload = false;
  failSave = true;
  await page.getByRole('button', { name: 'Enregistrer le logo' }).click();
  await expect(editor.getByRole('alert')).toContainText('association à la station');
  expect(savedPath).toBe(firstPath);
  failSave = false;
  await page.getByRole('button', { name: 'Enregistrer le logo' }).click();
  await expect.poll(() => savedPath).not.toBe(firstPath);
  await expect(page.getByAltText('Logo actuel de la station')).toBeVisible();
  await page.getByRole('button', { name: 'Retirer le logo' }).click();
  await expect.poll(() => savedPath).toBeNull();
  await expect(page.getByAltText('Logo actuel de la station')).toHaveCount(0);
  expect(objects.has(firstPath!)).toBe(true);
});
