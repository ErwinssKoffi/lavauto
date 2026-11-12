import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from '../../types';
import { ApiError } from '../../types';
import type {
  AuthChange, AuthEvent, AuthPort, AuthResult, AuthSubscription,
} from './AuthPort';
import {
  mapCompanyUsers, mapInvitations, mapMyContext, uiRoleToDb,
  type AuthIdentity, type InvitePayload, type SignUpPayload, type UpdateUserPayload,
} from './authTypes';
import { companyUsersToAppUsers } from './LocalAuthAdapter';

// ─── Adaptateur Supabase Auth (Prompt 04) ────────────────────────────────────
// `onAuthStateChange` est la source de vérité ; chaque synchronisation vérifie
// le JWT avec `auth.getUser()` puis relit le contexte RBAC via `my_context()`.
// Aucun getSession(), aucun identifiant de tenant et aucun secret ne transitent
// par ici. Un token forgé dans localStorage ne produit jamais de session UI.

type SupaError = { message?: string; status?: number } | null | undefined;

function toApiError(error: SupaError, fallback = 'auth_failed'): ApiError {
  const message = error?.message ?? '';
  if (/invalid login credentials/i.test(message)) {
    return new ApiError('invalid_credentials', 'Adresse e-mail ou mot de passe incorrect.');
  }
  if (/email not confirmed/i.test(message)) {
    return new ApiError('email_unconfirmed', 'Confirmez votre adresse e-mail avant de vous connecter.');
  }
  if (/jwt|expired|refresh token/i.test(message)) {
    return new ApiError('session_expired', 'Votre session a expiré. Reconnectez-vous.');
  }
  if (/rate limit|too many/i.test(message)) {
    return new ApiError('rate_limited', 'Trop de tentatives. Réessayez dans quelques instants.');
  }
  if (/weak password|password.*(short|weak)/i.test(message)) {
    return new ApiError('weak_password', 'Choisissez un mot de passe d’au moins 8 caractères.');
  }
  return new ApiError(fallback, message || 'Opération d’authentification impossible.');
}

function origin(): string {
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://5173-in4mdo7zgflqt72vpkywe.e2b.app';
}

/** Client injecté : permet les tests sans réseau et garde un seul client Auth. */
export interface AuthSupabaseClient {
  auth: {
    getUser(): Promise<{ data: { user: {
      id: string; email?: string | null; email_confirmed_at?: string | null;
    } | null }; error: SupaError }>;
    onAuthStateChange(callback: (
      event: string,
      session: { access_token?: string } | null
    ) => void): { data: { subscription: { unsubscribe(): void } } };
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      data: { session: { access_token: string } | null }; error: SupaError;
    }>;
    signUp(credentials: {
      email: string; password: string; options?: Record<string, unknown>;
    }): Promise<{
      data: { session: { access_token: string } | null; user: unknown }; error: SupaError;
    }>;
    signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{ error: SupaError }>;
    resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ error: SupaError }>;
    updateUser(attributes: { password: string }): Promise<{ error: SupaError }>;
  };
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: SupaError }>;
  functions: {
    invoke(name: string, options: { body: Record<string, unknown> }): Promise<{
      data: unknown; error: SupaError;
    }>;
  };
}

function asClient(client: SupabaseClient | AuthSupabaseClient): AuthSupabaseClient {
  return client as unknown as AuthSupabaseClient;
}

export class SupabaseAuthAdapter implements AuthPort {
  readonly kind = 'supabase' as const;
  private identity: AuthIdentity | null = null;
  private handlers = new Set<(change: AuthChange) => void>();
  private pending: Promise<AuthIdentity | null> | null = null;
  private pendingToken: string | undefined;
  private lastKey = '';
  private lastAcceptedKey = '';
  private generation = 0;

  constructor(private client: SupabaseClient | AuthSupabaseClient) {}

  private emit(change: AuthChange): void {
    this.identity = change.identity;
    for (const handler of this.handlers) handler(change);
  }

