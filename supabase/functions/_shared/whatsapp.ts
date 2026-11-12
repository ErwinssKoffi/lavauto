// Code partagé entre les Edge Functions et les tests locaux. Aucun secret n'est
// fourni par le navigateur et aucune donnée reçue n'est journalisée en clair.
export type Environment = (name: string) => string | undefined;
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_ID = /^[0-9]{3,32}$/;
const RECIPIENT = /^\+[1-9][0-9]{7,14}$/;
const MESSAGE_ID = /^wamid\.[^\s]{1,250}$/;
const MAX_BODY = 1_048_576;

export interface DispatchConfig {
  company: string;
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  graphVersion: string;
}
export interface WebhookConfig {
  company: string;
  phoneNumberId: string;
  wabaId: string;
  verifyToken: string;
  appSecret: string;
}
export interface ClaimedWash {
  id: string;
  phone: string;
  washNumber: string;
  stationName: string;
}
export type SendResult =
  | { result: 'accepted'; messageId: string; reason: string | null }
  | { result: 'failed' | 'unknown'; messageId: null; reason: string };

function val(env: Environment, name: string): string {
  return (env(name) ?? '').trim();
}
function configuredDispatch(env: Environment): DispatchConfig | null {
  const company = val(env, 'WHATSAPP_COMPANY_ID');
  const phoneNumberId = val(env, 'META_PHONE_NUMBER_ID');
  const accessToken = val(env, 'META_ACCESS_TOKEN');
  const templateName = val(env, 'META_TEMPLATE_NAME');
  const templateLanguage = val(env, 'META_TEMPLATE_LANGUAGE');
  const graphVersion = val(env, 'META_GRAPH_VERSION');
  if (!UUID.test(company) || !PHONE_ID.test(phoneNumberId) || accessToken.length < 20
    || !/^[a-z0-9_]{1,128}$/.test(templateName)
    || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)
    || !/^v[1-9][0-9]?\.[0-9]+$/.test(graphVersion)) return null;
  return { company, phoneNumberId, accessToken, templateName, templateLanguage, graphVersion };
}
function configuredWebhook(env: Environment): WebhookConfig | null {
  const company = val(env, 'WHATSAPP_COMPANY_ID');
  const phoneNumberId = val(env, 'META_PHONE_NUMBER_ID');
  const wabaId = val(env, 'META_WABA_ID');
  const verifyToken = val(env, 'META_VERIFY_TOKEN');
  const appSecret = val(env, 'META_APP_SECRET');
  if (!UUID.test(company) || !PHONE_ID.test(phoneNumberId) || !PHONE_ID.test(wabaId)
    || verifyToken.length < 32 || appSecret.length < 32) return null;
  return { company, phoneNumberId, wabaId, verifyToken, appSecret };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  // Ne s'arrête pas au premier octet différent.
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return difference === 0;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function claim(value: unknown): ClaimedWash | null {
  const v = object(value);
  if (!v) return null;
  const id = text(v.id), phone = text(v.phone), washNumber = text(v.washNumber), stationName = text(v.stationName);
  if (!UUID.test(id) || !RECIPIENT.test(phone) || !washNumber.trim() || !stationName.trim()) return null;
  return { id, phone, washNumber, stationName };
}
function parameter(value: string): string {
  // Meta refuse les retours à la ligne et les longues séquences d'espaces.
  return value.replace(/[\s\u00a0]+/gu, ' ').trim().slice(0, 100);
}

/** Modèle transactionnel fixe : {{1}} = numéro de fiche, {{2}} = station. */
export function buildMetaPayload(config: DispatchConfig, item: ClaimedWash): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    to: item.phone.slice(1), type: 'template', biz_opaque_callback_data: item.id,
    template: {
      name: config.templateName, language: { code: config.templateLanguage },
      components: [{ type: 'body', parameters: [
        { type: 'text', text: parameter(item.washNumber) },
        { type: 'text', text: parameter(item.stationName) },
      ] }],
    },
  };
}

