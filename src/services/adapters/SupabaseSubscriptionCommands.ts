import { mapSubscriptionAccess, type SubscriptionAccess, type SubscriptionRequest } from '../../lib/subscription';
import type { SubscriptionCommands } from './DataAdapter';
import type { SupabaseReader } from './SupabaseDataAdapter';

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Réponse ${label} invalide.`);
  return value;
}

export class SupabaseSubscriptionCommands implements SubscriptionCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async call(name: string, args?: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw new Error(`RPC ${name} : ${error.message}`);
    return data;
  }

  async read(companyId: string): Promise<SubscriptionAccess> {
    return mapSubscriptionAccess(await this.call('my_subscription_access'), companyId);
  }

  async request(planId: string): Promise<string> {
    return text(await this.call('request_subscription_plan', { p_plan: planId }), 'demande');
  }

  async listRequests(): Promise<SubscriptionRequest[]> {
    const data = await this.call('admin_subscription_requests');
    if (!Array.isArray(data)) throw new Error('Liste des demandes invalide.');
    return data.map((item): SubscriptionRequest => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Demande invalide.');
      const r = item as Record<string, unknown>;
      const requestedAt = text(r.requestedAt, 'date');
      if (!Number.isFinite(Date.parse(requestedAt))) throw new Error('Date de demande invalide.');
      return {
        id: text(r.id, 'identifiant'), companyId: text(r.companyId, 'entreprise'),
        companyName: text(r.companyName, 'nom entreprise'),
        fromPlanId: r.fromPlanId === null ? null : text(r.fromPlanId, 'formule actuelle'),
        toPlanId: text(r.toPlanId, 'formule demandée'), toPlanName: text(r.toPlanName, 'nom formule'),
        requestedAt,
      };
    });
  }

  async decide(requestId: string, approve: boolean): Promise<void> {
    await this.call('admin_decide_subscription_request', { p_request: requestId, p_approve: approve });
  }
}