  /**
   * Une seule requête de vérification à la fois ; la clé (utilisateur + token +
   * confirmation) empêche INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED de
   * relancer `/auth/v1/user` et `my_context()` en boucle.
   */
  private sync(type: AuthEvent, token?: string): Promise<AuthIdentity | null> {
    if (this.pending && (token === undefined || token === this.pendingToken)) return this.pending;
    // Un événement muni d'un autre jeton ne doit pas réutiliser la lecture
    // en vol pour l'identité précédente, même sans événement SIGNED_OUT.
    if (this.pending) this.generation += 1;
    const client = asClient(this.client);
    const generation = this.generation;
    const current = () => generation === this.generation;
    const task = (async () => {
      const { data, error } = await client.auth.getUser();
      if (!current()) return null;
      const user = data.user;
      if (error || !user) {
        this.lastKey = '';
        this.emit({ type: 'SIGNED_OUT', identity: null, reason: 'session_expired' });
        return null;
      }
      const emailConfirmed = Boolean(user.email_confirmed_at);
      const key = `${user.id}:${token ?? ''}:${emailConfirmed ? '1' : '0'}`;
      if (this.identity && key === this.lastKey && type !== 'TOKEN_REFRESHED') {
        this.emit({ type, identity: this.identity });
        return this.identity;
      }
      const { data: rawContext, error: contextError } = await client.rpc('my_context');
      if (!current()) return null;
      if (contextError) throw toApiError(contextError, 'context_failed');
      const identity = mapMyContext(rawContext, emailConfirmed);
      if (!identity || identity.userId !== user.id) {
        this.emit({ type: 'SIGNED_OUT', identity: null, reason: 'session_expired' });
        return null;
      }
      if (!identity.emailConfirmed) {
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
        if (!current()) return null;
        this.emit({ type: 'SIGNED_OUT', identity: null, reason: 'email_unconfirmed' });
        return null;
      }
      if (!identity.active) {
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
        if (!current()) return null;
        this.emit({ type: 'SIGNED_OUT', identity: null, reason: 'account_disabled' });
        return null;
      }
      if (identity.profileReady && identity.companyId &&
          (type === 'SIGNED_IN' || type === 'PASSWORD_RECOVERY') &&
          this.lastAcceptedKey !== key) {
        this.lastAcceptedKey = key;
        // Le client Supabase renvoie un PostgrestBuilder thenable, pas une
        // Promise avec .catch(). L'acceptation reste best-effort.
        try { await client.rpc('accept_my_invitations'); } catch { /* invitation indisponible */ }
        if (!current()) return null;
      }
      this.lastKey = key;
      this.emit({ type, identity });
      return identity;
    })();
    this.pending = task;
    this.pendingToken = token;
    const clear = () => { if (this.pending === task) { this.pending = null; this.pendingToken = undefined; } };
    void task.then(clear, clear);
    return task;
  }

  async getIdentity(): Promise<AuthIdentity | null> {
    if (this.pending) return this.pending;
    if (this.identity) return this.identity;
    return this.sync('INITIAL_SESSION');
  }

  onAuthStateChange(handler: (change: AuthChange) => void): AuthSubscription {
    this.handlers.add(handler);
    const client = asClient(this.client);
    const { data } = client.auth.onAuthStateChange((event, session) => {
      const token = session?.access_token;
      if (event === 'SIGNED_OUT') {
        this.generation += 1;
        this.pending = null;
        this.pendingToken = undefined;
        this.lastKey = '';
        this.lastAcceptedKey = '';
        this.emit({ type: 'SIGNED_OUT', identity: null });
        return;
      }
      const type: AuthEvent =
        event === 'PASSWORD_RECOVERY' ? 'PASSWORD_RECOVERY' :
        event === 'TOKEN_REFRESHED' ? 'TOKEN_REFRESHED' :
        event === 'SIGNED_IN' ? 'SIGNED_IN' : 'INITIAL_SESSION';
      // Pas d'await dans le callback supabase-js : la file est unique et
      // l'émission se fait après vérification serveur.
      const task = this.sync(type, token);
      const generation = this.generation;
      void task.catch(() => {
        if (generation !== this.generation) return;
        this.generation += 1; this.lastKey = '';
        this.emit({ type: 'SIGNED_OUT', identity: null, reason: 'session_expired' });
      });
    });
    return { unsubscribe: () => {
      this.handlers.delete(handler);
      data.subscription.unsubscribe();
    } };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const client = asClient(this.client);
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (error) throw toApiError(error, 'invalid_credentials');
    const identity = await this.sync('SIGNED_IN', data.session?.access_token);
    if (!identity) throw new ApiError('session_expired', 'Session invalide. Reconnectez-vous.');
    return { identity };
  }

