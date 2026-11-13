import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './db';
import type { AuthIdentity } from '../src/services/auth/authTypes';
import { permissionsForRole } from '../src/lib/permissionCatalog';
import type { DayHours, Role } from '../src/types';

export const SESSION_COOKIE_NAME = 'wg_session';
/** « Rester connecté » (cookie persistant) : 30 jours glissants. */
export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
/** Sans persistance : cookie de session, jeton valable 12 heures. */
export const SESSION_TTL_SHORT_MS = 12 * 60 * 60 * 1000;
/** Plafond absolu : aucune session ne dépasse 180 jours, même prolongée. */
export const SESSION_ABSOLUTE_MAX_MS = 180 * 24 * 60 * 60 * 1000;
/** Une session est prolongée si moins de la moitié de sa durée reste. */
const SESSION_RENEW_THRESHOLD_RATIO = 0.5;

export interface SessionMeta {
  userAgent: string;
  ipAddress: string;
  rememberMe: boolean;
}

export interface CreatedSession {
  id: string;
  token: string;
  expiresAt: string;
  rememberMe: boolean;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ipAddress: string;
  rememberMe: boolean;
  current: boolean;
}

function sessionTtlMs(rememberMe: boolean): number {
  return rememberMe ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_SHORT_MS;
}

/** Description lisible d'un agent utilisateur, sans exposer la chaîne brute. */
export function describeUserAgent(raw: string): string {
  const ua = raw.slice(0, 400);
  if (!ua) return 'Appareil inconnu';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari'
            : /curl\//i.test(ua) ? 'Ligne de commande'
              : 'Navigateur';
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : 'système inconnu';
  return `${browser} · ${os}`;
}

export type AuthEventName =
  | 'signup' | 'signin_success' | 'signin_failed' | 'signout'
  | 'password_reset_requested' | 'password_reset_completed' | 'password_changed'
  | 'session_revoked' | 'sessions_revoked' | 'session_expired'
  | 'email_confirmation_requested' | 'email_confirmed' | 'rate_limited';

/** Journal d'authentification : identifiants, IP et agent, jamais de secret. */
export async function recordAuthEvent(entry: {
  userId?: string | null;
  email?: string;
  event: AuthEventName;
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.query(
      `INSERT INTO auth_events (id, user_id, email, event, detail, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        entry.userId ?? null,
        (entry.email ?? '').slice(0, 254).toLowerCase(),
        entry.event,
        (entry.detail ?? '').slice(0, 500),
        (entry.ipAddress ?? '').slice(0, 64),
        (entry.userAgent ?? '').slice(0, 400),
      ],
    );
    // Le journal reste borné : 5 000 événements les plus récents.
    await db.query(
      `DELETE FROM auth_events WHERE id IN (
         SELECT id FROM auth_events ORDER BY created_at DESC OFFSET 5000
       )`,
    );
  } catch (err) {
    // Le journal ne doit jamais empêcher une connexion légitime.
    console.warn('[WashGuard] Journalisation auth impossible :', err instanceof Error ? err.message : err);
  }
}

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = typeof raw === 'string' ? raw.split(',')[0]?.trim() : '';
  return (first || req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}

export function requestMeta(req: Request): Omit<SessionMeta, 'rememberMe'> {
  return {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 400) : '',
    ipAddress: clientIp(req),
  };
}

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

export function setSessionCookie(
  res: Response,
  token: string,
  rememberMe = true,
  expiresAt?: string,
): void {
  // La date du cookie suit celle de la session en base : aucun cookie ne
  // survit à la révocation, aucun ne disparaît avant elle.
  const parsedExpiry = expiresAt ? Date.parse(expiresAt) : NaN;
  const maxAge = rememberMe
    ? Math.max(60, Math.floor(((Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + sessionTtlMs(true)) - Date.now()) / 1000))
    : undefined;
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

export async function createSessionForUser(
  userId: string,
  meta: Partial<SessionMeta> = {},
): Promise<CreatedSession> {
  const db = await getDb();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const rememberMe = meta.rememberMe !== false;
  const expiresAt = new Date(Date.now() + sessionTtlMs(rememberMe)).toISOString();
  const id = crypto.randomUUID();
  // Nettoyage opportuniste : les sessions expirées de cet utilisateur ne
  // servent plus à rien et ne doivent pas rester lisibles.
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= NOW()', [userId]);
  await db.query(
    `INSERT INTO sessions (id, token_hash, user_id, expires_at, user_agent, ip_address, remember_me)
     VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7)`,
    [
      id,
      hashToken(rawToken),
      userId,
      expiresAt,
      (meta.userAgent ?? '').slice(0, 400),
      (meta.ipAddress ?? '').slice(0, 64),
      rememberMe,
    ],
  );
  return { id, token: rawToken, expiresAt, rememberMe };
}

export interface SessionStatus {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  rememberMe: boolean;
}

/**
 * Vérifie un jeton et prolonge la session (expiration glissante) au plus une
 * fois par heure. Aucun jeton n'est renvoyé : le cookie reste inchangé.
 */
export async function resolveSession(token: string): Promise<SessionStatus | null> {
  const db = await getDb();
  const tokenHash = hashToken(token);
  const res = await db.query<{
    id: string; user_id: string; created_at: string; last_seen_at: string;
    expires_at: string; remember_me: boolean;
  }>(
    `SELECT id, user_id, created_at::text AS created_at, last_seen_at::text AS last_seen_at,
            expires_at::text AS expires_at, remember_me
     FROM sessions WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash],
  );
  const row = res.rows[0];
  if (!row) return null;

  const now = Date.now();
  const expiresAt = Date.parse(row.expires_at);
  const ttl = sessionTtlMs(row.remember_me);
  const createdAt = Date.parse(row.created_at);
  const lastSeen = Date.parse(row.last_seen_at);
  const shouldTouch = !Number.isFinite(lastSeen) || now - lastSeen > 60 * 60 * 1000;
  const shouldExtend = Number.isFinite(expiresAt)
    && expiresAt - now < ttl * SESSION_RENEW_THRESHOLD_RATIO
    && Number.isFinite(createdAt)
    && now - createdAt < SESSION_ABSOLUTE_MAX_MS;

  if (shouldExtend) {
    const next = new Date(Math.min(expiresAt + ttl * SESSION_RENEW_THRESHOLD_RATIO, createdAt + SESSION_ABSOLUTE_MAX_MS));
    await db.query('UPDATE sessions SET last_seen_at = NOW(), expires_at = $2::timestamptz WHERE id = $1', [row.id, next.toISOString()]);
    return { id: row.id, userId: row.user_id, createdAt: row.created_at, lastSeenAt: new Date(now).toISOString(), expiresAt: next.toISOString(), rememberMe: row.remember_me };
  }
  if (shouldTouch) {
    await db.query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.id]);
  }
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: shouldTouch ? new Date(now).toISOString() : row.last_seen_at,
    expiresAt: row.expires_at,
    rememberMe: row.remember_me,
  };
}

