import { describe, expect, it, vi } from 'vitest';
import {
  buildMetaPayload, extractStatuses, makeDispatchHandler, makeWebhookHandler,
  sendToMeta, validMetaSignature, type DispatchConfig, type Rpc, type WebhookConfig,
} from '../../supabase/functions/_shared/whatsapp';

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notification = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const envVars: Record<string, string> = {
  WHATSAPP_COMPANY_ID: company,
  WHATSAPP_SEND_ENABLED: 'true',
  WHATSAPP_DISPATCH_SECRET: 'd'.repeat(40),
  META_PHONE_NUMBER_ID: '1234567890',
  META_WABA_ID: '999999999',
  META_ACCESS_TOKEN: 't'.repeat(40),
  META_TEMPLATE_NAME: 'wash_ready',
  META_TEMPLATE_LANGUAGE: 'fr',
  META_GRAPH_VERSION: 'v26.0',
  META_VERIFY_TOKEN: 'v'.repeat(40),
  META_APP_SECRET: 'a'.repeat(40),
};
const env = (name: string) => envVars[name];
const config: DispatchConfig = {
  company, phoneNumberId: envVars.META_PHONE_NUMBER_ID, accessToken: envVars.META_ACCESS_TOKEN,
  templateName: 'wash_ready', templateLanguage: 'fr', graphVersion: 'v26.0',
};
const webhook: WebhookConfig = {
  company, phoneNumberId: envVars.META_PHONE_NUMBER_ID, wabaId: envVars.META_WABA_ID,
  verifyToken: envVars.META_VERIFY_TOKEN, appSecret: envVars.META_APP_SECRET,
};
const item = { id: notification, phone: '+2250700000000', washNumber: 'L-0001', stationName: 'Station\n  Cocody' };
const request = (secret = envVars.WHATSAPP_DISPATCH_SECRET) => new Request('https://example.test/dispatch', {
  method: 'POST', headers: { authorization: `Bearer ${secret}` },
});

