// Edge Function — le service Auth n'est appelé qu'après réservation atomique
// d'une place et validation serveur du périmètre, du quota et de l'abonnement.
// La clé service est fournie par l'environnement, jamais par le navigateur.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { createInvitationHandler, type InvitationClient } from '../_shared/invitation.ts';

const configuredOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean);
const defaultOrigin = Deno.env.get('APP_ORIGIN') ?? 'https://lavauto-five.vercel.app';
const allowedOrigins = Array.from(new Set([
  defaultOrigin, ...configuredOrigins, 'http://localhost:5173', 'http://127.0.0.1:5173',
]));

Deno.serve(createInvitationHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  allowedOrigins,
  defaultOrigin,
  makeClient: (url, key, authorization) => createClient(url, key, {
    global: authorization ? { headers: { Authorization: authorization } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as InvitationClient,
}));
