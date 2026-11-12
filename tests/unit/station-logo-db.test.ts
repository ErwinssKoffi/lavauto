import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';

// PostgreSQL local en mémoire : les schémas Auth/Storage ci-dessous simulent
// leur surface SQL et leurs rôles. Les API Supabase distantes et leurs grants
// réels doivent toujours être vérifiés séparément après le déploiement.
describe('migrations 001–055 — PostgreSQL isolé', () => {
  it('vérifie les fonctions historiques puis WhatsApp en rollback', async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    try {
      await db.exec(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE SCHEMA storage;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
        CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
        $$;
        CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, "public" boolean, file_size_limit bigint, allowed_mime_types text[]);
        CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid, metadata jsonb, UNIQUE(bucket_id, name));
        CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
          SELECT (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
        $$;
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA public, auth, storage, supabase_migrations TO anon, authenticated, service_role;
        GRANT SELECT ON auth.users TO authenticated;
        GRANT SELECT ON supabase_migrations.schema_migrations TO authenticated;
        GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
      `);
      const migrationsDir = resolve('supabase/migrations');
      const files = readdirSync(migrationsDir).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
      expect(files[files.length - 1]).toBe('055_shared_form_validation.sql');
      // Les anciens scripts mesurent le schéma historique à 052. Rejouer ces
      // contrôles avant d'ajouter les trois nouvelles tables de 053.
      for (const file of files.filter((name) => name < '053_')) {
        await db.exec(readFileSync(resolve(migrationsDir, file), 'utf8'));
        await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [file.slice(0, 3)]);
      }
      const results = await db.exec(readFileSync(resolve('supabase/tests/station_logo_rollback.sql'), 'utf8'));
      const checks = results.find((result) => result.fields.some((field) => field.name === 'label'))?.rows as { label: string; ok: boolean }[] | undefined;
      expect(checks).toHaveLength(16);
      expect(checks?.filter((check) => !check.ok)).toEqual([]);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM auth.users')).rows[0].count).toBe(0);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM storage.objects')).rows[0].count).toBe(0);

      // Supabase conserve historiquement le grant SELECT de anon par le rôle
      // réservé Storage ; le simuler pour rejouer le contrôle P10 original.
      await db.exec('GRANT SELECT ON storage.objects, storage.buckets TO anon');
      const p10Results = await db.exec(readFileSync(resolve('supabase/tests/p10_rollback.sql'), 'utf8'));
      const p10Checks = p10Results.find((result) => result.fields.some((field) => field.name === 'label'))?.rows as { label: string; ok: boolean }[] | undefined;
      expect(p10Checks).toHaveLength(30);
      expect(p10Checks?.filter((check) => !check.ok)).toEqual([]);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM auth.users')).rows[0].count).toBe(0);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM storage.objects')).rows[0].count).toBe(0);

      // Les anciennes commandes et la finance restent compatibles après 052.
      // Vérifier aussi les booléens des scripts historiques qui ne lèvent pas
      // nécessairement d'erreur lorsque l'un de leurs contrôles échoue.
      for (const [file, count] of [
        ['p05_rollback.sql', 17], ['p06_rollback.sql', 32], ['atomic_wash_rollback.sql', 30],
      ] as const) {
        const results = await db.exec(readFileSync(resolve('supabase/tests', file), 'utf8'));
        const checks = results.find((result) => result.fields.some((field) => field.name === 'label'))?.rows as { label: string; ok: boolean }[] | undefined;
        expect(checks, file).toHaveLength(count);
        expect(checks?.filter((check) => !check.ok), file).toEqual([]);
        expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM auth.users')).rows[0].count, file).toBe(0);
        expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.wash_creation_requests')).rows[0].count, file).toBe(0);
      }

      await db.exec(readFileSync(resolve(migrationsDir, '053_whatsapp_wash_notifications.sql'), 'utf8'));
      await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', ['053']);
      const waResults = await db.exec(readFileSync(resolve('supabase/tests/whatsapp_wash_rollback.sql'), 'utf8'));
      const waChecks = waResults.find((result) => result.fields.some((field) => field.name === 'label'))?.rows as { label: string; ok: boolean }[] | undefined;
      expect(waChecks?.length).toBe(51);
      expect(waChecks?.filter((check) => !check.ok)).toEqual([]);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.wash_whatsapp_notifications')).rows[0].count).toBe(0);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM auth.users')).rows[0].count).toBe(0);

      for (const file of files.filter((name) => name >= '054_')) {
        await db.exec(readFileSync(resolve(migrationsDir, file), 'utf8'));
        await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [file.slice(0, 3)]);
      }
      const stationResults = await db.exec(readFileSync(resolve('supabase/tests/station_scope_rollback.sql'), 'utf8'));
      const stationChecks = stationResults.find((result) => result.fields.some((field) => field.name === 'label'))?.rows as { label: string; ok: boolean }[] | undefined;
      expect(stationChecks?.length).toBeGreaterThanOrEqual(25);
      expect(stationChecks?.filter((check) => !check.ok)).toEqual([]);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM auth.users')).rows[0].count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);
});
