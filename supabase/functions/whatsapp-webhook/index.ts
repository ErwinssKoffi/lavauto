import { makeWebhookHandler } from '../_shared/whatsapp.ts';
import { serviceRpc } from '../_shared/service-rpc.ts';

// Meta ne possède pas de JWT Supabase : vérification GET et HMAC SHA-256 POST.
Deno.serve(makeWebhookHandler((name) => Deno.env.get(name), serviceRpc));
