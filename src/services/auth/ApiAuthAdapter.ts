import type { AppUser } from '../../types';
import { apiFetch } from '../api/apiClient';
import type {
  AuthActivityEntry, AuthChange, AuthPort, AuthResult, AuthSubscription, ResetTokenInspection,
  SecuritySession,
} from './AuthPort';
import type {
  AuthIdentity, CompanyUser, Invitation, InvitePayload, SignUpPayload, UpdateUserPayload,
} from './authTypes';

type Listener = (change: AuthChange) => void;

/**
 * PostgreSQL renvoie `2026-11-13 08:35:33.954+00`. Ce format n'est pas garanti
 * par la norme ECMAScript : le convertir en ISO 8601 avant affichage évite
 * « Invalid Date » sur Safari.
 */
function toIso(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(value);
  if (match) return `${match[1]}T${match[2]}${match[3]}:${match[4] ?? '00'}`;
  return value;
}

export class ApiAuthAdapter implements AuthPort {
  readonly kind = 'api' as const;
  private listeners = new Set<Listener>();
  private currentIdentity: AuthIdentity | null = null;
  private initialized = false;
  /** Jeton présent mais expiré : motif affiché une seule fois. */
  private expiredOnce = false;

  private emit(change: AuthChange): void {
    this.currentIdentity = change.identity;
    this.listeners.forEach((fn) => fn(change));
  }

  async getIdentity(): Promise<AuthIdentity | null> {
    const res = await apiFetch<{ identity: AuthIdentity | null; expired?: boolean }>('/api/auth/me');
    this.currentIdentity = res.identity;
    if (!res.identity && res.expired) this.expiredOnce = true;
    return res.identity;
  }

  onAuthStateChange(handler: Listener): AuthSubscription {
    this.listeners.add(handler);
    if (!this.initialized) {
      this.initialized = true;
      void this.getIdentity()
        .then((identity) => {
          const reason = identity && !identity.active
            ? 'account_disabled' as const
            : !identity && this.expiredOnce
              ? 'session_expired' as const
              : undefined;
          this.expiredOnce = false;
          this.emit({ type: 'INITIAL_SESSION', identity: reason ? null : identity, reason });
        })
        .catch(() => {
          this.emit({ type: 'INITIAL_SESSION', identity: null });
        });
    } else {
      queueMicrotask(() => {
        handler({ type: 'INITIAL_SESSION', identity: this.currentIdentity });
      });
    }
    return {
      unsubscribe: () => { this.listeners.delete(handler); },
    };
  }

