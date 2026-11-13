import { validateExpense, validateMoney, validatePeriod } from '../../lib/validation';
import { ExpenseCommandError } from '../../lib/expenseAttempt';
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
  const key = PAY_METHOD_DB_KEY[method];
  if (!key) throw new Error('Moyen de paiement invalide.');
  return key;
}

/** Sans clé de reprise, un échec réseau n'est jamais une preuve de rollback. */
export class FinanceCommandError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown') {
    super(message);
    this.name = 'FinanceCommandError';
  }
}

function uncertain(detail: string): FinanceCommandError {
  return new FinanceCommandError(`Résultat de la commande financière incertain : ${detail}. Vérifiez la station et l’historique avant de répéter.`, 'unknown');
}

export class SupabaseFinanceCommands implements FinanceCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    let result: SupabaseResult<unknown>;
    try { result = await this.client.rpc(name, args); }
    catch (error) { throw uncertain(error instanceof Error ? error.message : 'réponse réseau absente'); }
    if (result.error) {
      const status = result.status;
      const code = result.error.code;
      const rejected = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
        && Boolean(code && /^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0001|P0002|PGRST\d+)$/.test(code) && code !== '23505');
      if (rejected) throw new FinanceCommandError(result.error.message, 'rejected');
      throw uncertain(result.error.message);
    }
    return result.data;
  }

  async openCash(stationId: string, openingFloat: number, number = ''): Promise<string> {
    validateMoney(openingFloat);
    const data = await this.rpc('open_cash_session', {
      p_station_id: stationId,
      p_opening_float_minor: openingFloat,
      p_number: number,
    });
    if (typeof data !== 'string' || !data.trim()) throw uncertain('identifiant de caisse absent');
    return data;
  }

  async closeCash(sessionId: string, counted: number): Promise<void> {
    validateMoney(counted);
    await this.rpc('close_cash_session', {
      p_session_id: sessionId,
      p_counted_minor: counted,
    });
  }

  async reopenCash(sessionId: string, reason: string): Promise<void> {
    await this.rpc('reopen_cash_session', {
      p_session_id: sessionId,
      p_reason: reason,
    });
  }

  async addExpense(p: ExpenseCreatePayload): Promise<string> {
    validateExpense(p);
    let result: SupabaseResult<unknown>;
    try {
      result = await this.client.rpc('record_expense_by_key', {
        p_station_id: p.stationId,
        p_amount_minor: p.amount,
        p_category_name: p.category,
        p_reason: p.reason,
        p_supplier: p.supplier,
        p_spent_at: p.date,
        p_method_key: dbMethod(p.method),
        p_idempotency_key: p.idempotencyKey,
      });
    } catch (error) {
      throw new ExpenseCommandError(`Résultat de la dépense incertain : ${error instanceof Error ? error.message : 'réponse réseau absente'}`, 'unknown');
    }
    if (result.error) {
      // Seul un refus structuré et sans ambiguïté permet d'oublier une
      // première tentative. Une réponse de proxy, un conflit d'unicité ou un
      // code réseau ne prouvent pas que l'écriture précédente est absente.
      const status = result.status;
      const code = result.error.code;
      const rejected = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
        && Boolean(code && /^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|42501|P0001|P0002|PGRST\d+)$/.test(code) && code !== '23505');
      throw new ExpenseCommandError(`Dépense : ${result.error.message}`, rejected ? 'rejected' : 'unknown');
    }
    if (typeof result.data !== 'string' || !result.data.trim()) {
      throw new ExpenseCommandError('Résultat de la dépense incertain : identifiant serveur absent.', 'unknown');
    }
    return result.data;
  }

  async cancelExpense(id: string, reason: string): Promise<void> {
    await this.rpc('cancel_expense', { p_expense_id: id, p_reason: reason });
  }

  async cancelPayment(paymentId: string, reason: string): Promise<void> {
    await this.rpc('cancel_payment', { p_payment_id: paymentId, p_reason: reason });
  }

  async reconcileChannel(methodId: string, start: string, end: string, counted: number): Promise<void> {
    validatePeriod(start, end); validateMoney(counted);
    await this.rpc('reconcile_channel', {
      p_method_id: methodId,
      p_start: start,
      p_end: end,
      p_counted_minor: counted,
    });
  }

  async createCommissionPeriod(stationId: string, start: string, end: string): Promise<string> {
    validatePeriod(start, end);
    const data = await this.rpc('create_commission_period', {
      p_station_id: stationId, p_start: start, p_end: end,
    });
    if (typeof data !== 'string' || !data.trim()) throw uncertain('identifiant de période absent');
    return data;
  }

  async validateCommissionPeriod(periodId: string): Promise<void> {
    await this.rpc('validate_commission_period', { p_period_id: periodId });
  }

  async recordCommissionPayout(periodId: string, userId: string, amount: number, reference: string): Promise<void> {
    validateMoney(amount);
    await this.rpc('record_commission_payout', {
      p_period_id: periodId,
      p_user_id: userId,
      p_amount_minor: amount,
      p_reference: reference,
    });
  }
}