async function signature(body: string, secret = envVars.META_APP_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function hookPayload(statuses: unknown[], waba = envVars.META_WABA_ID, phone = envVars.META_PHONE_NUMBER_ID) {
  return { object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: phone }, statuses,
  } }] }] };
}
function hookRequest(body: string, sig: string): Request {
  return new Request('https://example.test/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body });
}

describe('WhatsApp Meta — configuration et émission serveur', () => {
  it('utilise un modèle fixe, deux paramètres et un identifiant de corrélation opaque', () => {
    expect(buildMetaPayload(config, item)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '2250700000000', type: 'template',
      biz_opaque_callback_data: notification,
      template: { name: 'wash_ready', language: { code: 'fr' }, components: [{ type: 'body', parameters: [
        { type: 'text', text: 'L-0001' }, { type: 'text', text: 'Station Cocody' },
      ] }] },
    });
  });
  it('sans activation explicite, secret, fournisseur OU webhook, aucun claim ni appel réseau', async () => {
    for (const missing of ['WHATSAPP_SEND_ENABLED', 'WHATSAPP_DISPATCH_SECRET', 'META_ACCESS_TOKEN', 'META_TEMPLATE_NAME',
      'META_TEMPLATE_LANGUAGE', 'META_GRAPH_VERSION', 'META_PHONE_NUMBER_ID', 'WHATSAPP_COMPANY_ID',
      'META_WABA_ID', 'META_VERIFY_TOKEN', 'META_APP_SECRET']) {
      const rpc = vi.fn<Rpc>(); const fetcher = vi.fn<typeof fetch>();
      const disabled = (name: string) => name === missing ? '' : env(name);
      const response = await makeDispatchHandler(disabled, rpc, fetcher)(request());
      expect(response.status, missing).toBe(503);
      expect(rpc, missing).not.toHaveBeenCalled(); expect(fetcher, missing).not.toHaveBeenCalled();
    }
  });
  it('refuse un secret invalide avant toute requête en base', async () => {
    const rpc = vi.fn<Rpc>(); const fetcher = vi.fn<typeof fetch>();
    const response = await makeDispatchHandler(env, rpc, fetcher)(request('mauvais'));
    expect(response.status).toBe(401); expect(rpc).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('envoie une seule fois et écrit accepted uniquement avec un WAMID', async () => {
    let claims = 0;
    const rpc = vi.fn<Rpc>(async (name) => name === 'claim_wash_whatsapp' ? (claims++ === 0 ? item : null) : null);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.test-123' }] }), { status: 200 }));
    const response = await makeDispatchHandler(env, rpc, fetcher)(request());
    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({ processed: 1 });
    expect(responseBody).not.toContain(envVars.META_ACCESS_TOKEN);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v26.0/1234567890/messages');
    expect(options?.headers).toEqual({ Authorization: `Bearer ${envVars.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(options?.body as string)).toEqual(buildMetaPayload(config, item));
    expect(rpc).toHaveBeenCalledWith('finish_wash_whatsapp', {
      p_company: company, p_notification: notification, p_result: 'accepted', p_message_id: 'wamid.test-123', p_reason: null,
    });
  });
  it('un refus explicite est un échec ; timeout, 5xx et réponse ambiguë restent incertains', async () => {
    const fake = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
    expect(await sendToMeta(config, item, fake(400, { error: { code: 132000, message: 'secret et numéro à ne pas stocker' } })))
      .toEqual({ result: 'failed', messageId: null, reason: 'http_400:meta_132000' });
    expect(await sendToMeta(config, item, fake(400, {}))).toEqual({ result: 'unknown', messageId: null, reason: 'http_400' });
    expect(await sendToMeta(config, item, fake(429, { error: { code: 130429 } })))
      .toEqual({ result: 'failed', messageId: null, reason: 'http_429:meta_130429' });
    expect(await sendToMeta(config, item, fake(408, {}))).toEqual({ result: 'unknown', messageId: null, reason: 'http_408' });
    expect(await sendToMeta(config, item, fake(503, {}))).toEqual({ result: 'unknown', messageId: null, reason: 'http_503' });
    expect(await sendToMeta(config, item, fake(200, {}))).toEqual({ result: 'unknown', messageId: null, reason: 'missing_message_id' });
    const throws = vi.fn<typeof fetch>(async () => { throw new Error('secret: connection failed'); });
    expect(await sendToMeta(config, item, throws)).toEqual({ result: 'unknown', messageId: null, reason: 'network_uncertain' });
    expect(throws).toHaveBeenCalledTimes(1);
  });
  it('une panne lors de l’écriture du résultat ne provoque aucun nouvel appel Meta', async () => {
    const rpc = vi.fn<Rpc>(async (name) => {
      if (name === 'claim_wash_whatsapp') return item;
      if (name === 'finish_wash_whatsapp') throw new Error('DB non disponible');
      return null;
    });
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] })));
    const response = await makeDispatchHandler(env, rpc, fetcher)(request());
    expect(response.status).toBe(500); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain(envVars.META_ACCESS_TOKEN);
  });
  it('borne chaque exécution à 20 demandes', async () => {
    const rpc = vi.fn<Rpc>(async (name) => name === 'claim_wash_whatsapp' ? item : null);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] })));
    const response = await makeDispatchHandler(env, rpc, fetcher)(request());
    expect(await response.json()).toEqual({ processed: 20 });
    expect(fetcher).toHaveBeenCalledTimes(20);
  });
});

describe('WhatsApp Meta — webhook signé et isolé', () => {
  it('vérifie le challenge mais ne divulgue pas le token', async () => {
    const rpc = vi.fn<Rpc>(); const handler = makeWebhookHandler(env, rpc);
    const url = `https://example.test/webhook?hub.mode=subscribe&hub.verify_token=${envVars.META_VERIFY_TOKEN}&hub.challenge=abc123`;
    const ok = await handler(new Request(url));
    expect(ok.status).toBe(200); expect(await ok.text()).toBe('abc123');
    expect((await handler(new Request(url.replace(envVars.META_VERIFY_TOKEN, 'wrong')))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('authentifie les octets bruts HMAC et refuse une modification ou une signature absente', async () => {
    const body = '{"v":"été"}'; const sig = await signature(body);
    expect(await validMetaSignature(new TextEncoder().encode(body), sig, envVars.META_APP_SECRET)).toBe(true);
    expect(await validMetaSignature(new TextEncoder().encode(body + ' '), sig, envVars.META_APP_SECRET)).toBe(false);
    expect(await validMetaSignature(new TextEncoder().encode(body), null, envVars.META_APP_SECRET)).toBe(false);
    const rpc = vi.fn<Rpc>(); const handler = makeWebhookHandler(env, rpc);
    expect((await handler(hookRequest(body + ' ', sig))).status).toBe(403);
    expect((await handler(hookRequest(body, 'sha256=00'))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('ne retient que les statuts du bon compte et du bon expéditeur', () => {
    const event = { id: 'wamid.msg', status: 'delivered', timestamp: '1700000000', biz_opaque_callback_data: notification };
    expect(extractStatuses(hookPayload([event]), webhook)).toEqual([{ notification, messageId: 'wamid.msg', status: 'delivered', timestamp: 1700000000, reason: null }]);
    expect(extractStatuses(hookPayload([event], '111111'), webhook)).toEqual([]);
    expect(extractStatuses(hookPayload([event], envVars.META_WABA_ID, '111111'), webhook)).toEqual([]);
    expect(extractStatuses(hookPayload([{ ...event, status: 'played' }]), webhook)).toEqual([]);
    expect(extractStatuses(hookPayload([{ ...event, id: 'invalid' }]), webhook)).toEqual([]);
    expect(extractStatuses(hookPayload([{ ...event, timestamp: '9999999999' }]), webhook)).toEqual([]);
  });
  it('applique livraison et erreur sans stocker numéro ni contenu de message entrant', async () => {
    const rpc = vi.fn<Rpc>(async () => true); const handler = makeWebhookHandler(env, rpc);
    const events = [
      { id: 'wamid.early', status: 'delivered', timestamp: '1700000001', biz_opaque_callback_data: notification, recipient_id: '2250700000000' },
      { id: 'wamid.failed', status: 'failed', timestamp: '1700000002', errors: [{ code: 131026, title: 'détails privés' }] },
    ];
    const body = JSON.stringify(hookPayload(events));
    const response = await handler(hookRequest(body, await signature(body)));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'apply_wash_whatsapp_status', {
      p_company: company, p_phone_number_id: '1234567890', p_notification: notification,
      p_message_id: 'wamid.early', p_status: 'delivered', p_timestamp: 1700000001, p_reason: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'apply_wash_whatsapp_status', {
      p_company: company, p_phone_number_id: '1234567890', p_notification: null,
      p_message_id: 'wamid.failed', p_status: 'failed', p_timestamp: 1700000002, p_reason: 'meta_131026',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('2250700000000');
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('détails privés');
  });
  it('retourne 5xx si le journal échoue pour permettre un rejeu Meta', async () => {
    const rpc = vi.fn<Rpc>(async () => { throw new Error('DB inaccessible'); });
    const body = JSON.stringify(hookPayload([{ id: 'wamid.a', status: 'sent', timestamp: '1700000000' }]));
    expect((await makeWebhookHandler(env, rpc)(hookRequest(body, await signature(body)))).status).toBe(500);
  });
  it('refuse une configuration absente et limite les corps trop gros', async () => {
    const rpc = vi.fn<Rpc>();
    expect((await makeWebhookHandler((name) => name === 'META_APP_SECRET' ? '' : env(name), rpc)(new Request('https://example.test/'))).status).toBe(503);
    const huge = 'x'.repeat(1_048_577);
    expect((await makeWebhookHandler(env, rpc)(hookRequest(huge, 'sha256=' + '0'.repeat(64)))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
});