/** Aucune relance implicite : une réponse réseau indécise reste « unknown ». */
export async function sendToMeta(config: DispatchConfig, item: ClaimedWash, fetcher: Fetcher = fetch): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMetaPayload(config, item)), signal: controller.signal,
    });
    let json: Record<string, unknown> | null = null;
    try { json = object(await response.json()); } catch { /* corps absent ou non JSON */ }
    const messages = Array.isArray(json?.messages) ? json.messages : [];
    const message = object(messages[0]);
    const messageId = text(message?.id);
    if (response.ok && MESSAGE_ID.test(messageId)) {
      const held = message?.message_status === 'held_for_quality_assessment';
      return { result: 'accepted', messageId, reason: held ? 'held_for_quality_assessment' : null };
    }
    if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408) {
      const error = object(json?.error);
      // Une simple page d'erreur d'un intermédiaire ne prouve pas que Meta a
      // refusé le message. Seul un refus Graph explicite autorise une relance.
      if (typeof error?.code === 'number' && Number.isSafeInteger(error.code) && error.code >= 0) {
        return { result: 'failed', messageId: null, reason: `http_${response.status}:meta_${error.code}` };
      }
    }
    return { result: 'unknown', messageId: null, reason: response.ok ? 'missing_message_id' : `http_${response.status}` };
  } catch {
    // Timeout, connexion coupée, erreur DNS : Meta a peut-être reçu le POST.
    return { result: 'unknown', messageId: null, reason: 'network_uncertain' };
  } finally {
    clearTimeout(timer);
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function boundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Appelé uniquement par un ordonnanceur serveur portant son secret distinct. */
export function makeDispatchHandler(env: Environment, rpc: Rpc, fetcher: Fetcher = fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    const secret = val(env, 'WHATSAPP_DISPATCH_SECRET');
    if (secret.length < 32) return jsonResponse(503, { error: 'dispatch_not_configured' });
    if (!constantTimeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
      return jsonResponse(401, { error: 'unauthorized' });
    }
    // L'activation est explicite. Exiger aussi la configuration de réception :
    // sans webhook, il serait impossible de constater la livraison réelle.
    const config = configuredDispatch(env);
    if (val(env, 'WHATSAPP_SEND_ENABLED') !== 'true' || !config || !configuredWebhook(env)) {
      return jsonResponse(503, { error: 'provider_not_configured' });
    }
    try {
      await rpc('expire_wash_whatsapp_claims', { p_company: config.company });
      let processed = 0;
      // Maximum borné : le prochain passage de l'ordonnanceur poursuit la file.
      for (; processed < 20; processed++) {
        const raw = await rpc('claim_wash_whatsapp', { p_company: config.company, p_phone_number_id: config.phoneNumberId });
        if (raw === null) break;
        const item = claim(raw);
        if (!item) {
          // Si l'identifiant est lisible, débloquer en échec sans appeler Meta.
          const id = text(object(raw)?.id);
          if (UUID.test(id)) {
            await rpc('finish_wash_whatsapp', {
              p_company: config.company, p_notification: id, p_result: 'failed',
              p_message_id: null, p_reason: 'invalid_claim',
            });
            continue;
          }
          throw new Error('invalid_claim');
        }
        const result = await sendToMeta(config, item, fetcher);
        await rpc('finish_wash_whatsapp', {
          p_company: config.company, p_notification: item.id, p_result: result.result,
          p_message_id: result.messageId, p_reason: result.reason,
        });
      }
      return jsonResponse(200, { processed });
    } catch {
      // Pas de numéro, de contenu ou d'exception fournisseur dans les logs HTTP.
      // Une ligne déjà réclamée restera incertaine après expiration, pas réémise.
      return jsonResponse(500, { error: 'dispatch_failed' });
    }
  };
}

