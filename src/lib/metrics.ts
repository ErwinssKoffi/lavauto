import type { AppState, PayMethod, Wash } from '../types';
import { PAY_METHOD_LABELS } from '../types';
import { finishedWashes } from './washLifecycle';
import { buildProfitability, type FinanceSnapshot } from './finance';

export type Period = 'jour' | 'semaine' | 'mois';

export function periodRange(period: Period, now = new Date()): { start: Date; end: Date; label: string } {
  const end = new Date(now);
  const start = new Date(now);
  if (period === 'jour') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'semaine') {
    const day = (start.getDay() + 6) % 7; // lundi = 0
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return {
    start,
    end,
    label: period === 'jour' ? "aujourd'hui" : period === 'semaine' ? 'cette semaine' : 'ce mois-ci',
  };
}

export function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function activeWashes(state: AppState): Wash[] {
  return state.washes.filter((w) => w.status !== 'cancelled');
}

/** Rapport P06 : plus aucun « résultat simplifié » présenté comme un bénéfice. */
export interface Report {
  washes: Wash[];
  revenue: number;
  collected: number;
  receivables: number;
  expenses: number;
  purchases: number;
  consumptions: number;
  commissions: number;
  fixedCosts: number;
  /** SOLDE PARTIEL : encaissé − dépenses constatées. Jamais un bénéfice net. */
  partialBalance: number;
  grossMargin: number | null;
  netResult: number | null;
  costsMissing: boolean;
  profitability: ReturnType<typeof buildProfitability>;
  topServices: { name: string; count: number; revenue: number }[];
  byEmployee: { id: string; name: string; count: number; revenue: number }[];
  byMethod: { method: PayMethod; amount: number; count: number }[];
  cashSessions: AppState['cashSessions'];
  bestClients: { name: string; count: number; revenue: number }[];
}

