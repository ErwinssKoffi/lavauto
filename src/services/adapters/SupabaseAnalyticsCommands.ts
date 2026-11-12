import type { SupabaseReader, SupabaseResult } from './SupabaseDataAdapter';
import type {
  AnalyticsCommands, CompanySubscriptionPayload, CompanySuspensionPayload,
  PlanLimitPayload, PlanPayload,
} from './DataAdapter';

// ─── Prompt 09 : 5 commandes du back-office via RPC SECURITY DEFINER ──────────
// Aucune écriture directe de table. L'identifiant d'entreprise est un choix
// explicite du super admin dans le board, jamais un tenant forgé par un écran
// métier. Le serveur vérifie `is_platform_admin()` et la permission associée.

function rpcData(result: SupabaseResult<unknown>, name: string): unknown {
  if (result.error) throw new Error(`RPC ${name} : ${result.error.message}`);
  return result.data;
}

export class SupabaseAnalyticsCommands implements AnalyticsCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return rpcData(await this.client.rpc(name, args), name);
  }

  async refreshSubscriptionUsage(periodStart: string): Promise<void> {
    await this.call('refresh_subscription_usage', { p_period_start: periodStart });
  }

  async savePlan(p: PlanPayload): Promise<string> {
    const data = await this.call('admin_save_plan', {
      p_plan: p.planId,
      p_name: p.name,
      p_price_minor: Math.round(p.priceMinor),
      p_trial_days: Math.round(p.trialDays),
      p_active: p.active,
      p_sort_order: Math.round(p.sortOrder),
      p_features: p.features,
    });
    return typeof data === 'string' ? data : p.planId;
  }

  async setPlanLimit(p: PlanLimitPayload): Promise<void> {
    await this.call('admin_set_plan_limit', {
      p_plan: p.planId, p_key: p.key, p_value_int: Math.round(p.valueInt),
    });
  }

  async setCompanySubscription(p: CompanySubscriptionPayload): Promise<void> {
    await this.call('admin_set_company_subscription', {
      p_company: p.companyId, p_plan: p.planId, p_status: p.status,
    });
  }

  async setCompanySuspended(p: CompanySuspensionPayload): Promise<void> {
    await this.call('admin_set_company_suspended', {
      p_company: p.companyId, p_suspended: p.suspended,
    });
  }
}
