import type { AppState, AppUser, Role, Session } from '../../types';
import { ApiError } from '../../types';
import { uid } from '../../lib/format';
import { permissionsForRole } from '../../lib/permissionCatalog';
import {
  clearDemoPasswords, hasDemoPassword, setDemoPassword, verifyDemoPassword,
} from '../../lib/demoPasswords';
import type { AuthChange, AuthPort, AuthResult, AuthSubscription } from './AuthPort';
import {
  dbRoleToUi, uiRoleToDb, type AuthIdentity, type CompanyUser, type Invitation,
  type InvitePayload, type SignUpPayload, type UpdateUserPayload,
} from './authTypes';

// ─── Adaptateur Auth LOCAL, démonstration hors ligne (Prompt 04) ─────────────
// La session reste EN MÉMOIRE : elle n'est plus lue ni écrite dans le stockage
// navigateur. Les empreintes de mots de passe de démo sont séparées de l'état
// métier. Ce mode n'envoie aucun e-mail et ne remplace pas Supabase Auth.

export interface LocalAuthHooks {
  getState(): AppState;
  setState(updater: (state: AppState) => AppState): void;
}

const INVITABLE_ROLES: Role[] = ['gerant', 'caissier', 'laveur'];

function asRole(role: Role): Role {
  return role === 'support' ? 'super_admin' : role;
}

function currencyCode(value: string | undefined): string {
  return value === 'FCFA' || !value ? 'XOF' : value;
}

/** Projection pure AppState → contexte d'identité, pour la démo et les tests. */
export function identityFromState(state: AppState, sessionOverride?: Session | null): AuthIdentity | null {
  const session = sessionOverride === undefined ? state.session : sessionOverride;
  if (!session) return null;
  const role = asRole(session.role);
  const company = state.company ? {
    id: state.company.id,
    name: state.company.name,
    city: state.company.city,
    phone: state.company.phone,
    currencyCode: currencyCode(state.station?.currency),
    suspended: state.company.suspended,
    createdAt: state.company.createdAt,
  } : null;
  const stations = state.station ? [{
    id: state.station.id,
    name: state.station.name,
    city: state.station.city,
    activated: state.station.activated,
    logoPath: state.station.logoPath ?? null,
  }] : [];
  return {
    userId: session.userId,
    email: session.email,
    fullName: session.name,
    role,
    roleKey: uiRoleToDb(role),
    permissions: permissionsForRole(role),
    companyId: session.companyId ?? state.company?.id ?? null,
    stationIds: stations.map((s) => s.id),
    stations,
    company,
    isPlatformAdmin: role === 'super_admin',
    active: !state.company?.suspended,
    emailConfirmed: true,
    profileReady: true,
  };
}

function toCompanyUsers(state: AppState): CompanyUser[] {
  return state.users.map((u) => ({
    id: u.id,
    fullName: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    roleKey: uiRoleToDb(u.role),
    active: u.active,
    createdAt: u.createdAt,
    stationIds: u.stationIds ?? (u.stationId ? [u.stationId] : []),
  }));
}

function requirePermission(identity: AuthIdentity | null, permission: string): AuthIdentity {
  if (!identity) throw new ApiError('unauthenticated', 'Connectez-vous pour continuer.');
  if (!identity.permissions.includes(permission)) {
    throw new ApiError('forbidden', 'Vous n’avez pas la permission nécessaire.');
  }
  return identity;
}

export class LocalAuthAdapter implements AuthPort {
  readonly kind = 'local' as const;
  private identity: AuthIdentity | null;
  private handlers = new Set<(change: AuthChange) => void>();
  private invitations: Invitation[] = [];

  constructor(private hooks: LocalAuthHooks, initialIdentity: AuthIdentity | null = null) {
    this.identity = initialIdentity;
  }

  private emit(type: AuthChange['type'], identity: AuthIdentity | null = this.identity): void {
    this.identity = identity;
    for (const handler of this.handlers) handler({ type, identity });
  }

  async getIdentity(): Promise<AuthIdentity | null> { return this.identity; }

  onAuthStateChange(handler: (change: AuthChange) => void): AuthSubscription {
    this.handlers.add(handler);
    // Événement initial unique : le store n'appelle PAS getIdentity() en boucle.
    Promise.resolve().then(() => {
      if (this.handlers.has(handler)) handler({ type: 'INITIAL_SESSION', identity: this.identity });
    });
    return { unsubscribe: () => this.handlers.delete(handler) };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const state = this.hooks.getState();
    const normalized = email.trim().toLowerCase();
    const user = state.users.find((u) => u.email.toLowerCase() === normalized);
    if (!user || !hasDemoPassword(user.email) || !verifyDemoPassword(user.email, password)) {
      throw new ApiError('invalid_credentials', 'Adresse e-mail ou mot de passe incorrect.');
    }
    if (!user.active) throw new ApiError('account_disabled', 'Ce compte est désactivé. Voyez le propriétaire.');
    if (state.company?.suspended) throw new ApiError('company_suspended', 'Cette entreprise est suspendue.');
    const session: Session = {
      userId: user.id, email: user.email, name: user.name,
      role: user.role, companyId: user.companyId, stationId: user.stationId ?? state.station?.id ?? null,
    };
    const identity = identityFromState({ ...state, session }, session);
    if (!identity) throw new ApiError('unauthenticated', 'Session locale indisponible.');
    this.hooks.setState((s) => ({ ...s, session }));
    this.emit('SIGNED_IN', identity);
    return { identity };
  }