export function buildReport(state: AppState, period: Period): Report {
  const { start, end } = periodRange(period);
  const washes = activeWashes(state).filter((w) => inRange(w.createdAt, start, end));
  const profitability = buildProfitability(state, start, end);
  const cancelledIds = new Set(
    (state.paymentCancellations ?? []).map((c) => c.paymentId)
  );
  const payments = washes.flatMap((w) => w.payments ?? []).filter(
    (p) => inRange(p.at, start, end) && !cancelledIds.has(p.id) && !p.cancelledAt
  );

  const serviceMap = new Map<string, { name: string; count: number; revenue: number }>();
  washes.forEach((w) =>
    w.items.forEach((it) => {
      const cur = serviceMap.get(it.serviceId) ?? { name: it.serviceName, count: 0, revenue: 0 };
      cur.count += it.qty;
      cur.revenue += it.unitPrice * it.qty;
      serviceMap.set(it.serviceId, cur);
    })
  );
  const topServices = [...serviceMap.values()].sort((a, b) => b.count - a.count);

  const empMap = new Map<string, { id: string; name: string; count: number; revenue: number }>();
  washes.forEach((w) => {
    const name = state.users.find((u) => u.id === w.employeeId)?.name ?? 'Employé supprimé';
    const cur = empMap.get(w.employeeId) ?? { id: w.employeeId, name, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += w.total;
    empMap.set(w.employeeId, cur);
  });
  const byEmployee = [...empMap.values()].sort((a, b) => b.revenue - a.revenue);

  const methodMap = new Map<PayMethod, { method: PayMethod; amount: number; count: number }>();
  payments.forEach((p) => {
    const cur = methodMap.get(p.method) ?? { method: p.method, amount: 0, count: 0 };
    cur.amount += p.amount;
    cur.count += 1;
    methodMap.set(p.method, cur);
  });
  const byMethod = [...methodMap.values()].sort((a, b) => b.amount - a.amount);

  const clientMap = new Map<string, { name: string; count: number; revenue: number }>();
  washes.forEach((w) => {
    if (!w.clientId) return;
    const name = state.clients.find((c) => c.id === w.clientId)?.name ?? w.clientName ?? 'Client';
    const cur = clientMap.get(w.clientId) ?? { name, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += w.total;
    clientMap.set(w.clientId, cur);
  });
  const bestClients = [...clientMap.values()].sort((a, b) => b.revenue - a.revenue);

  return {
    washes,
    revenue: profitability.revenue,
    collected: profitability.collected,
    receivables: profitability.receivables,
    expenses: profitability.expenses,
    purchases: profitability.purchases,
    consumptions: profitability.consumptions,
    commissions: profitability.commissions,
    fixedCosts: profitability.fixedCosts,
    partialBalance: profitability.partialBalance,
    grossMargin: profitability.grossMargin,
    netResult: profitability.result,
    costsMissing: profitability.costsMissing,
    profitability,
    topServices,
    byEmployee,
    byMethod,
    bestClients,
    cashSessions: state.cashSessions.filter((s) => inRange(s.openedAt, start, end)),
  };
}

export interface CommissionLine {
  userId: string;
  name: string;
  washes: number;
  base: number;
  rate: number;
  override: boolean;
  amount: number;
}

/**
 * Aperçu BROUILLON des commissions. P06 répartit une fiche entre TOUS les
 * employés affectés ; le relevé figé serveur reste la source pour la paie.
 */
export function buildCommissions(state: AppState, period: Period): CommissionLine[] {
  const { start, end } = periodRange(period);
  const washes = finishedWashes(state.washes).filter(
    (w) => inRange(w.finishedAt ?? w.createdAt, start, end)
  );
  const byUser = new Map<string, { base: number; washes: number }>();
  washes.forEach((w) => {
    const ids = Array.isArray(w.assignedUserIds) && w.assignedUserIds.length
      ? [...new Set(w.assignedUserIds)]
      : [w.employeeId];
    const share = w.total / Math.max(ids.length, 1);
    ids.forEach((userId) => {
      const cur = byUser.get(userId) ?? { base: 0, washes: 0 };
      cur.base += share;
      cur.washes += 1;
      byUser.set(userId, cur);
    });
  });

  return [...byUser.entries()].map(([userId, totals]) => {
    const user = state.users.find((u) => u.id === userId);
    const override = user?.commissionRateOverride !== null && user?.commissionRateOverride !== undefined;
    const rate = override ? (user?.commissionRateOverride as number) : state.station?.commissionRate ?? 0;
    return {
      userId,
      name: user?.name ?? 'Employé supprimé',
      washes: totals.washes,
      base: Math.round(totals.base),
      rate,
      override,
      amount: Math.round((totals.base * rate) / 100),
    };
  }).sort((a, b) => b.amount - a.amount);
}

export const METHOD_LABEL = PAY_METHOD_LABELS;

/**
 * Solde théorique = fond + encaissements espèces − décaissements espèces.
 * Les mouvements `closing` ne sont pas des flux : ils ne sont pas recomptés.
 */
export function theoreticalCash(state: AppState, sessionId: string): number {
  const s = state.cashSessions.find((c) => c.id === sessionId);
  if (!s) return 0;
  const start = s.reopenedAt ?? s.openedAt;
  const base = s.reopenedAt ? (s.countedAmount ?? s.openingFloat) : s.openingFloat;
  const movements = (state.cashMovements ?? []).filter(
    (m) => m.cashSessionId === sessionId && m.createdAt >= start
  );
  const hasLedger = (state.cashMovements ?? []).some((m) => m.cashSessionId === sessionId);
  if (hasLedger) {
    return base + movements
      .filter((m) => ['payment_in', 'expense_out', 'adjustment'].includes(m.kind))
      .reduce((sum, m) => sum + m.amount, 0);
  }
  // Repli pour un ancien état local importé avant P06, sans mouvements.
  const cashPayments = state.washes
    .flatMap((w) => w.payments ?? [])
    .filter((p) => p.method === 'especes' && p.at >= start && (!s.closedAt || p.at <= s.closedAt))
    .reduce((sum, p) => sum + p.amount, 0);
  const cashExpenses = state.expenses
    .filter((e) => e.status === 'enregistree' && e.method === 'especes'
      && e.cashSessionId === s.id && e.createdAt >= start)
    .reduce((sum, e) => sum + e.amount, 0);
  return base + cashPayments - cashExpenses;
}

/** Exposé pour les tests : le snapshot local respecte le contrat P06. */
export type { FinanceSnapshot };