  async signIn(email: string, password: string, rememberMe = true): Promise<AuthResult> {
    const res = await apiFetch<{ identity: AuthIdentity | null }>('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe }),
    });
    this.emit({ type: 'SIGNED_IN', identity: res.identity });
    return { identity: res.identity };
  }

  async signUp(payload: SignUpPayload): Promise<AuthResult> {
    const res = await apiFetch<AuthResult>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.identity) {
      this.emit({ type: 'SIGNED_IN', identity: res.identity });
    }
    return res;
  }

  async signOut(): Promise<void> {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/signout', { method: 'POST' });
    } finally {
      this.emit({ type: 'SIGNED_OUT', identity: null });
    }
  }

  async requestPasswordReset(email: string): Promise<{ resetUrl?: string; demoMode?: boolean } | void> {
    const res = await apiFetch<{ ok: boolean; resetUrl?: string; demoMode?: boolean }>(
      '/api/auth/forgot-password',
      { method: 'POST', body: JSON.stringify({ email }) },
    );
    // Le serveur ne renvoie un lien QUE si WASHGUARD_DEMO_RESET=1 hors production.
    // `demoMode` rend cet état explicite pour l'interface.
    if (res?.resetUrl) return { resetUrl: res.resetUrl, demoMode: true };
    return { demoMode: false };
  }

  async updatePassword(password: string, token?: string): Promise<void> {
    await apiFetch<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ password, ...(token ? { token } : {}) }),
    });
  }

  async verifyResetToken(token: string): Promise<ResetTokenInspection> {
    if (!token) return { valid: false, expiresAt: null };
    const res = await apiFetch<{ valid: boolean; expiresAt?: string | null }>(
      `/api/auth/reset-password/verify?token=${encodeURIComponent(token)}`,
    );
    return { valid: Boolean(res.valid), expiresAt: res.expiresAt ? toIso(res.expiresAt) : null };
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ revoked: number }> {
    const res = await apiFetch<{ ok: boolean; revoked?: number }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return { revoked: res.revoked ?? 0 };
  }

  async listSessions(): Promise<SecuritySession[]> {
    const res = await apiFetch<{ sessions: SecuritySession[] }>('/api/auth/sessions');
    return res.sessions.map((session) => ({
      ...session,
      createdAt: toIso(session.createdAt),
      lastSeenAt: toIso(session.lastSeenAt),
      expiresAt: toIso(session.expiresAt),
    }));
  }

  async revokeSession(sessionId: string): Promise<{ signedOut: boolean }> {
    const res = await apiFetch<{ ok: boolean; signedOut?: boolean }>(
      `/api/auth/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { method: 'POST' },
    );
    if (res.signedOut) this.emit({ type: 'SIGNED_OUT', identity: null });
    return { signedOut: Boolean(res.signedOut) };
  }

  async revokeOtherSessions(): Promise<number> {
    const res = await apiFetch<{ ok: boolean; revoked?: number }>('/api/auth/sessions/revoke-others', {
      method: 'POST',
    });
    return res.revoked ?? 0;
  }

  async listAuthActivity(limit = 20): Promise<AuthActivityEntry[]> {
    const res = await apiFetch<{ events: AuthActivityEntry[] }>(`/api/auth/activity?limit=${limit}`);
    return res.events.map((event) => ({ ...event, at: toIso(event.at) }));
  }

  async confirmEmail(token: string): Promise<void> {
    await apiFetch<{ ok: boolean }>('/api/auth/confirm-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async resendConfirmation(email: string): Promise<{ confirmUrl?: string; linkExposed?: boolean }> {
    const res = await apiFetch<{ ok: boolean; confirmUrl?: string; linkExposed?: boolean }>(
      '/api/auth/resend-confirmation',
      { method: 'POST', body: JSON.stringify({ email }) },
    );
    return { confirmUrl: res.confirmUrl, linkExposed: res.linkExposed };
  }

  async listUsers(): Promise<{ identity: AuthIdentity; users: CompanyUser[] }> {
    const res = await apiFetch<{ identity: AuthIdentity; users: CompanyUser[] }>('/api/employees');
    this.currentIdentity = res.identity;
    return res;
  }

  async listInvitations(): Promise<Invitation[]> {
    const res = await apiFetch<{ invitations: Invitation[] }>('/api/employees');
    return res.invitations;
  }

  async invite(payload: InvitePayload): Promise<{ id: string; message?: string; inviteUrl?: string }> {
    return apiFetch<{ id: string; message?: string; inviteUrl?: string }>('/api/employees/invite', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async revokeInvitation(id: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/api/employees/invitations/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    });
  }

  async updateUser(payload: UpdateUserPayload): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/api/employees/${encodeURIComponent(payload.userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async refreshUsers(): Promise<AppUser[]> {
    const res = await apiFetch<{
      identity: AuthIdentity;
      users: (CompanyUser & { commissionRateOverride?: number | null })[];
    }>('/api/employees');
    this.currentIdentity = res.identity;
    return res.users.map((u) => ({
      id: u.id,
      companyId: res.identity.companyId,
      stationId: u.stationIds[0] ?? res.identity.stationIds[0] ?? null,
      name: u.fullName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      active: u.active,
      commissionRateOverride: u.commissionRateOverride ?? null,
      createdAt: u.createdAt,
      stationIds: u.stationIds,
    }));
  }
}
