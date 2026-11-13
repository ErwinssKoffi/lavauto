import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const verify = require('../../scripts/verify-env.cjs') as {
  DEFAULT_PROJECT_REF: string;
  analyzeEnv: (env: Record<string, string | undefined>, options?: { production?: boolean; expectedRef?: string }) => {
    errors: string[];
    warnings: string[];
    facts: Record<string, unknown>;
    expectedUrl: string;
  };
  describeKey: (key: string) => string;
  expectedUrl: (options?: { expectedRef?: string }) => string;
  parseDotEnv: (text: string) => Record<string, string>;
  scanBundle: (dir: string, options?: { requireUrl?: boolean }) => {
    errors: string[];
    warnings: string[];
    refs: Map<string, number>;
    files: number;
  };
};

const REF = 'cgxrqorwmmcyqescatzs';
const URL = `https://${REF}.supabase.co`;
const PUBLISHABLE = 'sb_publishable_test-0000000000000000000000';

describe('câblage runtime Supabase', () => {
  it('vise par défaut le projet unique documenté', () => {
    expect(verify.DEFAULT_PROJECT_REF).toBe(REF);
    expect(verify.expectedUrl()).toBe(URL);
  });

  it('accepte la cible exacte avec une clé publishable', () => {
    const result = verify.analyzeEnv({
      VITE_DATA_SOURCE: 'supabase',
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_ANON_KEY: PUBLISHABLE,
    });
    expect(result.errors).toEqual([]);
    expect(result.facts.mode).toBe('supabase');
    expect(result.facts.projectRef).toBe(REF);
  });

  it('refuse un autre projet Supabase', () => {
    const result = verify.analyzeEnv({
      VITE_DATA_SOURCE: 'supabase',
      VITE_SUPABASE_URL: 'https://ulgmjhnvsjovkjfegirl.supabase.co',
      VITE_SUPABASE_ANON_KEY: PUBLISHABLE,
    });
    expect(result.errors.join(' ')).toMatch(/ulgmjhnvsjovkjfegirl/);
    expect(result.errors.join(' ')).toMatch(new RegExp(REF));
  });

  it('refuse une clé secrète ou un JWT service_role', () => {
    const secret = verify.analyzeEnv({
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_ANON_KEY: 'sb_secret_do-not-ship',
    });
    expect(secret.errors.join(' ')).toMatch(/sb_secret_/);

    const payload = Buffer.from(JSON.stringify({ role: 'service_role', ref: REF })).toString('base64url');
    const jwt = `header.${payload}.signature`;
    const service = verify.analyzeEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: jwt });
    expect(service.errors.join(' ')).toMatch(/service_role/);
  });

  it('accepte une clé anon JWT rattachée au bon projet', () => {
    const payload = Buffer.from(JSON.stringify({ role: 'anon', ref: REF })).toString('base64url');
    const result = verify.analyzeEnv({
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_ANON_KEY: `header.${payload}.signature`,
    });
    expect(result.errors).toEqual([]);
    expect(result.facts.keyDescription).toMatch(/anon/);
  });

  it('exige URL et clé en mode supabase, sans repli silencieux', () => {
    const result = verify.analyzeEnv({ VITE_DATA_SOURCE: 'supabase' });
    expect(result.errors).toHaveLength(2);
  });

  it('laisse le mode local sans configuration valide et signale la cible dormante', () => {
    expect(verify.analyzeEnv({}).errors).toEqual([]);
    const dormant = verify.analyzeEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: PUBLISHABLE });
    expect(dormant.errors).toEqual([]);
    expect(dormant.warnings.join(' ')).toMatch(/local/);
  });

  it('refuse un bucket ou une constante de test hors harnais', () => {
    expect(verify.analyzeEnv({ VITE_SUPABASE_STORAGE_BUCKET: 'public' }).errors.join(' ')).toMatch(/station-assets/);
    expect(verify.analyzeEnv({ VITE_WG_TEST_AUTH: '1' }, { production: true }).errors.join(' ')).toMatch(/production/);
  });

  it('refuse une variable de secret dans le préfixe VITE_', () => {
    const result = verify.analyzeEnv({ VITE_SUPABASE_SERVICE_ROLE_KEY: 'x' });
    expect(result.errors.join(' ')).toMatch(/interdite/);
  });

  it('n’affiche jamais la clé, seulement une empreinte', () => {
    const description = verify.describeKey(PUBLISHABLE);
    expect(description).not.toContain(PUBLISHABLE);
    expect(description).toMatch(/sha256:[0-9a-f]{12}/);
  });

  describe('bundle produit', () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    const bundle = (name: string, content: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'wg-bundle-'));
      dirs.push(dir);
      writeFileSync(join(dir, name), content);
      return dir;
    };

    it('accepte un bundle qui ne contient que le projet cible', () => {
      const dir = bundle('app.js', `const url = "${URL}";`);
      const result = verify.scanBundle(dir, { requireUrl: true });
      expect(result.errors).toEqual([]);
      expect([...result.refs.keys()]).toEqual([REF]);
    });

    it('refuse un bundle qui vise un autre projet', () => {
      const dir = bundle('app.js', 'const url = "https://ulgmjhnvsjovkjfegirl.supabase.co";');
      expect(verify.scanBundle(dir).errors.join(' ')).toMatch(/ulgmjhnvsjovkjfegirl/);
    });

    it('refuse une clé secrète ou un JWT privilégié', () => {
      const payload = Buffer.from(JSON.stringify({ role: 'service_role', ref: REF })).toString('base64url');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const signature = 'c2lnbmF0dXJlLTEyMzQ1Njc4OTA';
      const dir = bundle('app.js', `const k = "${header}.${payload}.${signature}"; const s = "sb_secret_abcdefghijklmnopqrstuvwxyz";`);
      const errors = verify.scanBundle(dir).errors.join(' ');
      expect(errors).toMatch(/service_role/);
      expect(errors).toMatch(/sb_secret_/);
    });

    it('exige l’URL cible quand le mode connecté est demandé', () => {
      const dir = bundle('app.js', 'const mode = "local";');
      expect(verify.scanBundle(dir, { requireUrl: true }).errors.join(' ')).toMatch(/aucune URL/);
    });
  });

  it('lit un fichier .env minimal sans dépendance', () => {
    const parsed = verify.parseDotEnv([
      '# commentaire',
      `VITE_SUPABASE_URL = "${URL}"`,
      "VITE_DATA_SOURCE=local",
      'VITE_WG_TEST_AUTH=',
    ].join('\n'));
    expect(parsed.VITE_SUPABASE_URL).toBe(URL);
    expect(parsed.VITE_DATA_SOURCE).toBe('local');
    expect(parsed.VITE_WG_TEST_AUTH).toBe('');
  });
});
