import type { AppState, Wash, PayMethod } from '../types';
import { PAY_METHOD_LABELS } from '../types';

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
  const currentStationId = state.station?.id;
  return state.washes.filter(
    (w) => w.status !== 'annule' && (!currentStationId || w.stationId === currentStationId)
  );
}

export interface Report {
  washes: Wash[];
  revenue: number;
  collected: number;
  expenses: number;
  result: number;
  topServices: { name: string; count: number; revenue: number }[];
  byEmployee: { id: string; name: string; count: number; revenue: number }[];
  byMethod: { method: PayMethod; amount: number; count: number }[];
  cashSessions: AppState['cashSessions'];
  bestClients: { name: string; count: number; revenue: number }[];
}

export function buildReport(state: AppState, period: Period): Report {
  const currentStationId = state.station?.id;
  const { start, end } = periodRange(period);
  const washes = activeWashes(state).filter((w) => inRange(w.createdAt, start, end));
  const revenue = washes.reduce((s, w) => s + w.total, 0);

  const payments = washes.flatMap((w) => w.payments).filter((p) => inRange(p.at, start, end));
  const collected = payments.reduce((s, p) => s + p.amount, 0);
  const exps = state.expenses.filter(
    (e) =>
      e.status === 'enregistree' &&
      (!currentStationId || e.stationId === currentStationId) &&
      inRange(e.date + 'T00:00:00', start, end)
  );
  const expenses = exps.reduce((s, e) => s + e.amount, 0);

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
    revenue,
    collected,
    expenses,
    result: collected - expenses,
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

/** Lavages TERMINÉS de la période, barème de la station ou exception du compte. */
export function buildCommissions(state: AppState, period: Period): CommissionLine[] {
  const { start, end } = periodRange(period);
  const washes = state.washes.filter(
    (w) => w.status === 'termine' && inRange(w.finishedAt ?? w.createdAt, start, end)
  );
  const byUser = new Map<string, number>();
  washes.forEach((w) => byUser.set(w.employeeId, (byUser.get(w.employeeId) ?? 0) + w.total));

  return [...byUser.entries()].map(([userId, base]) => {
    const user = state.users.find((u) => u.id === userId);
    const override = user?.commissionRateOverride !== null && user?.commissionRateOverride !== undefined;
    const rate = override ? (user?.commissionRateOverride as number) : state.station?.commissionRate ?? 0;
    return {
      userId,
      name: user?.name ?? 'Employé supprimé',
      washes: washes.filter((w) => w.employeeId === userId).length,
      base,
      rate,
      override,
      amount: Math.round((base * rate) / 100),
    };
  }).sort((a, b) => b.amount - a.amount);
}

export const METHOD_LABEL = PAY_METHOD_LABELS;

export function theoreticalCash(state: AppState, sessionId: string): number {
  const s = state.cashSessions.find((c) => c.id === sessionId);
  if (!s) return 0;
  const cashPayments = state.washes
    .flatMap((w) => w.payments)
    .filter((p) => p.method === 'especes' && p.at >= s.openedAt && (!s.closedAt || p.at <= s.closedAt))
    .reduce((sum, p) => sum + p.amount, 0);
  const cashExpenses = state.expenses
    .filter((e) => e.status === 'enregistree' && e.method === 'especes' && e.cashSessionId === s.id)
    .reduce((sum, e) => sum + e.amount, 0);
  return s.openingFloat + cashPayments - cashExpenses;
}

export function previous7DaysMetrics(state: AppState, now = new Date()): {
  totalRevenue: number;
  dailyAverage: number;
  washesCount: number;
} {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOf7DaysAgo = new Date(startOfToday);
  startOf7DaysAgo.setDate(startOf7DaysAgo.getDate() - 7);

  const pastWashes = activeWashes(state).filter((w) => {
    const t = new Date(w.createdAt).getTime();
    return t >= startOf7DaysAgo.getTime() && t < startOfToday.getTime();
  });

  const totalRevenue = pastWashes.reduce((sum, w) => sum + w.total, 0);
  const dailyAverage = Math.round(totalRevenue / 7);

  return {
    totalRevenue,
    dailyAverage,
    washesCount: pastWashes.length,
  };
}
