import type { AppUser } from '../../types';
import type {
  AuthIdentity, CompanyUser, Invitation, InvitePayload, SignUpPayload, UpdateUserPayload,
} from './authTypes';

// ─── Port d'authentification (Prompt 04) ─────────────────────────────────────
// Le store ne connaît ni Supabase ni localStorage : il dépend de ce port.
// Aucune méthode n'accepte d'identifiant de tenant ; le serveur le dérive
// toujours de auth.uid(). `onAuthStateChange` est l'unique source de vérité :
// `getSession()` n'est jamais utilisé pour décider d'un accès.

export type AuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'TOKEN_REFRESHED'
  | 'SIGNED_OUT'
  | 'PASSWORD_RECOVERY';

export interface AuthChange {
  type: AuthEvent;
  identity: AuthIdentity | null;
  /** Motif contrôlé, pour afficher un message sans jamais forger la session. */
  reason?: 'account_disabled' | 'email_unconfirmed' | 'session_expired' | 'no_profile';
}

export interface AuthSubscription { unsubscribe(): void }

export interface AuthResult {
  identity: AuthIdentity | null;
  confirmationRequired?: boolean;
  message?: string;
}

export interface AuthPort {
  readonly kind: 'api' | 'supabase' | 'local';
  getIdentity(): Promise<AuthIdentity | null>;
  onAuthStateChange(handler: (change: AuthChange) => void): AuthSubscription;
  signIn(email: string, password: string, rememberMe?: boolean): Promise<AuthResult>;
  signUp(payload: SignUpPayload): Promise<AuthResult>;
  signOut(): Promise<void>;
  /** `demoMode` n'est vrai que si le serveur a réellement renvoyé un lien de démonstration. */
  requestPasswordReset(email: string): Promise<{ resetUrl?: string; demoMode?: boolean } | void>;
  updatePassword(password: string, token?: string): Promise<void>;
  listUsers(): Promise<{ identity: AuthIdentity; users: CompanyUser[] }>;
  listInvitations(): Promise<Invitation[]>;
  invite(payload: InvitePayload): Promise<{ id: string; message?: string; inviteUrl?: string }>;
  revokeInvitation(id: string): Promise<void>;
  updateUser(payload: UpdateUserPayload): Promise<void>;
  refreshUsers(): Promise<AppUser[]>;
}

export function roleRank(role: string): number {
  const ranks: Record<string, number> = {
    laveur: 1, caissier: 2, gerant: 3, proprietaire: 4, super_admin: 5, support: 0,
  };
  return ranks[role] ?? 0;
}