export async function validMetaSignature(body: Uint8Array, signature: string | null, appSecret: string): Promise<boolean> {
  if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature) || !appSecret) return false;
  const hex = signature.slice(7);
  const bytes = new Uint8Array(hex.match(/../g)!.map((part) => Number.parseInt(part, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // Copie sur ArrayBuffer ordinaire : compatible Web Crypto et ses types, y
  // compris lorsque l'appelant fournit une vue sur SharedArrayBuffer.
  return crypto.subtle.verify('HMAC', key, bytes, new Uint8Array(body));
}

export interface ProviderStatus {
  notification: string | null;
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  reason: string | null;
}

/** Ne retient ni messages entrants, ni numéro, ni contenu du webhook. */
export function extractStatuses(value: unknown, config: WebhookConfig): ProviderStatus[] {
  const payload = object(value);
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return [];
  const statuses: ProviderStatus[] = [];
  for (const rawEntry of payload.entry) {
    const entry = object(rawEntry);
    if (entry?.id !== config.wabaId || !Array.isArray(entry.changes)) continue;
    for (const rawChange of entry.changes) {
      const change = object(rawChange), data = object(change?.value), metadata = object(data?.metadata);
      if (change?.field !== 'messages' || data?.messaging_product !== 'whatsapp'
        || metadata?.phone_number_id !== config.phoneNumberId || !Array.isArray(data?.statuses)) continue;
      for (const rawStatus of data.statuses) {
        const s = object(rawStatus);
        const id = text(s?.id), status = text(s?.status), timestampText = text(s?.timestamp);
        const timestamp = /^\d{1,10}$/.test(timestampText) ? Number(timestampText) : NaN;
        if (!MESSAGE_ID.test(id) || !['sent', 'delivered', 'read', 'failed'].includes(status)
          || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 4_102_444_800) continue;
        const callback = text(s?.biz_opaque_callback_data);
        const error = Array.isArray(s?.errors) ? object(s.errors[0]) : null;
        const code = typeof error?.code === 'number' && Number.isSafeInteger(error.code) ? `meta_${error.code}` : null;
        statuses.push({
          notification: UUID.test(callback) ? callback : null,
          messageId: id, status: status as ProviderStatus['status'], timestamp, reason: code,
        });
      }
    }
  }
  return statuses;
}

/** GET de vérification Meta ; POST authentifié sur les octets bruts par HMAC. */
export function makeWebhookHandler(env: Environment, rpc: Rpc) {
  return async (request: Request): Promise<Response> => {
    const config = configuredWebhook(env);
    if (!config) return jsonResponse(503, { error: 'webhook_not_configured' });
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('hub.mode') === 'subscribe'
        && constantTimeEqual(url.searchParams.get('hub.verify_token') ?? '', config.verifyToken)) {
        const challenge = url.searchParams.get('hub.challenge');
        if (challenge !== null && challenge.length <= 512) return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      return jsonResponse(403, { error: 'verification_failed' });
    }
    if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY) return jsonResponse(413, { error: 'payload_too_large' });
    let body: Uint8Array | null;
    try { body = await boundedBody(request); } catch { return jsonResponse(400, { error: 'invalid_body' }); }
    if (!body) return jsonResponse(413, { error: 'payload_too_large' });
    if (!await validMetaSignature(body, request.headers.get('x-hub-signature-256'), config.appSecret)) {
      return jsonResponse(403, { error: 'invalid_signature' });
    }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return jsonResponse(400, { error: 'invalid_json' }); }
    try {
      const statuses = extractStatuses(payload, config);
      for (const s of statuses) {
        await rpc('apply_wash_whatsapp_status', {
          p_company: config.company, p_phone_number_id: config.phoneNumberId,
          p_notification: s.notification, p_message_id: s.messageId, p_status: s.status,
          p_timestamp: s.timestamp, p_reason: s.reason,
        });
      }
      // Si une écriture échoue, renvoyer 5xx pour que Meta réessaie ; la base
      // déduplique les événements déjà traités dans le même lot.
      return jsonResponse(200, { ok: true });
    } catch {
      return jsonResponse(500, { error: 'status_recording_failed' });
    }
  };
}
