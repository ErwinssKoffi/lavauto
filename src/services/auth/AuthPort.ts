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
  /** Lien de confirmation renvoyé uniquement lorsque le serveur l'expose
   *  (développement) ; jamais en production. */
  confirmUrl?: string;
}

// ─── Sécurité du compte (connexion, sessions, mot de passe) ─────────────────

/** Une session active. Le jeton n'est jamais exposé au navigateur. */
export interface SecuritySession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** Libellé lisible (« Chrome · Android »), jamais la chaîne brute. */
  userAgent: string;
  ipAddress: string;
  rememberMe: boolean;
  /** Session utilisée par cet onglet. */
  current: boolean;
}

export interface AuthActivityEntry {
  event: string;
  detail: string;
  at: string;
  ipAddress: string;
  device: string;
}

export interface ResetTokenInspection {
  valid: boolean;
  expiresAt: string | null;
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
  /** Vérifie un lien de réinitialisation sans le consommer. */
  verifyResetToken(token: string): Promise<ResetTokenInspection>;
  /** Changement de mot de passe d'un utilisateur connecté (mot de passe actuel exigé). */
  changePassword(currentPassword: string, newPassword: string): Promise<{ revoked: number }>;
  /** Sessions actives du compte connecté. */
  listSessions(): Promise<SecuritySession[]>;
  /** Ferme une session précise de ce compte. */
  revokeSession(sessionId: string): Promise<{ signedOut: boolean }>;
  /** Ferme toutes les autres sessions ; renvoie le nombre fermé. */
  revokeOtherSessions(): Promise<number>;
  /** Journal d'authentification personnel (20 derniers événements par défaut). */
  listAuthActivity(limit?: number): Promise<AuthActivityEntry[]>;
  /** Consomme un lien de confirmation d'e-mail. */
  confirmEmail(token: string): Promise<void>;
  /** Demande un nouveau lien de confirmation, sans révéler l'existence du compte. */
  resendConfirmation(email: string): Promise<{ confirmUrl?: string; linkExposed?: boolean }>;
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
