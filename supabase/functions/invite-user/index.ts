// Edge Function — invitation d'un employé (Prompt 04)
// Vérifie le JWT, la permission serveur et le périmètre des stations avant
// d'appeler l'API Admin Supabase Auth. Aucun secret n'est stocké dans le dépôt :
// SUPABASE_SERVICE_ROLE_KEY est fourni par l'environnement de la fonction.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type InvitePayload = {
  email?: unknown;
  fullName?: unknown;
  phone?: unknown;
  roleKey?: unknown;
  stationIds?: unknown;
};

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://5173-in4mdo7zgflqt72vpkywe.e2b.app',
]);
const ALLOWED_ROLES = new Set(['manager', 'cashier', 'washer']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : 'https://5173-in4mdo7zgflqt72vpkywe.e2b.app';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function reply(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function asText(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function tokenHash(): Promise<string> {
  const raw = crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers });
  if (req.method !== 'POST') return reply({ error: 'Méthode non autorisée' }, 405, headers);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return reply({ error: 'Configuration Supabase incomplète' }, 500, headers);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return reply({ error: 'Session requise', code: 'unauthenticated' }, 401, headers);

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: callerUser, error: callerError } = await caller.auth.getUser(jwt);
    if (callerError || !callerUser.user) {
      return reply({ error: 'Session invalide ou expirée', code: 'session_expired' }, 401, headers);
    }

    const { data: companyId, error: companyError } = await caller.rpc('current_company_id');
    if (companyError || !companyId) {
      return reply({ error: 'Aucune entreprise rattachée à ce compte', code: 'no_company' }, 403, headers);
    }
    const { data: allowed, error: permError } = await caller.rpc('has_permission', { p_key: 'employees.invite' });
    if (permError || allowed !== true) {
      return reply({ error: 'Permission employees.invite requise', code: 'forbidden' }, 403, headers);
    }

    const payload = (await req.json()) as InvitePayload;
    const email = asText(payload.email, 254).toLowerCase();
    const fullName = asText(payload.fullName, 120);
    const phone = asText(payload.phone, 40);
    const roleKey = asText(payload.roleKey, 40);
    const rawStations = Array.isArray(payload.stationIds) ? payload.stationIds : [];
    const stationIds = Array.from(new Set(
      rawStations.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    ));

    if (!EMAIL_RE.test(email) || fullName.length < 2) {
      return reply({ error: 'Adresse e-mail ou nom invalide', code: 'invalid_payload' }, 400, headers);
    }
    if (!ALLOWED_ROLES.has(roleKey)) {
      return reply({ error: 'Rôle non autorisé', code: 'invalid_role' }, 400, headers);
    }
    if (stationIds.length === 0 || stationIds.length !== rawStations.length) {
      return reply({ error: 'Affectation à au moins une station valide requise', code: 'invalid_stations' }, 400, headers);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: stations, error: stationsError } = await admin
      .from('stations').select('id').eq('company_id', companyId).in('id', stationIds);
    if (stationsError || !stations || stations.length !== stationIds.length) {
      return reply({ error: 'Stations hors périmètre de l’entreprise', code: 'invalid_stations' }, 400, headers);
    }

    const { data: role, error: roleError } = await admin
      .from('roles').select('id').is('company_id', null).eq('key', roleKey).maybeSingle();
    if (roleError || !role) {
      return reply({ error: 'Rôle introuvable', code: 'invalid_role' }, 400, headers);
    }

    const { data: existingProfile } = await admin
      .from('user_profiles').select('id').eq('company_id', companyId).eq('email', email).maybeSingle();
    if (existingProfile) {
      return reply({ error: 'Cette adresse e-mail est déjà utilisée', code: 'email_taken' }, 409, headers);
    }
    const { data: pending } = await admin
      .from('user_invitations').select('id').eq('company_id', companyId)
      .eq('email', email).is('accepted_at', null).is('revoked_at', null).maybeSingle();
    if (pending) {
      return reply({ error: 'Une invitation est déjà en attente', code: 'invitation_pending' }, 409, headers);
    }

    const origin = req.headers.get('origin');
    const redirectTo = `${ALLOWED_ORIGINS.has(origin ?? '') ? origin : 'https://5173-in4mdo7zgflqt72vpkywe.e2b.app'}/connexion?invite=1`;
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, phone, invitation: true },
    });
    if (inviteError || !invited.user) {
      return reply({ error: inviteError?.message ?? 'Invitation impossible', code: 'invite_failed' }, 400, headers);
    }
    const userId = invited.user.id;

    try {
      const { error: profileError } = await admin.from('user_profiles').insert({
        id: userId,
        company_id: companyId,
        full_name: fullName,
        email,
        phone,
        role_id: role.id,
        active: true,
      });
      if (profileError) throw profileError;

      const { error: assignmentError } = await admin.from('user_station_assignments').insert(
        stationIds.map((stationId) => ({ company_id: companyId, user_id: userId, station_id: stationId }))
      );
      if (assignmentError) throw assignmentError;

      const { data: invitation, error: invitationError } = await admin.from('user_invitations').insert({
        company_id: companyId,
        email,
        role_id: role.id,
        station_ids: stationIds,
        token_hash: await tokenHash(),
        invited_by: callerUser.user.id,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      }).select('id').single();
      if (invitationError) throw invitationError;

      return reply({ ok: true, userId, invitationId: invitation.id }, 200, headers);
    } catch (rollbackError) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      const message = rollbackError instanceof Error ? rollbackError.message : 'Création du profil impossible';
      return reply({ error: message, code: 'profile_failed' }, 500, headers);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inattendue';
    return reply({ error: message, code: 'internal_error' }, 500, headers);
  }
});
