import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Supabase (prêt, pas encore branché) ─────────────────────────────────────
// Le frontend tourne aujourd'hui sur une couche de données locale
// (voir store.tsx) qui reproduit les règles métier : onboarding constaté
// par le serveur, 409 onboarding_incomplete, caisse, commissions…
// Quand les variables ci-dessous sont renseignées, ce client devient
// utilisable et les actions du store pourront appeler Supabase
// (tables : companies, stations, users, services, vehicle_categories,
// clients, washes, wash_items, payments, cash_sessions, expenses,
// plans, subscriptions, audit_logs) à la place du stockage local.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
