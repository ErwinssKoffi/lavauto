// Toutes les commandes de notification sont des RPC. Le client ne transmet
// ni secret fournisseur ni identifiant d'entreprise : le JWT fait autorité.
export interface WhatsappRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { message: string; code?: string } | null;
  }>;
}
export interface ConsentEvent {
  kind: 'granted' | 'revoked'; phone: string | null; source: string; at: string; actor: string;
}
export interface WhatsappConsent {
  granted: boolean; phone: string | null; at: string | null; history: ConsentEvent[];
}
export type WhatsappStatus = 'blocked' | 'pending' | 'sending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled' | 'unknown';
export interface WhatsappEvent {
  kind: WhatsappStatus; reason: string | null; at: string; providerAt: string | null;
}
export interface WhatsappJournalEntry {
  id: string; origin: 'automatic' | 'manual'; status: WhatsappStatus; reason: string | null;
  providerMessageId: string | null; createdAt: string; updatedAt: string; events: WhatsappEvent[];
}

const STATUSES: WhatsappStatus[] = ['blocked', 'pending', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'unknown'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Réponse WhatsApp serveur invalide.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullable(value: unknown): string | null { return text(value) || null; }
function resultId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Réponse WhatsApp serveur invalide : identifiant absent.');
  return value;
}
function status(value: unknown): WhatsappStatus {
  if (!STATUSES.includes(value as WhatsappStatus)) throw new Error('Statut WhatsApp serveur inconnu.');
  return value as WhatsappStatus;
}

export function parseWhatsappConsent(raw: unknown): WhatsappConsent {
  const r = record(raw);
  if (typeof r.granted !== 'boolean' || !Array.isArray(r.history)
    || (r.granted && (!nullable(r.phone) || !nullable(r.at)))) throw new Error('Consentement WhatsApp serveur invalide.');
  return {
    granted: r.granted, phone: nullable(r.phone), at: nullable(r.at),
    history: r.history.map((rawEvent) => {
      const e = record(rawEvent);
      if (e.kind !== 'granted' && e.kind !== 'revoked') throw new Error('Historique de consentement invalide.');
      return { kind: e.kind, phone: nullable(e.phone), source: text(e.source), at: text(e.at), actor: text(e.actor) };
    }),
  };
}
export function parseWhatsappJournal(raw: unknown): WhatsappJournalEntry[] {
  if (!Array.isArray(raw)) throw new Error('Journal WhatsApp serveur invalide.');
  return raw.map((rawEntry) => {
    const n = record(rawEntry);
    if (!text(n.id) || (n.origin !== 'automatic' && n.origin !== 'manual') || !Array.isArray(n.events)) {
      throw new Error('Notification WhatsApp serveur invalide.');
    }
    return {
      id: text(n.id), origin: n.origin, status: status(n.status), reason: nullable(n.reason),
      providerMessageId: nullable(n.providerMessageId), createdAt: text(n.createdAt), updatedAt: text(n.updatedAt),
      events: n.events.map((rawEvent) => {
        const e = record(rawEvent);
        return { kind: status(e.kind), reason: nullable(e.reason), at: text(e.at), providerAt: nullable(e.providerAt) };
      }),
    };
  });
}

export class SupabaseWhatsappCommands {
  constructor(private readonly client: WhatsappRpcClient) {}
  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) {
      if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) {
        throw new Error('Fonction WhatsApp indisponible : la migration et les fonctions serveur doivent être déployées.');
      }
      throw new Error(error.message || 'Commande WhatsApp impossible.');
    }
    return data;
  }
  async consent(customerId: string): Promise<WhatsappConsent> {
    return parseWhatsappConsent(await this.call('my_customer_whatsapp_consent', { p_customer_id: customerId }));
  }
  async saveConsent(customerId: string, granted: boolean, source: string, phone: string): Promise<void> {
    resultId(await this.call('save_customer_whatsapp_consent', {
      p_customer_id: customerId, p_granted: granted, p_source: source,
      // Le serveur compare ce numéro affiché avec la fiche verrouillée. Un
      // retrait, lui, reste possible même si le numéro a changé entre-temps.
      p_expected_phone: granted ? phone : null,
    }));
  }
  async journal(washId: string): Promise<WhatsappJournalEntry[]> {
    return parseWhatsappJournal(await this.call('my_wash_whatsapp_journal', { p_wash_id: washId }));
  }
  async enqueue(washId: string, idempotencyKey: string): Promise<string> {
    return resultId(await this.call('enqueue_wash_whatsapp', { p_wash_id: washId, p_idempotency_key: idempotencyKey }));
  }
}
