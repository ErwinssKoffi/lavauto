import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Client Supabase publishable (Prompts 03–04) ─────────────────────────────
// Ce client sert aux lectures RLS et à Supabase Auth. La session est persistée
// par supabase-js, mais elle n'est JAMAIS une source d'autorité : le store
// attend `onAuthStateChange`, vérifie le JWT avec `auth.getUser()` puis relit
// `my_context()` côté serveur. Un JWT forgé dans localStorage est rejeté.
// Seule la clé PUBLISHABLE/anon est acceptée ici. Aucune clé de service, aucun
// secret et aucun mot de passe ne doivent figurer dans un fichier VITE_*.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;
