// Parcours d'invitation injectable et testable sans réseau. La base réserve
// d'abord une place, puis finalise profil, affectations et invitation en une
// seule transaction. L'API Auth externe n'est pas transactionnelle avec SQL.
export interface InvitationClient {
  auth: {
    getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    admin: {
      inviteUserByEmail(email: string, options: { redirectTo: string; data: Record<string, unknown> }): Promise<{
        data: { user: { id: string } | null }; error: unknown;
      }>;
    };
  };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { code?: string; message?: string } | null; status?: number;
  }>;
}

export interface InvitationDependencies {
  url: string;
  anonKey: string;
  serviceKey: string;
  allowedOrigins: string[];
  defaultOrigin: string;
  makeClient(url: string, key: string, authorization?: string): InvitationClient;
}

const ROLES = new Set(['manager', 'cashier', 'washer']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]+$/;
const uncertain = 'Invitation non confirmée : un compte ou un e-mail peut déjà exister. Ne renvoyez pas l’invitation avant vérification par le support.';

function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function confirmed(value: unknown, userId?: string): { userId: string; invitationId: string } | null {
  const item = object(value);
  if (!item || typeof item.userId !== 'string' || !UUID.test(item.userId)
    || typeof item.invitationId !== 'string' || !UUID.test(item.invitationId)
    || (userId && item.userId.toLowerCase() !== userId.toLowerCase())) return null;
  return { userId: item.userId, invitationId: item.invitationId };
}
async function tokenHash(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(crypto.randomUUID()));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createInvitationHandler(deps: InvitationDependencies) {
  const allowed = new Set(deps.allowedOrigins);
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const redirectOrigin = origin && allowed.has(origin) ? origin : deps.defaultOrigin;
    const headers = {
      'Access-Control-Allow-Origin': redirectOrigin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
      'Vary': 'Origin',
    };
    const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers });
    if (req.method !== 'POST') return reply({ error: 'Méthode non autorisée', code: 'method' }, 405);
    if (!deps.url || !deps.anonKey || !deps.serviceKey) return reply({ error: 'Configuration Supabase incomplète', code: 'configuration' }, 500);
    const authHeader = req.headers.get('Authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) return reply({ error: 'Session requise', code: 'unauthenticated' }, 401);
    const caller = deps.makeClient(deps.url, deps.anonKey, authHeader);
    try {
      const { data, error } = await caller.auth.getUser(match[1]);
      if (error || !data.user) return reply({ error: 'Session invalide ou expirée', code: 'session_expired' }, 401);
    } catch {
      return reply({ error: 'Session non vérifiée. Réessayez plus tard.', code: 'session_unconfirmed' }, 503);
    }

    let payload: Record<string, unknown> | null;
    try { payload = object(await req.json()); } catch { payload = null; }
    const email = string(payload?.email).toLowerCase();
    const fullName = string(payload?.fullName);
    const phone = string(payload?.phone);
    const roleKey = string(payload?.roleKey);
    const rawStations = Array.isArray(payload?.stationIds) ? payload.stationIds : [];
    const stationIds = rawStations.filter((id): id is string => typeof id === 'string' && UUID.test(id)).map((id) => id.toLowerCase());
    if (!EMAIL.test(email) || email.length > 254 || fullName.length < 2 || fullName.length > 120
      || (phone && (phone.length > 40 || !PHONE.test(phone) || !/^[0-9]{7,15}$/.test(phone.replace(/[^0-9]/g, ''))))) {
      return reply({ error: 'Adresse e-mail, nom ou téléphone invalide', code: 'invalid_payload' }, 400);
    }
    if (!ROLES.has(roleKey)) return reply({ error: 'Rôle non autorisé', code: 'invalid_role' }, 400);
    if (stationIds.length === 0 || stationIds.length > 50 || stationIds.length !== rawStations.length
      || new Set(stationIds).size !== stationIds.length) {
      return reply({ error: 'Affectation à au moins une station valide requise', code: 'invalid_stations' }, 400);
    }

    // Même en cas de réponse perdue, une éventuelle réservation reste comptée.
    // Aucun appel Auth externe n'a été effectué avant la confirmation de cette RPC.
    let reservationId: string;
    try {
      const result = await caller.rpc('reserve_user_invitation', {
        p_email: email, p_full_name: fullName, p_phone: phone, p_role_key: roleKey, p_station_ids: stationIds,
      });
      if (result.error) {
        const code = result.error.code;
        if (code === '42501' || code === '23514' || code === '23505') {
          return reply({ error: result.error.message ?? 'Invitation refusée avant appel Auth.', code: 'reservation_refused' }, code === '42501' ? 403 : code === '23505' ? 409 : 400);
        }
        return reply({ error: 'Réservation non confirmée. Aucun appel Auth n’a été effectué ; contactez le support avant de réessayer.', code: 'reservation_unconfirmed' }, 503);
      }
      if (typeof result.data !== 'string' || !UUID.test(result.data)) throw new Error('Réservation illisible');
      reservationId = result.data;
    } catch {
      return reply({ error: 'Réservation non confirmée. Aucun appel Auth n’a été effectué ; contactez le support avant de réessayer.', code: 'reservation_unconfirmed' }, 503);
    }

    const admin = deps.makeClient(deps.url, deps.serviceKey);
    let userId: string;
    try {
      const invited = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${redirectOrigin}/connexion?invite=1`,
        data: { full_name: fullName, phone, invitation: true, invitation_reservation_id: reservationId },
      });
      if (invited.error || !invited.data.user || !UUID.test(invited.data.user.id)) throw new Error('Réponse Auth non confirmée');
      userId = invited.data.user.id;
    } catch {
      // Ne pas libérer la place ni supprimer un compte dont l'état est inconnu.
      return reply({ error: uncertain, code: 'invite_unconfirmed' }, 502);
    }

    try {
      const result = await admin.rpc('finalize_user_invitation', {
        p_reservation: reservationId, p_user: userId, p_token_hash: await tokenHash(),
      });
      const value = !result.error ? confirmed(result.data, userId) : null;
      if (value) return reply({ ok: true, ...value }, 200);
    } catch { /* La transaction peut avoir été commitée malgré une réponse perdue. */ }

    // Cette lecture verrouille la réservation : elle attend une finalisation
    // encore en cours et empêche une finalisation tardive après mise en attente
    // de rapprochement. Ne jamais supprimer automatiquement le compte Auth.
    try {
      const result = await admin.rpc('inspect_user_invitation', { p_reservation: reservationId, p_user: userId });
      const value = !result.error && object(result.data)?.status === 'finalized' ? confirmed(result.data, userId) : null;
      if (value) return reply({ ok: true, ...value }, 200);
    } catch { /* Le support devra rapprocher Auth et SQL. */ }
    return reply({ error: uncertain, code: 'profile_unconfirmed' }, 502);
  };
}
