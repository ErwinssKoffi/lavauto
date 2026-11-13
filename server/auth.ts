import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './db';
import type { AuthIdentity } from '../src/services/auth/authTypes';
import { permissionsForRole } from '../src/lib/permissionCatalog';
import type { DayHours, Role } from '../src/types';

export const SESSION_COOKIE_NAME = 'wg_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hex] = parts;
  const expected = Buffer.from(hex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function roleToDbKey(role: Role): string {
  const map: Record<Role, string> = {
    proprietaire: 'owner',
    gerant: 'manager',
    caissier: 'cashier',
    laveur: 'washer',
    super_admin: 'super_admin',
    support: 'super_admin',
  };
  return map[role] ?? 'cashier';
}

export function extractSessionToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === SESSION_COOKIE_NAME && v) return decodeURIComponent(v);
  }
  return null;
}

export function setSessionCookie(res: Response, token: string, rememberMe = true): void {
  const maxAge = rememberMe ? Math.floor(SESSION_TTL_MS / 1000) : undefined;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export async function createSessionForUser(userId: string): Promise<string> {
  const db = await getDb();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.query(
    `INSERT INTO sessions (id, token_hash, user_id, expires_at)
     VALUES ($1, $2, $3, $4::timestamptz)`,
    [crypto.randomUUID(), hashToken(rawToken), userId, expiresAt],
  );
  return rawToken;
}

export async function createActionToken(userId: string, kind: 'reset_password' | 'invite', ttlHours = 48): Promise<string> {
  const db = await getDb();
  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  await db.query(
    `INSERT INTO action_tokens (id, token_hash, user_id, kind, expires_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)`,
    [crypto.randomUUID(), hashToken(raw), userId, kind, expiresAt],
  );
  return raw;
}

export async function buildIdentityForUser(userId: string): Promise<AuthIdentity | null> {
  const db = await getDb();
  const uRes = await db.query<{
    id: string;
    company_id: string | null;
    name: string;
    email: string;
    phone: string;
    role: Role;
    active: boolean;
    email_confirmed: boolean;
  }>(
    `SELECT id, company_id, name, email, phone, role, active, email_confirmed
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = uRes.rows[0];
  if (!user) return null;

  let company: AuthIdentity['company'] = null;
  let stations: AuthIdentity['stations'] = [];
  let stationIds: string[] = [];

  if (user.company_id) {
    const cRes = await db.query<{
      id: string; name: string; city: string; phone: string; currency_code: string; suspended: boolean; created_at: string;
    }>(
      `SELECT id, name, city, phone, currency_code, suspended, created_at::text AS created_at
       FROM companies WHERE id = $1`,
      [user.company_id],
    );
    const c = cRes.rows[0];
    if (c) {
      company = {
        id: c.id,
        name: c.name,
        city: c.city,
        phone: c.phone,
        currencyCode: c.currency_code,
        suspended: c.suspended,
        createdAt: c.created_at,
      };
    }

    const sRows = await db.query<{
      id: string; name: string; city: string; address: string; phone: string; hours: DayHours[];
      activated: boolean; activated_at: string | null; logo_path: string | null;
    }>(
      user.role === 'proprietaire' || user.role === 'super_admin'
        ? `SELECT id, name, city, address, phone, hours, activated, activated_at::text AS activated_at, logo_path
           FROM stations WHERE company_id = $1 ORDER BY created_at ASC`
        : `SELECT s.id, s.name, s.city, s.address, s.phone, s.hours, s.activated, s.activated_at::text AS activated_at, s.logo_path
           FROM stations s
           JOIN user_stations us ON us.station_id = s.id
           WHERE s.company_id = $1 AND us.user_id = $2
           ORDER BY s.created_at ASC`,
      user.role === 'proprietaire' || user.role === 'super_admin' ? [user.company_id] : [user.company_id, user.id],
    );
    stations = sRows.rows.map((s) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      address: s.address,
      phone: s.phone,
      hours: Array.isArray(s.hours) ? s.hours : [],
      activated: Boolean(s.activated),
      activatedAt: s.activated_at ?? null,
      logoPath: s.logo_path ?? null,
    }));
    stationIds = stations.map((s) => s.id);
  }

  return {
    userId: user.id,
    email: user.email,
    fullName: user.name,
    role: user.role,
    roleKey: roleToDbKey(user.role),
    permissions: permissionsForRole(user.role),
    companyId: user.company_id,
    stationIds,
    stations,
    company,
    isPlatformAdmin: user.role === 'super_admin',
    active: Boolean(user.active),
    emailConfirmed: Boolean(user.email_confirmed),
    profileReady: Boolean(user.company_id || user.role === 'super_admin'),
  };
}

export interface AuthedRequest extends Request {
  identity?: AuthIdentity;
  sessionTokenHash?: string;
}

export async function attachIdentity(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (!token) return next();
    const db = await getDb();
    const tokenHash = hashToken(token);
    const sRes = await db.query<{ user_id: string }>(
      `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash],
    );
    const row = sRes.rows[0];
    if (!row) return next();
    const identity = await buildIdentityForUser(row.user_id);
    if (identity) {
      req.identity = identity;
      req.sessionTokenHash = tokenHash;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const id = req.identity;
  if (!id) {
    res.status(401).json({ code: 'unauthenticated', message: 'Connexion requise.' });
    return;
  }
  if (!id.active) {
    res.status(403).json({ code: 'account_disabled', message: 'Ce compte est désactivé.' });
    return;
  }
  next();
}

export function requirePermission(permission: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const id = req.identity;
    if (!id) {
      res.status(401).json({ code: 'unauthenticated', message: 'Connexion requise.' });
      return;
    }
    if (!id.active) {
      res.status(403).json({ code: 'account_disabled', message: 'Ce compte est désactivé.' });
      return;
    }
    if (!id.permissions.includes(permission) && !id.isPlatformAdmin) {
      res.status(403).json({ code: 'forbidden', message: `Permission requise : ${permission}.` });
      return;
    }
    next();
  };
}
