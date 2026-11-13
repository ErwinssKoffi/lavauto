import type { AppUser, Company, DayHours, Role, Station } from '../../types';
import { isStationLogoPath } from '../../lib/image';

// ─── Types du domaine Auth / RBAC (Prompt 04) ────────────────────────────────

export interface CompanySummary {
  id: string;
  name: string;
  city: string;
  phone: string;
  currencyCode: string;
  suspended: boolean;
  createdAt: string;
}

export interface StationSummary {
  id: string;
  name: string;
  city: string;
  address?: string;
  phone?: string;
  hours?: DayHours[];
  activated: boolean;
  activatedAt?: string | null;
  logoPath: string | null;
}

export interface AuthIdentity {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  roleKey: string;
  permissions: string[];
  companyId: string | null;
  stationIds: string[];
  stations: StationSummary[];
  company: CompanySummary | null;
  isPlatformAdmin: boolean;
  active: boolean;
  emailConfirmed: boolean;
  profileReady: boolean;
}

export interface CompanyUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  roleKey: string;
  active: boolean;
  createdAt: string;
  stationIds: string[];
  commissionRateOverride?: number | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  roleKey: string;
  stationIds: string[];
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface InvitePayload {
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  stationIds: string[];
}

export interface UpdateUserPayload {
  userId: string;
  role?: Role;
  active?: boolean;
  stationIds?: string[];
  commissionRateOverride?: number | null;
}

export interface SignUpPayload {
  companyName: string;
  stationName: string;
  phone: string;
  city: string;
  ownerName: string;
  email: string;
  password: string;
  /** Choix à l’inscription : les formules payantes ne sont que demandées. */
  requestedPlanId?: 'essai' | 'standard' | 'premium';
}

export const DB_ROLE_TO_UI: Record<string, Role> = {
  owner: 'proprietaire',
  manager: 'gerant',
  cashier: 'caissier',
  washer: 'laveur',
  super_admin: 'super_admin',
};

export const UI_ROLE_TO_DB: Record<Role, string> = {
  proprietaire: 'owner',
  gerant: 'manager',
  caissier: 'cashier',
  laveur: 'washer',
  support: 'super_admin',
  super_admin: 'super_admin',
};

export function dbRoleToUi(key: string | null | undefined): Role {
  return (key && DB_ROLE_TO_UI[key]) || 'caissier';
}

export function uiRoleToDb(role: Role): string {
  return UI_ROLE_TO_DB[role] ?? 'cashier';
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Conversion pure de la réponse `my_context()` vers le domaine frontend. */
export function mapMyContext(raw: unknown, emailConfirmed = false): AuthIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.authenticated !== true || !asString(r.userId)) return null;
  const companyRaw = r.company && typeof r.company === 'object'
    ? r.company as Record<string, unknown>
    : null;
  const company: CompanySummary | null = companyRaw ? {
    id: asString(companyRaw.id),
    name: asString(companyRaw.name),
    city: asString(companyRaw.city),
    phone: asString(companyRaw.phone),
    currencyCode: asString(companyRaw.currency_code, 'XOF'),
    suspended: asBoolean(companyRaw.suspended),
    createdAt: asString(companyRaw.created_at, new Date().toISOString()),
  } : null;
  const companyId = asString(r.companyId) || company?.id || null;
  const stations: StationSummary[] = asArray(r.stations).map((entry) => {
    const s = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    return {
      id: asString(s.id),
      name: asString(s.name),
      city: asString(s.city),
      address: asString(s.address),
      phone: asString(s.phone),
      hours: Array.isArray(s.hours) ? s.hours.filter((h): h is DayHours =>
        Boolean(h && typeof h === 'object' && typeof h.day === 'string'
          && typeof h.open === 'string' && typeof h.close === 'string' && typeof h.closed === 'boolean')) : [],
      activated: asBoolean(s.activated),
      activatedAt: typeof s.activatedAt === 'string' ? s.activatedAt : null,
      logoPath: isStationLogoPath(s.logoPath) && s.logoPath.startsWith(`${companyId}/`) ? s.logoPath : null,
    };
  }).filter((s) => s.id);
  const roleKey = asString(r.roleKey);
  return {
    userId: asString(r.userId),
    email: asString(r.email),
    fullName: asString(r.fullName, asString(r.email, 'Utilisateur')),
    role: dbRoleToUi(roleKey),
    roleKey,
    permissions: asArray(r.permissions).filter((p): p is string => typeof p === 'string'),
    companyId,
    stationIds: stations.map((s) => s.id),
    stations,
    company,
    isPlatformAdmin: asBoolean(r.isPlatformAdmin),
    active: asBoolean(r.active, true),
    emailConfirmed,
    profileReady: asBoolean(r.profileReady, true),
  };
}