/** Liste les sessions actives ; le jeton n'est jamais exposé. */
export async function listUserSessions(userId: string, currentTokenHash?: string): Promise<SessionSummary[]> {
  const db = await getDb();
  const res = await db.query<{
    id: string; token_hash: string; created_at: string; last_seen_at: string;
    expires_at: string; user_agent: string; ip_address: string; remember_me: boolean;
  }>(
    `SELECT id, token_hash, created_at::text AS created_at, last_seen_at::text AS last_seen_at,
            expires_at::text AS expires_at, user_agent, ip_address, remember_me
     FROM sessions WHERE user_id = $1 AND expires_at > NOW()
     ORDER BY last_seen_at DESC LIMIT 50`,
    [userId],
  );
  return res.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    userAgent: describeUserAgent(row.user_agent),
    ipAddress: row.ip_address,
    rememberMe: row.remember_me,
    current: Boolean(currentTokenHash) && row.token_hash === currentTokenHash,
  }));
}

/** Révoque une session précise de l'utilisateur. Renvoie `false` si absente. */
export async function revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, userId]);
  return (res.affectedRows ?? 0) > 0;
}

/** Révoque toutes les sessions, sauf le jeton courant si fourni. */
export async function revokeUserSessions(userId: string, exceptTokenHash?: string): Promise<number> {
  const db = await getDb();
  const res = exceptTokenHash
    ? await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, exceptTokenHash])
    : await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return res.affectedRows ?? 0;
}

export type ActionTokenKind = 'reset_password' | 'invite' | 'confirm_email';

export async function createActionToken(userId: string, kind: ActionTokenKind, ttlHours = 48): Promise<string> {
  const db = await getDb();
  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  // Un nouveau lien invalide les précédents du même type : un seul lien actif
  // par usage, ce qui limite la fenêtre d'exploitation d'un jeton fuité.
  await db.query(
    'DELETE FROM action_tokens WHERE user_id = $1 AND kind = $2 AND used_at IS NULL',
    [userId, kind],
  );
  await db.query(
    `INSERT INTO action_tokens (id, token_hash, user_id, kind, expires_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)`,
    [crypto.randomUUID(), hashToken(raw), userId, kind, expiresAt],
  );
  return raw;
}

/** Décrit un jeton sans le consommer (vérification d'un lien avant affichage). */
export async function inspectActionToken(
  rawToken: string,
  kind: ActionTokenKind,
): Promise<{ id: string; userId: string; expiresAt: string } | null> {
  if (!rawToken) return null;
  const db = await getDb();
  const res = await db.query<{ id: string; user_id: string; expires_at: string }>(
    `SELECT id, user_id, expires_at::text AS expires_at FROM action_tokens
     WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > NOW()`,
    [hashToken(rawToken), kind],
  );
  const row = res.rows[0];
  return row ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at } : null;
}

/** Consomme un jeton à usage unique et renvoie l'utilisateur associé. */
export async function consumeActionToken(
  rawToken: string,
  kind: ActionTokenKind,
): Promise<{ id: string; userId: string } | null> {
  const inspected = await inspectActionToken(rawToken, kind);
  if (!inspected) return null;
  const db = await getDb();
  // Consommation atomique : deux requêtes simultanées ne peuvent pas gagner.
  const res = await db.query(
    'UPDATE action_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL',
    [inspected.id],
  );
  if ((res.affectedRows ?? 0) === 0) return null;
  return { id: inspected.id, userId: inspected.userId };
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
  sessionId?: string;
  sessionExpiresAt?: string;
  /** Jeton fourni mais inconnu ou expiré (réponse 401 explicite). */
  sessionExpired?: boolean;
}

export async function attachIdentity(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (!token) return next();
    const session = await resolveSession(token);
    if (!session) {
      // Jeton présent mais inconnu ou expiré : l'UI reçoit une raison stable
      // et peut inviter à se reconnecter sans boucle de requêtes.
      const identity = null;
      req.sessionExpired = true;
      req.identity = identity;
      return next();
    }
    const identity = await buildIdentityForUser(session.userId);
    if (identity) {
      req.identity = identity;
      req.sessionTokenHash = hashToken(token);
      req.sessionId = session.id;
      req.sessionExpiresAt = session.expiresAt;
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