  async signUp(payload: SignUpPayload): Promise<AuthResult> {
    const state = this.hooks.getState();
    const owner = state.users.find((u) => u.role === 'proprietaire');
    if (state.company && state.station && owner) {
      const existing = identityFromState(state, {
        userId: owner.id, email: owner.email, name: owner.name, role: owner.role,
        companyId: owner.companyId, stationId: owner.stationId ?? state.station.id,
      });
      if (existing) {
        this.hooks.setState((s) => ({ ...s, session: {
          userId: owner.id, email: owner.email, name: owner.name, role: owner.role,
          companyId: owner.companyId, stationId: owner.stationId ?? state.station?.id ?? null,
        } }));
        this.emit('SIGNED_IN', existing);
        return { identity: existing, message: 'Cet espace existe déjà.' };
      }
    }
    const now = new Date().toISOString();
    const companyId = uid('co');
    const stationId = uid('st');
    const userId = uid('usr');
    const email = payload.email.trim().toLowerCase();
    const company = {
      id: companyId, name: payload.companyName.trim(), city: payload.city.trim(),
      phone: payload.phone.trim(), createdAt: now, suspended: false,
    };
    const station: AppState['station'] = {
      id: stationId, companyId, name: payload.stationName.trim(), address: '',
      city: payload.city.trim(), phone: payload.phone.trim(), currency: 'FCFA',
      logoPath: null, hours: [], paymentMethods: [], cashRequiresOpen: true,
      maxCashierDiscount: 0, commissionRate: 0, monthlyTarget: 0,
      activated: false, activatedAt: null,
    };
    const ownerUser: AppUser = {
      id: userId, companyId, stationId, name: payload.ownerName.trim(),
      email, phone: payload.phone.trim(), role: 'proprietaire',
      active: true, commissionRateOverride: null, createdAt: now,
    };
    const session: Session = {
      userId, email, name: ownerUser.name, role: 'proprietaire',
      companyId, stationId,
    };
    const next: AppState = {
      ...state, company, station, users: [ownerUser], session,
      subscription: {
        id: uid('sub'), companyId, planId: 'essai', status: 'essai',
        startedAt: now, trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
        pendingPlanId: null,
      },
      platformCompanies: [{
        id: companyId, name: company.name, city: company.city, phone: company.phone,
        planName: 'Essai', status: 'essai', stations: 1, monthlyRevenue: 0, createdAt: now,
      }, ...state.platformCompanies],
      auditLogs: [{
        id: uid('log'), at: now, actor: ownerUser.name, action: 'Inscription',
        detail: `Création de ${company.name} / ${station.name} et de l’abonnement d’essai`,
      }, ...state.auditLogs].slice(0, 200),
    };
    setDemoPassword(email, payload.password);
    this.hooks.setState(() => next);
    const identity = identityFromState(next, session)!;
    this.emit('SIGNED_IN', identity);
    return { identity };
  }

  async signOut(): Promise<void> {
    this.emit('SIGNED_OUT', null);
    this.hooks.setState((s) => ({ ...s, session: null }));
  }

  async requestPasswordReset(_email: string): Promise<void> {
    throw new ApiError('reset_email_required', 'Le lien de réinitialisation par e-mail est disponible avec Supabase Auth (mode connecté).');
  }

  async updatePassword(_password: string): Promise<void> {
    throw new ApiError('reset_email_required', 'Le lien de réinitialisation par e-mail est disponible avec Supabase Auth (mode connecté).');
  }

  async listUsers(): Promise<{ identity: AuthIdentity; users: CompanyUser[] }> {
    const identity = requirePermission(this.identity, 'washes.view');
    return { identity, users: toCompanyUsers(this.hooks.getState()) };
  }

  async listInvitations(): Promise<Invitation[]> {
    if (!this.identity) return [];
    return this.identity.permissions.includes('employees.manage')
      ? [...this.invitations]
      : [];
  }

