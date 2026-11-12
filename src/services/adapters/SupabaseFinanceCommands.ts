import type {
  ExpenseCreatePayload, FinanceCommands,
} from './DataAdapter';
import { PAY_METHOD_DB_KEY } from '../../types';
import type { PayMethod } from '../../types';
import type { SupabaseReader, SupabaseResult } from './SupabaseDataAdapter';

// Toutes les mutations finance passent par les RPC SECURITY DEFINER 024–029.
// Aucun INSERT/UPDATE/DELETE de table, aucun identifiant de tenant fourni par
// l'UI : le tenant et l'utilisateur sont déduits du JWT côté serveur.

function dbMethod(method: PayMethod): string {
  return PAY_METHOD_DB_KEY[method] ?? 'cash';
}

export class SupabaseFinanceCommands implements FinanceCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error }: SupabaseResult<unknown> = await this.client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }

  async openCash(stationId: string, openingFloat: number, number = ''): Promise<string> {
    const data = await this.rpc('open_cash_session', {
      p_station_id: stationId,
      p_opening_float_minor: Math.round(openingFloat),
      p_number: number,
    });
    return String(data);
  }

  async closeCash(sessionId: string, counted: number): Promise<void> {
    await this.rpc('close_cash_session', {
      p_session_id: sessionId,
      p_counted_minor: Math.round(counted),
    });
  }

  async reopenCash(sessionId: string, reason: string): Promise<void> {
    await this.rpc('reopen_cash_session', {
      p_session_id: sessionId,
      p_reason: reason,
    });
  }

  async addExpense(p: ExpenseCreatePayload): Promise<string> {
    const data = await this.rpc('record_expense_by_key', {
      p_station_id: p.stationId,
      p_amount_minor: Math.round(p.amount),
      p_category_name: p.category,
      p_reason: p.reason,
      p_supplier: p.supplier,
      p_spent_at: p.date,
      p_method_key: dbMethod(p.method),
      p_idempotency_key: p.idempotencyKey,
    });
    return String(data);
  }

  async cancelExpense(id: string, reason: string): Promise<void> {
    await this.rpc('cancel_expense', { p_expense_id: id, p_reason: reason });
  }

  async cancelPayment(paymentId: string, reason: string): Promise<void> {
    await this.rpc('cancel_payment', { p_payment_id: paymentId, p_reason: reason });
  }

  async reconcileChannel(methodId: string, start: string, end: string, counted: number): Promise<void> {
    await this.rpc('reconcile_channel', {
      p_method_id: methodId,
      p_start: start,
      p_end: end,
      p_counted_minor: Math.round(counted),
    });
  }

  async createCommissionPeriod(stationId: string, start: string, end: string): Promise<string> {
    const data = await this.rpc('create_commission_period', {
      p_station_id: stationId, p_start: start, p_end: end,
    });
    return String(data);
  }

  async validateCommissionPeriod(periodId: string): Promise<void> {
    await this.rpc('validate_commission_period', { p_period_id: periodId });
  }

  async recordCommissionPayout(periodId: string, userId: string, amount: number, reference: string): Promise<void> {
    await this.rpc('record_commission_payout', {
      p_period_id: periodId,
      p_user_id: userId,
      p_amount_minor: Math.round(amount),
      p_reference: reference,
    });
  }
}
