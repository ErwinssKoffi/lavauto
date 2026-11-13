import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PLANS } from '../src/lib/plans';

let dbPromise: Promise<PGlite> | null = null;

function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function initSchema(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_minor INTEGER NOT NULL DEFAULT 0,
      trial_days INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      features JSONB NOT NULL DEFAULT '[]'::jsonb,
      entitlements JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS plan_limits (
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      metric_key TEXT NOT NULL,
      value_int INTEGER NOT NULL,
      PRIMARY KEY (plan_id, metric_key)
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      currency_code TEXT NOT NULL DEFAULT 'XOF',
      suspended BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'FCFA',
      logo_path TEXT,
      hours JSONB NOT NULL DEFAULT '[]'::jsonb,
      payment_methods JSONB NOT NULL DEFAULT '["especes","wave","orange_money","mtn_momo","carte"]'::jsonb,
      cash_requires_open BOOLEAN NOT NULL DEFAULT TRUE,
      max_cashier_discount INTEGER NOT NULL DEFAULT 0,
      commission_rate INTEGER NOT NULL DEFAULT 10,
      monthly_target INTEGER NOT NULL DEFAULT 0,
      activated BOOLEAN NOT NULL DEFAULT FALSE,
      activated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      email_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
      commission_rate_override INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_stations (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, station_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS action_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      station_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      company_id TEXT UNIQUE NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      trial_ends_at TIMESTAMPTZ,
      current_period_end TEXT,
      pending_plan_id TEXT
    );

    CREATE TABLE IF NOT EXISTS subscription_requests (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      from_plan_id TEXT,
      to_plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMPTZ,
      decided_by TEXT
    );

    CREATE TABLE IF NOT EXISTS tenant_states (
      company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS station_logos (
      path TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS platform_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rpc_idempotency (
      id TEXT PRIMARY KEY,
      rpc_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed default plans catalog only (pricing reference, zero fake tenant/operational data)
  const existingPlans = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM plans');
  if (Number(existingPlans.rows[0]?.count ?? '0') === 0) {
    for (let i = 0; i < PLANS.length; i += 1) {
      const p = PLANS[i];
      await db.query(
        `INSERT INTO plans (id, name, price_minor, trial_days, active, sort_order, features, entitlements)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6::jsonb, $7::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          p.name,
          p.priceMonthly,
          p.trial ? 14 : 0,
          i + 1,
          JSON.stringify(p.features),
          JSON.stringify(p.entitlements ?? {}),
        ],
      );
      const limits: [string, number][] = [
        ['stations', p.limits.stations],
        ['employees', p.limits.employees],
        ['washes_per_month', p.limits.washesPerMonth],
      ];
      for (const [k, v] of limits) {
        await db.query(
          `INSERT INTO plan_limits (plan_id, metric_key, value_int)
           VALUES ($1, $2, $3) ON CONFLICT (plan_id, metric_key) DO NOTHING`,
          [p.id, k, v],
        );
      }
    }
  }

  // Optional environment-configured super_admin bootstrap (never hardcoded)
  const adminEmail = process.env.WASHGUARD_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.WASHGUARD_ADMIN_PASSWORD?.trim();
  if (adminEmail && adminPassword && adminPassword.length >= 8) {
    const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing.rows.length === 0) {
      await db.query(
        `INSERT INTO users (id, company_id, name, email, phone, password_hash, role, active, email_confirmed)
         VALUES ($1, NULL, $2, $3, '', $4, 'super_admin', TRUE, TRUE)`,
        [crypto.randomUUID(), process.env.WASHGUARD_ADMIN_NAME?.trim() || 'Super Administrateur', adminEmail, hashPasswordSync(adminPassword)],
      );
    }
  }
}

export async function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const configured = process.env.WASHGUARD_PGDATA?.trim();
      const dataDir = configured
        ? path.resolve(process.cwd(), configured)
        : path.resolve(process.cwd(), '.washguard', 'pgdata');
      let db: PGlite;
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        db = await PGlite.create(dataDir);
      } catch (err) {
        console.warn('[WashGuard DB] Fallback memory:// PGlite:', err instanceof Error ? err.message : err);
        db = await PGlite.create('memory://');
      }
      await initSchema(db);
      return db;
    })();
  }
  return dbPromise;
}