  async signUp(payload: SignUpPayload): Promise<AuthResult> {
    const client = asClient(this.client);
    const email = payload.email.trim().toLowerCase();
    const { data, error } = await client.auth.signUp({
      email,
      password: payload.password,
      options: {
        emailRedirectTo: `${origin()}/connexion?confirmed=1`,
        data: {
          company_name: payload.companyName.trim(),
          station_name: payload.stationName.trim(),
          owner_name: payload.ownerName.trim(),
          city: payload.city.trim(),
          phone: payload.phone.trim(),
          invitation: false,
        },
      },
    });
    if (error) throw toApiError(error, 'signup_failed');
    // mailer_autoconfirm=false : pas de session avant confirmation e-mail.
    if (!data.session) {
      return {
        identity: null,
        confirmationRequired: true,
        message: 'Un e-mail de confirmation vient d’être envoyé. Ouvrez le lien, puis connectez-vous.',
      };
    }
    const identity = await this.sync('SIGNED_IN', data.session.access_token);
    return { identity };
  }

  async signOut(): Promise<void> {
    this.generation += 1;
    this.pending = null;
    this.pendingToken = undefined;
    this.lastKey = '';
    this.lastAcceptedKey = '';
    this.identity = null;
    const client = asClient(this.client);
    const { error } = await client.auth.signOut({ scope: 'global' });
    if (error) throw toApiError(error, 'signout_failed');
    this.lastKey = '';
    this.identity = null;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const client = asClient(this.client);
    const { error } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${origin()}/reinitialiser-mot-de-passe`,
    });
    // Ne jamais révéler si l'adresse existe : seules les limitations réseau
    // ou de débit sont remontées.
    if (error && /rate limit|too many|network|fetch/i.test(error.message ?? '')) {
      throw toApiError(error, 'reset_failed');
    }
  }

  async updatePassword(password: string): Promise<void> {
    if (password.length < 8) {
      throw new ApiError('weak_password', 'Choisissez un mot de passe d’au moins 8 caractères.');
    }
    const client = asClient(this.client);
    const { error } = await client.auth.updateUser({ password });
    if (error) throw toApiError(error, 'update_password_failed');
    await client.auth.signOut({ scope: 'global' }).catch(() => undefined);
  }

  async listUsers() {
    const client = asClient(this.client);
    const identity = await this.getIdentity();
    if (!identity) throw new ApiError('unauthenticated', 'Connectez-vous pour continuer.');
    const { data, error } = await client.rpc('my_company_users');
    if (error) throw toApiError(error, 'users_failed');
    return { identity, users: mapCompanyUsers(data) };
  }

  async listInvitations() {
    const client = asClient(this.client);
    const { data, error } = await client.rpc('my_company_invitations');
    if (error) throw toApiError(error, 'invitations_failed');
    return mapInvitations(data);
  }

  async invite(payload: InvitePayload) {
    const client = asClient(this.client);
    const { data, error } = await client.functions.invoke('invite-user', {
      body: {
        fullName: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone.trim(),
        roleKey: uiRoleToDb(payload.role),
        stationIds: payload.stationIds,
      },
    });
    if (error) throw toApiError(error, 'invite_failed');
    const result = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      id: typeof result.invitationId === 'string' ? result.invitationId : '',
      message: 'Invitation envoyée. Le collaborateur définira son mot de passe depuis le lien reçu.',
    };
  }

  async revokeInvitation(id: string): Promise<void> {
    const client = asClient(this.client);
    const { error } = await client.rpc('revoke_invitation', { p_invitation_id: id });
    if (error) throw toApiError(error, 'revoke_failed');
  }

  async updateUser(payload: UpdateUserPayload): Promise<void> {
    const client = asClient(this.client);
    const { error } = await client.rpc('admin_update_user', {
      p_user_id: payload.userId,
      p_role_key: payload.role ? uiRoleToDb(payload.role) : null,
      p_active: payload.active ?? null,
      p_station_ids: payload.stationIds ?? null,
    });
    if (error) throw toApiError(error, 'update_user_failed');
  }

  async refreshUsers(): Promise<AppUser[]> {
    const { identity, users } = await this.listUsers();
    return companyUsersToAppUsers(users, identity.companyId);
  }
}
