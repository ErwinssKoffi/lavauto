import type { AppUser } from '../../types';
import { apiFetch } from '../api/apiClient';
import type { AuthChange, AuthPort, AuthResult, AuthSubscription } from './AuthPort';
import type {
  AuthIdentity, CompanyUser, Invitation, InvitePayload, SignUpPayload, UpdateUserPayload,
} from './authTypes';

type Listener = (change: AuthChange) => void;

export class ApiAuthAdapter implements AuthPort {
  readonly kind = 'api' as const;
  private listeners = new Set<Listener>();
  private currentIdentity: AuthIdentity | null = null;
  private initialized = false;

  private emit(change: AuthChange): void {
    this.currentIdentity = change.identity;
    this.listeners.forEach((fn) => fn(change));
  }

  async getIdentity(): Promise<AuthIdentity | null> {
    const res = await apiFetch<{ identity: AuthIdentity | null }>('/api/auth/me');
    this.currentIdentity = res.identity;
    return res.identity;
  }

  onAuthStateChange(handler: Listener): AuthSubscription {
    this.listeners.add(handler);
    if (!this.initialized) {
      this.initialized = true;
      void this.getIdentity()
        .then((identity) => {
          const reason = identity && !identity.active ? 'account_disabled' as const : undefined;
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

  async requestPasswordReset(email: string): Promise<{ resetUrl?: string } | void> {
    return apiFetch<{ ok: boolean; resetUrl?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async updatePassword(password: string, token?: string): Promise<void> {
    await apiFetch<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ password, ...(token ? { token } : {}) }),
    });
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