/** Conversion pure de `my_company_users()` vers les comptes affichables. */
export function mapCompanyUsers(raw: unknown): CompanyUser[] {
  return asArray(raw).map((entry) => {
    const u = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const roleKey = asString(u.roleKey);
    return {
      id: asString(u.id),
      fullName: asString(u.fullName, asString(u.email, 'Employé')),
      email: asString(u.email),
      phone: asString(u.phone),
      role: dbRoleToUi(roleKey),
      roleKey,
      active: asBoolean(u.active, true),
      createdAt: asString(u.createdAt, new Date().toISOString()),
      stationIds: asArray(u.stationIds).filter((id): id is string => typeof id === 'string'),
    };
  }).filter((u) => u.id);
}

/** Conversion pure de `my_company_invitations()`. */
export function mapInvitations(raw: unknown): Invitation[] {
  return asArray(raw).map((entry) => {
    const i = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const roleKey = asString(i.roleKey);
    return {
      id: asString(i.id),
      email: asString(i.email),
      role: dbRoleToUi(roleKey),
      roleKey,
      stationIds: asArray(i.stationIds).filter((id): id is string => typeof id === 'string'),
      expiresAt: asString(i.expiresAt),
      acceptedAt: typeof i.acceptedAt === 'string' ? i.acceptedAt : null,
      revokedAt: typeof i.revokedAt === 'string' ? i.revokedAt : null,
      createdAt: asString(i.createdAt, new Date().toISOString()),
    };
  }).filter((i) => i.id);
}

/** Projette le contexte serveur dans les objets métier déjà utilisés par l'UI. */
export function mapIdentityToAppState(
  identity: AuthIdentity,
  users: CompanyUser[],
  stationId?: string | null,
): { company: Company | null; station: Station | null; users: AppUser[] } {
  const company: Company | null = identity.company ? {
    id: identity.company.id,
    name: identity.company.name,
    city: identity.company.city,
    phone: identity.company.phone,
    createdAt: identity.company.createdAt,
    suspended: identity.company.suspended,
  } : null;
  const selected = stationId ? identity.stations.find((s) => s.id === stationId) : identity.stations[0];
  const station: Station | null = selected ? {
    id: selected.id,
    companyId: identity.companyId ?? '',
    name: selected.name,
    address: selected.address ?? '',
    city: selected.city,
    phone: selected.phone ?? '',
    currency: 'FCFA',
    logoPath: selected.logoPath,
    hours: selected.hours ?? [],
    paymentMethods: [],
    cashRequiresOpen: true,
    maxCashierDiscount: 0,
    commissionRate: 0,
    monthlyTarget: 0,
    activated: selected.activated,
    activatedAt: selected.activatedAt ?? null,
  } : null;
  const appUsers: AppUser[] = users.map((u) => ({
    id: u.id,
    companyId: identity.companyId,
    stationId: u.stationIds[0] ?? station?.id ?? null,
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    active: u.active,
    commissionRateOverride: u.commissionRateOverride ?? null,
    createdAt: u.createdAt,
    stationIds: u.stationIds,
  }));
  return { company, station, users: appUsers };
}
