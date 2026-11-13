import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from '../../types';
import { ApiError } from '../../types';
import type {
  AuthActivityEntry, AuthChange, AuthEvent, AuthPort, AuthResult, AuthSubscription,
  ResetTokenInspection, SecuritySession,
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

type SupaError = { message?: string; status?: number; code?: string; context?: unknown } | null | undefined;

const invitationUnconfirmed = 'Invitation non confirmée : un compte ou un e-mail peut déjà exister. Ne renvoyez pas l’invitation avant vérification par le support.';
const revocationUnconfirmed = 'Révocation non confirmée : elle a peut-être déjà été enregistrée. Vérifiez l’invitation et le compte avant de poursuivre.';
const accountUpdateUnconfirmed = 'Modification de compte non confirmée : elle a peut-être déjà été enregistrée. Ne répétez pas l’action avant vérification avec le support.';

/** Une erreur HTTP/transport ne prouve pas que l'appel Auth a été annulé. */
async function toInvitationError(error: SupaError): Promise<ApiError> {
  const response = error?.context;
  if (response instanceof Response) {
    try {
      const body: unknown = await response.clone().json();
      if (body && typeof body === 'object') {
        const result = body as Record<string, unknown>;
        const code = typeof result.code === 'string' ? result.code : '';
        // Ces réponses de la fonction ne surviennent qu'avant l'appel externe.
        const beforeAuth = ['invalid_payload', 'invalid_role', 'invalid_stations', 'unauthenticated',
          'session_expired', 'forbidden', 'no_company', 'reservation_refused'];
        if (beforeAuth.includes(code) && typeof result.error === 'string') {
          return new ApiError(code, result.error);
        }
        if (code === 'reservation_unconfirmed') {
          return new ApiError(code, 'Réservation non confirmée : aucun appel Auth n’a été effectué. Contactez le support avant de réessayer.');
        }
      }
    } catch { /* Corps absent ou illisible : résultat potentiellement incertain. */ }
  }
  return new ApiError('invite_unconfirmed', invitationUnconfirmed);
}

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
  if (typeof window === 'undefined' || !window.location?.origin || window.location.origin === 'null') {
    throw new Error('Origine de l’application indisponible pour le lien d’authentification.');
  }
  return window.location.origin;
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
    /** Facultatif : absent de certains doubles de test. */
    resend?(options: { type: 'signup'; email: string }): Promise<{ error: SupaError }>;
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
          requested_plan_id: payload.requestedPlanId ?? 'essai',
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
    let response: { data: unknown; error: SupaError };
    try {
      response = await client.functions.invoke('invite-user', {
        body: {
          fullName: payload.fullName.trim(),
          email: payload.email.trim().toLowerCase(),
          phone: payload.phone.trim(),
          roleKey: uiRoleToDb(payload.role),
          stationIds: payload.stationIds,
        },
      });
    } catch {
      throw new ApiError('invite_unconfirmed', invitationUnconfirmed);
    }
    if (!response || typeof response !== 'object' || !('error' in response) || !('data' in response)) {
      throw new ApiError('invite_unconfirmed', invitationUnconfirmed);
    }
    if (response.error) throw await toInvitationError(response.error);
    const result = (response.data && typeof response.data === 'object' ? response.data : {}) as Record<string, unknown>;
    if (result.ok !== true || typeof result.invitationId !== 'string' || !result.invitationId.trim()
      || typeof result.userId !== 'string' || !result.userId.trim()) {
      throw new ApiError('invite_unconfirmed', invitationUnconfirmed);
    }
    return {
      id: result.invitationId,
      message: 'Invitation envoyée. Le collaborateur définira son mot de passe depuis le lien reçu.',
    };
  }

  async revokeInvitation(id: string): Promise<void> {
    const client = asClient(this.client);
    let response: { data: unknown; error: SupaError };
    try {
      response = await client.rpc('revoke_invitation', { p_invitation_id: id });
    } catch {
      throw new ApiError('revoke_unconfirmed', revocationUnconfirmed);
    }
    if (!response || typeof response !== 'object' || !('error' in response) || !('data' in response)) {
      throw new ApiError('revoke_unconfirmed', revocationUnconfirmed);
    }
    if (response.error) {
      // Ces codes proviennent d'un refus transactionnel connu de la RPC. Un
      // transport, proxy ou corps invalide ne prouve pas l'absence de commit.
      if (['42501', '23514', 'P0002', '55000'].includes(response.error.code ?? '')) {
        throw toApiError(response.error, 'revoke_failed');
      }
      throw new ApiError('revoke_unconfirmed', revocationUnconfirmed);
    }
  }

  async updateUser(payload: UpdateUserPayload): Promise<void> {
    const client = asClient(this.client);
    let response: { data: unknown; error: SupaError };
    try {
      response = await client.rpc('admin_update_user', {
        p_user_id: payload.userId,
        p_role_key: payload.role ? uiRoleToDb(payload.role) : null,
        p_active: payload.active ?? null,
        p_station_ids: payload.stationIds ?? null,
      });
    } catch {
      throw new ApiError('update_unconfirmed', accountUpdateUnconfirmed);
    }
    if (!response || typeof response !== 'object' || !('error' in response) || !('data' in response)) {
      throw new ApiError('update_unconfirmed', accountUpdateUnconfirmed);
    }
    if (response.error) {
      // Un refus SQL connu annule la transaction. Une erreur réseau ou de
      // proxy ne prouve pas qu'une modification déjà envoyée a échoué.
      if (['42501', '23514', 'P0002', '55000'].includes(response.error.code ?? '')) {
        throw toApiError(response.error, 'update_user_failed');
      }
      throw new ApiError('update_unconfirmed', accountUpdateUnconfirmed);
    }
  }

  /**
   * Changement de mot de passe du compte connecté : Supabase Auth vérifie la
   * session, l'ancien mot de passe n'est pas redemandé par le fournisseur.
   */
  async changePassword(_currentPassword: string, newPassword: string): Promise<{ revoked: number }> {
    const client = asClient(this.client);
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw toApiError(error, 'password_update_failed');
    let revoked = 0;
    try {
      const others = await client.auth.signOut({ scope: 'others' });
      if (!others.error) revoked = -1;
    } catch {
      // La déconnexion des autres appareils reste facultative : ne pas laisser
      // croire qu'elle a réussi.
      revoked = 0;
    }
    return { revoked };
  }

  /** `supabase-js` n'expose pas la liste des sessions : l'UI l'annonce. */
  async listSessions(): Promise<SecuritySession[]> {
    return [];
  }

  async revokeSession(_sessionId: string): Promise<{ signedOut: boolean }> {
    throw new ApiError('not_supported', 'La révocation d’une session précise n’est pas exposée par Supabase Auth.');
  }

  async revokeOtherSessions(): Promise<number> {
    const client = asClient(this.client);
    const { error } = await client.auth.signOut({ scope: 'others' });
    if (error) throw toApiError(error, 'signout_failed');
    return -1;
  }

  async verifyResetToken(_token: string): Promise<ResetTokenInspection> {
    // Le lien est vérifié par Supabase Auth lui-même à l'ouverture.
    return { valid: false, expiresAt: null };
  }

  async listAuthActivity(_limit = 20): Promise<AuthActivityEntry[]> {
    return [];
  }

  async confirmEmail(_token: string): Promise<void> {
    throw new ApiError('not_supported', 'La confirmation est gérée par le lien envoyé par Supabase Auth.');
  }

  async resendConfirmation(email: string): Promise<{ confirmUrl?: string; linkExposed?: boolean }> {
    const client = asClient(this.client);
    if (typeof client.auth.resend !== 'function') {
      throw new ApiError('not_supported', 'Le renvoi de confirmation n’est pas disponible avec ce client.');
    }
    const { error } = await client.auth.resend({ type: 'signup', email });
    if (error) throw toApiError(error, 'confirmation_failed');
    return { linkExposed: false };
  }

  async refreshUsers(): Promise<AppUser[]> {
    const { identity, users } = await this.listUsers();
    return companyUsersToAppUsers(users, identity.companyId);
  }
}
