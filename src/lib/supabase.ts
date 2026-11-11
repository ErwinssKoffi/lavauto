import { createClient, type SupabaseClient, type Session as SupabaseSession, type User as SupabaseUser } from '@supabase/supabase-js';
import type { Role } from '../types';

// ─── Client Supabase & Gestionnaire d'Authentification Sécurisée ───────────────
// Gère la session JWT avec persistance en sessionStorage et auto-refresh des tokens.
// En l'absence de variables d'environnement, l'application bascule automatiquement
// sur le mode dual-driver local (store.tsx) sans bloquer le rendu utilisateur.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Options de configuration sécurisée du client Supabase
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

/** Récupère la session JWT courante si Supabase est branché */
export async function getSupabaseSession(): Promise<SupabaseSession | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[Supabase Auth] Erreur récupération session:', error.message);
      return null;
    }
    return data.session;
  } catch (err) {
    console.warn('[Supabase Auth] Exception getSession:', err);
    return null;
  }
}

/** Connexion e-mail / mot de passe avec Supabase Auth */
export async function signInWithSupabase(email: string, password: string) {
  if (!supabase) throw new Error('Supabase n’est pas configuré.');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return data;
}

/** Inscription d'un propriétaire avec métadonnées d'entreprise */
export async function signUpWithSupabase(
  email: string,
  password: string,
  metadata: {
    name: string;
    phone: string;
    companyName: string;
    stationName: string;
    city: string;
  }
) {
  if (!supabase) throw new Error('Supabase n’est pas configuré.');
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        full_name: metadata.name,
        phone: metadata.phone,
        company_name: metadata.companyName,
        station_name: metadata.stationName,
        city: metadata.city,
        role: 'proprietaire',
      },
    },
  });
  if (error) throw error;
  return data;
}

/** Déconnexion et invalidation de la session */
export async function signOutWithSupabase(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn('[Supabase Auth] Erreur signOut:', err);
  }
}

/** Mise à jour du mot de passe de l'utilisateur connecté */
export async function updateSupabasePassword(newPassword: string) {
  if (!supabase) throw new Error('Supabase n’est pas configuré.');
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
  return data;
}

/** Invitation d'un employé / collaborateur avec attribution de rôle */
export async function inviteCollaboratorWithSupabase(params: {
  email: string;
  role: Role;
  name: string;
  phone?: string;
  stationId?: string;
}) {
  if (!supabase) throw new Error('Supabase n’est pas configuré.');
  // Via Supabase Edge Function ou admin invite
  const { data, error } = await supabase.functions.invoke('invite-collaborator', {
    body: {
      email: params.email.trim().toLowerCase(),
      role: params.role,
      name: params.name.trim(),
      phone: params.phone?.trim() ?? '',
      station_id: params.stationId ?? null,
    },
  });
  if (error) throw error;
  return data;
}
