// Adaptateur REST réservé aux fonctions serveur. Aucun secret dans le navigateur,
// les réponses HTTP ni les journaux. Pas de dépendance CDN au déploiement.
import type { Rpc } from './whatsapp.ts';

export const serviceRpc: Rpc = async (name, args) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key || !/^[a-z_]+$/.test(name)) throw new Error('Service configuration missing');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error('Service RPC failed');
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};