  async invite(payload: InvitePayload): Promise<{ id: string; message?: string }> {
    const identity = requirePermission(this.identity, 'employees.invite');
    const email = payload.email.trim().toLowerCase();
    const state = this.hooks.getState();
    if (!INVITABLE_ROLES.includes(payload.role)) {
      throw new ApiError('invalid_role', 'Rôle non autorisé pour une invitation.');
    }
    if (state.users.some((u) => u.email.toLowerCase() === email)) {
      throw new ApiError('email_taken', 'Cette adresse e-mail est déjà utilisée.');
    }
    if (this.invitations.some((i) => i.email === email && !i.acceptedAt && !i.revokedAt)) {
      throw new ApiError('invitation_pending', 'Une invitation est déjà en attente.');
    }
    const stationIds = Array.from(new Set(payload.stationIds));
    if (stationIds.length === 0 || stationIds.some((id) => !identity.stationIds.includes(id))) {
      throw new ApiError('invalid_stations', 'Affectez au moins une station de votre entreprise.');
    }
    const now = new Date().toISOString();
    const user: AppUser = {
      id: uid('usr'), companyId: identity.companyId, stationId: stationIds[0],
      name: payload.fullName.trim(), email, phone: payload.phone.trim(),
      role: payload.role, active: true, commissionRateOverride: null,
      createdAt: now, stationIds,
    };
    const invitation: Invitation = {
      id: uid('inv'), email, role: payload.role,
      roleKey: uiRoleToDb(payload.role), stationIds,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      acceptedAt: null, revokedAt: null, createdAt: now,
    };
    this.invitations = [invitation, ...this.invitations];
    this.hooks.setState((s) => ({
      ...s,
      users: [...s.users, user],
      auditLogs: [{ id: uid('log'), at: now, actor: identity.fullName,
        action: 'Invitation envoyée', detail: `${user.name} · ${email}` }, ...s.auditLogs].slice(0, 200),
    }));
    // Aucun mot de passe provisoire : le lien de définition du mot de passe
    // est obligatoire en mode Supabase ; la démo locale n'en stocke aucun.
    return { id: invitation.id, message: 'Compte créé en attente de définition du mot de passe.' };
  }

  async revokeInvitation(id: string): Promise<void> {
    requirePermission(this.identity, 'employees.invite');
    const target = this.invitations.find((i) => i.id === id);
    if (!target || target.revokedAt || target.acceptedAt) {
      throw new ApiError('not_found', 'Invitation introuvable ou déjà traitée.');
    }
    this.invitations = this.invitations.map((i) =>
      i.id === id ? { ...i, revokedAt: new Date().toISOString() } : i
    );
  }

  async updateUser(payload: UpdateUserPayload): Promise<void> {
    const identity = requirePermission(this.identity, 'employees.manage');
    const state = this.hooks.getState();
    const target = state.users.find((u) => u.id === payload.userId);
    if (!target) throw new ApiError('not_found', 'Compte introuvable.');
    if (target.role === 'proprietaire' && identity.role !== 'proprietaire') {
      throw new ApiError('forbidden', 'Le propriétaire ne peut pas être modifié par un autre rôle.');
    }
    if (payload.role && !identity.permissions.includes('employees.manage')) {
      throw new ApiError('forbidden', 'Permission employees.manage requise.');
    }
    if (payload.role && !INVITABLE_ROLES.includes(payload.role)) {
      throw new ApiError('invalid_role', 'Rôle cible non autorisé.');
    }
    if (payload.active !== undefined && !identity.permissions.includes('employees.disable')) {
      throw new ApiError('forbidden', 'Permission employees.disable requise.');
    }
    if (payload.active === false && payload.userId === identity.userId) {
      throw new ApiError('forbidden', 'Un compte ne peut pas se désactiver lui-même.');
    }
    if (payload.stationIds && !identity.permissions.includes('employees.assign_stations')) {
      throw new ApiError('forbidden', 'Permission employees.assign_stations requise.');
    }
    if (payload.stationIds?.some((id) => !identity.stationIds.includes(id))) {
      throw new ApiError('forbidden', 'Station hors périmètre.');
    }
    this.hooks.setState((s) => ({
      ...s,
      users: s.users.map((u) => u.id === payload.userId ? {
        ...u,
        role: payload.role ?? u.role,
        active: payload.active ?? u.active,
        stationIds: payload.stationIds ?? u.stationIds,
        stationId: payload.stationIds?.[0] ?? u.stationId,
      } : u),
      auditLogs: [{ id: uid('log'), at: new Date().toISOString(), actor: identity.fullName,
        action: 'Compte modifié', detail: target.email }, ...s.auditLogs].slice(0, 200),
    }));
  }

  async refreshUsers(): Promise<AppUser[]> { return this.hooks.getState().users; }

  clearAll(): void {
    clearDemoPasswords();
    this.invitations = [];
    this.emit('SIGNED_OUT', null);
  }
}

/** Conversion utilisée par le store pour projeter les utilisateurs serveur. */
export function companyUsersToAppUsers(users: CompanyUser[], companyId: string | null): AppUser[] {
  return users.map((u) => ({
    id: u.id, companyId, stationId: u.stationIds[0] ?? null,
    name: u.fullName, email: u.email, phone: u.phone,
    role: dbRoleToUi(u.roleKey), active: u.active,
    commissionRateOverride: null, createdAt: u.createdAt,
    stationIds: u.stationIds,
  }));
}
