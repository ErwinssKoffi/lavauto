// ─── Prompt 09 : analytics, quotas et back-office plateforme ──────────────────
// Projections pures : aucune donnée n'est fabriquée. En mode serveur, les
// boards viennent des RPC SECURITY DEFINER ; en mode local, les mêmes
// définitions métier sont calculées sur l'état réellement enregistré.
// Les réponses n'exposent jamais d'identifiant brut de tenant aux écrans.
import type { AppState, Plan, ProfitabilityReport } from '../types';
import {
  buildProfitability, mapProfitability, redactStockProfitability,
} from './finance';
import { withStockDefaults } from './stock';
import { getPlans, planById } from './plans';

type Row = Record<string, unknown>;

export interface AnalyticsStation {
  rank: number;
  stationId: string;
  name: string;
  city: string;
  revenue: number;
  collected: number;
  receivables: number;
  expenses: number;
  consumptions: number | null;
  partialBalance: number;
  washCount: number;
  /** Aucun résultat net par station sans attestation de période certifiée. */
  grossMargin: number | null;
  result: number | null;
  certified: boolean;
}

export interface AnalyticsRanking {
  rank: number;
  stationId: string;
  name: string;
  revenue: number;
  washCount: number;
  collected: number;
}

export interface AnalyticsTrendPoint {
  date: string;
  revenue: number;
  collected: number;
  expenses: number;
  washCount: number;
}

export interface AnalyticsStats {
  stations: number;
  revenue: number;
  collected: number;
  receivables: number;
  partialBalance: number;
  washCount: number;
  certified: boolean;
  compareDelta: number | null;
}

export interface AnalyticsRules {
  netResult: string;
  comparison: string;
  stations: string;
  pricing: string;
}

export interface AnalyticsSnapshot {
  periodStart: string;
  periodEnd: string;
  compareStart: string | null;
  compareEnd: string | null;
  period: ProfitabilityReport;
  compare: ProfitabilityReport | null;
  compareDelta: number | null;
  stations: AnalyticsStation[];
  rankings: AnalyticsRanking[];
  trend: AnalyticsTrendPoint[];
  definitions: Record<string, string>;
  stats: AnalyticsStats;
  rules: AnalyticsRules;
}

/** Occultation non destructive lorsque la consolidation est incluse sans stock. */
export function redactStockAnalytics(board: AnalyticsSnapshot): AnalyticsSnapshot {
  return {
    ...board,
    period: redactStockProfitability(board.period),
    compare: board.compare ? redactStockProfitability(board.compare) : null,
    stations: board.stations.map((station) => ({
      ...station, consumptions: null, grossMargin: null, result: null, certified: false,
    })),
    stats: { ...board.stats, certified: false },
  };
}

export interface SubscriptionUsageSnapshot {
  periodStart: string;
  usage: { stations: number; employees: number; washes: number };
  limits: { stations: number | null; employees: number | null; washesPerMonth: number | null };
  rows: {
    companyId: string;
    stationId: string;
    periodStart: string;
    metricKey: string;
    valueInt: number;
    updatedAt: string;
  }[];
  rules: { quota: string };
}

export interface PlatformCompanyView {
  companyId: string;
  name: string;
  city: string;
  phone: string;
  suspended: boolean;
  status: string;
  planId: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  subscriptionStartedAt: string | null;
  /** Motif de lecture seule calculé par le serveur, y compris l’échéance. */
  subscriptionReason: string | null;
  stationCount: number;
  employeeCount: number;
  washesMonth: number;
  monthlyRevenue: number;
  companyCreatedAt: string;
  limits: { stations: number | null; employees: number | null; washesPerMonth: number | null };
  quota: {
    stationsUsed: number;
    employeesUsed: number;
    washesMonthUsed: number;
    quotaExceeded: boolean;
  };
}

export interface PlatformPlanLimitRow {
  planId: string;
  key: string;
  valueInt: number;
}

export interface PlatformUsageRow {
  companyId: string;
  stationId: string;
  periodStart: string;
  metricKey: string;
  valueInt: number;
  updatedAt: string;
}

export interface PlatformAuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detail: Row;
  createdAt: string;
}

export interface PlatformStats {
  companies: number;
  suspendedCompanies: number;
  plans: number;
  planLimits: number;
  usageRows: number;
  auditLogs: number;
  quotasExceeded: number;
}

export interface PlatformSnapshot {
  companies: PlatformCompanyView[];
  plans: Plan[];
  planLimits: PlatformPlanLimitRow[];
  subscriptionUsage: PlatformUsageRow[];
  auditLogs: PlatformAuditEntry[];
  stats: PlatformStats;
  rules: {
    pricing: string;
    suspension: string;
    quotas: string;
    audit: string;
  };
}

export const ANALYTICS_RULES: AnalyticsRules = {
  netResult: 'Aucun résultat net sans attestation de période certifiée',
  comparison: 'Comparaison avec les mêmes définitions métier',
  stations: 'Classement par chiffre d’affaires, jamais par bénéfice net',
  pricing: 'Tarifs 0 / 15 000 / 35 000 FCFA : hypothèses commerciales administrables',
};

export const PLATFORM_RULES = {
  pricing: 'Les tarifs 0 / 15 000 / 35 000 FCFA sont des hypothèses commerciales',
  suspension: 'La suspension coupe l’accès sans supprimer les données',
  quotas: 'Les limites sont vérifiées côté serveur avant insertion',
  audit: 'Toute opération du back-office est journalisée hors tenant',
};

const DEFINITIONS: Record<string, string> = {
  revenue: 'Chiffre d’affaires : total des fiches non annulées de la période',
  collected: 'Encaissements nets : paiements moins annulations',
  receivables: 'Créances : total moins encaissé des fiches non annulées',
  consumptions: 'Coût des produits consommés, valorisé au coût moyen de réception',
  partialBalance: 'Solde partiel : encaissé moins dépenses constatées ; PAS un bénéfice net',
};

function asRecord(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Réponse ${label} invalide.`);
  }
  return value as Row;
}

function rowArray(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asRecord(entry, label));
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function definitions(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...DEFINITIONS };
  const out: Record<string, string> = { ...DEFINITIONS };
  Object.entries(value as Row).forEach(([key, val]) => {
    if (typeof val === 'string') out[key] = val;
  });
  return out;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Premier jour du mois courant pour les rapports à la date locale. */
export function monthStartISO(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Les quotas sont calculés sur le mois calendaire UTC côté serveur. */
export function quotaMonthStartISO(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Période précédente de MÊME longueur, pour comparer des définitions égales. */
export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(from.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86_400_000);
  return { start: isoDay(previousStart), end: isoDay(previousEnd) };
}

export function emptyProfitability(start: string, end: string): ProfitabilityReport {
  return {
    periodStart: start, periodEnd: end,
    revenue: 0, collected: 0, receivables: 0, expenses: 0,
    purchases: 0, consumptions: 0, commissions: 0, fixedCosts: 0,
    operatingExpenses: 0, partialBalance: 0,
    grossMargin: null, result: null,
    costsMissing: true, certified: false,
    label: 'Coûts manquants : résultat net non calculable',
    missing: ['Attestation des coûts de la période'],
    definitions: { ...DEFINITIONS },
    certifiedAt: null, attestation: null,
  };
}

export function emptyAnalyticsBoard(
  start = monthStartISO(), end = isoDay(new Date()),
  compareStart: string | null = null, compareEnd: string | null = null,
): AnalyticsSnapshot {
  return {
    periodStart: start, periodEnd: end, compareStart, compareEnd,
    period: emptyProfitability(start, end),
    compare: compareStart && compareEnd ? emptyProfitability(compareStart, compareEnd) : null,
    compareDelta: null,
    stations: [], rankings: [], trend: [],
    definitions: { ...DEFINITIONS },
    stats: {
      stations: 0, revenue: 0, collected: 0, receivables: 0,
      partialBalance: 0, washCount: 0, certified: false, compareDelta: null,
    },
    rules: { ...ANALYTICS_RULES },
  };
}

function dayList(start: string, end: string): string[] {
  const out: string[] = [];
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  for (let day = from; day <= to && out.length <= 92; day = new Date(day.getTime() + 86_400_000)) {
    out.push(isoDay(day));
  }
  return out;
}

function localDate(value: string): string {
  return value.slice(0, 10);
}

/** Board local : mêmes définitions que `my_analytics_board()`, zéro fixture. */
export function analyticsBoardFromState(
  state: AppState, start: string, end: string,
  compareStart: string | null, compareEnd: string | null,
): AnalyticsSnapshot {
  const source = withStockDefaults(state);
  const period = buildProfitability(source, new Date(`${start}T00:00:00`), new Date(`${end}T23:59:59`));
  const compare = compareStart && compareEnd
    ? buildProfitability(source, new Date(`${compareStart}T00:00:00`), new Date(`${compareEnd}T23:59:59`))
    : null;
  const station = source.station;
  const inPeriod = (value: string): boolean => localDate(value) >= start && localDate(value) <= end;
  const washes = source.washes.filter((w) => w.status !== 'cancelled' && inPeriod(w.createdAt));
  const payments = source.washes.flatMap((w) => w.payments ?? [])
    .filter((p) => inPeriod(p.at));
  const cancellations = (source.paymentCancellations ?? []).filter((c) => inPeriod(c.at));
  const expenses = (source.expenses ?? [])
    .filter((e) => e.status === 'enregistree' && localDate(e.date) >= start && localDate(e.date) <= end);
  const consumptions = (source.stockMovements ?? [])
    .filter((m) => m.kind === 'consumption' && inPeriod(m.createdAt))
    .reduce((sum, m) => sum + Math.max(0, -m.qtyDelta) * m.unitCostMinor, 0);
  const collected = payments.reduce((sum, p) => sum + p.amount, 0)
    - cancellations.reduce((sum, c) => sum + c.amount, 0);
  const receivables = washes.reduce((sum, w) => sum + Math.max(w.total - w.paid, 0), 0);
  const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const stationRow: AnalyticsStation | null = station ? {
    rank: 1,
    stationId: station.id,
    name: station.name,
    city: station.city,
    revenue: washes.reduce((sum, w) => sum + w.total, 0),
    collected,
    receivables,
    expenses: expenseTotal,
    consumptions,
    partialBalance: collected - expenseTotal,
    washCount: washes.length,
    grossMargin: null,
    result: null,
    certified: false,
  } : null;
  const stations = stationRow ? [stationRow] : [];
  const rankings: AnalyticsRanking[] = stations
    .slice()
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))
    .map((s) => ({
      rank: s.rank, stationId: s.stationId, name: s.name,
      revenue: s.revenue, washCount: s.washCount, collected: s.collected,
    }));
  const trend: AnalyticsTrendPoint[] = dayList(start, end).map((day) => {
    const dayWashes = source.washes.filter((w) => w.status !== 'cancelled' && localDate(w.createdAt) === day);
    const dayPayments = source.washes.flatMap((w) => w.payments ?? [])
      .filter((p) => localDate(p.at) === day);
    const dayCancellations = (source.paymentCancellations ?? []).filter((c) => localDate(c.at) === day);
    const dayExpenses = (source.expenses ?? [])
      .filter((e) => e.status === 'enregistree' && localDate(e.date) === day);
    return {
      date: day,
      revenue: dayWashes.reduce((sum, w) => sum + w.total, 0),
      collected: dayPayments.reduce((sum, p) => sum + p.amount, 0)
        - dayCancellations.reduce((sum, c) => sum + c.amount, 0),
      expenses: dayExpenses.reduce((sum, e) => sum + e.amount, 0),
      washCount: dayWashes.length,
    };
  });
  return {
    periodStart: start, periodEnd: end, compareStart, compareEnd,
    period, compare,
    compareDelta: compare ? period.revenue - compare.revenue : null,
    stations, rankings, trend,
    definitions: { ...DEFINITIONS, ...period.definitions },
    stats: {
      stations: stations.length,
      revenue: period.revenue,
      collected: period.collected,
      receivables: period.receivables,
      partialBalance: period.partialBalance,
      washCount: trend.reduce((sum, p) => sum + p.washCount, 0),
      certified: period.certified === true,
      compareDelta: compare ? period.revenue - compare.revenue : null,
    },
    rules: { ...ANALYTICS_RULES },
  };
}

function stationFromRow(row: Row): AnalyticsStation {
  return {
    rank: num(row.rank), stationId: str(row.stationId), name: str(row.name), city: str(row.city),
    revenue: num(row.revenue), collected: num(row.collected), receivables: num(row.receivables),
    expenses: num(row.expenses), consumptions: nullableNum(row.consumptions),
    partialBalance: num(row.partialBalance), washCount: num(row.washCount),
    grossMargin: nullableNum(row.grossMargin), result: nullableNum(row.result),
    certified: bool(row.certified),
  };
}

function rankingFromRow(row: Row): AnalyticsRanking {
  return {
    rank: num(row.rank), stationId: str(row.stationId), name: str(row.name),
    revenue: num(row.revenue), washCount: num(row.washCount), collected: num(row.collected),
  };
}

function trendFromRow(row: Row): AnalyticsTrendPoint {
  return {
    date: str(row.date), revenue: num(row.revenue), collected: num(row.collected),
    expenses: num(row.expenses), washCount: num(row.washCount),
  };
}

/** `my_analytics_board()` → projection typée, NULL préservé, aucun tenant brut. */
export function mapAnalyticsBoard(value: unknown): AnalyticsSnapshot {
  const r = asRecord(value, 'my_analytics_board');
  const stats = asRecord(r.stats, 'my_analytics_board.stats');
  const rules = asRecord(r.rules, 'my_analytics_board.rules');
  return {
    periodStart: str(r.periodStart), periodEnd: str(r.periodEnd),
    compareStart: nullableStr(r.compareStart), compareEnd: nullableStr(r.compareEnd),
    period: mapProfitability(r.period),
    compare: r.compare === null || r.compare === undefined ? null : mapProfitability(r.compare),
    compareDelta: nullableNum(r.compareDelta),
    stations: rowArray(r.stations, 'stations').map(stationFromRow),
    rankings: rowArray(r.rankings, 'rankings').map(rankingFromRow),
    trend: rowArray(r.trend, 'trend').map(trendFromRow),
    definitions: definitions(r.definitions),
    stats: {
      stations: num(stats.stations), revenue: num(stats.revenue),
      collected: num(stats.collected), receivables: num(stats.receivables),
      partialBalance: num(stats.partialBalance), washCount: num(stats.washCount),
      certified: bool(stats.certified), compareDelta: nullableNum(stats.compareDelta),
    },
    rules: {
      netResult: str(rules.netResult) || ANALYTICS_RULES.netResult,
      comparison: str(rules.comparison) || ANALYTICS_RULES.comparison,
      stations: str(rules.stations) || ANALYTICS_RULES.stations,
      pricing: str(rules.pricing) || ANALYTICS_RULES.pricing,
    },
  };
}

export function emptySubscriptionUsage(periodStart = quotaMonthStartISO()): SubscriptionUsageSnapshot {
  return {
    periodStart,
    usage: { stations: 0, employees: 0, washes: 0 },
    limits: { stations: null, employees: null, washesPerMonth: null },
    rows: [],
    rules: { quota: 'Limite lue côté serveur, jamais envoyée par le navigateur' },
  };
}

export function subscriptionUsageFromState(state: AppState, periodStart = quotaMonthStartISO()): SubscriptionUsageSnapshot {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const washes = state.washes.filter((w) => w.status !== 'cancelled'
    && Date.parse(w.createdAt) >= start.getTime() && Date.parse(w.createdAt) < end.getTime());
  const plan = planById(state.subscription?.planId);
  return {
    periodStart,
    usage: {
      stations: state.station ? 1 : 0,
      employees: state.users.filter((u) => u.active).length,
      washes: washes.length,
    },
    limits: plan ? {
      stations: plan.limits.stations,
      employees: plan.limits.employees,
      washesPerMonth: plan.limits.washesPerMonth,
    } : { stations: null, employees: null, washesPerMonth: null },
    rows: state.station ? [
      { companyId: state.company?.id ?? '', stationId: state.station.id, periodStart, metricKey: 'stations', valueInt: 1, updatedAt: new Date().toISOString() },
      { companyId: state.company?.id ?? '', stationId: state.station.id, periodStart, metricKey: 'employees', valueInt: state.users.filter((u) => u.active).length, updatedAt: new Date().toISOString() },
      { companyId: state.company?.id ?? '', stationId: state.station.id, periodStart, metricKey: 'washes', valueInt: washes.length, updatedAt: new Date().toISOString() },
    ] : [],
    rules: { quota: 'Limite lue côté serveur, jamais envoyée par le navigateur' },
  };
}

export function mapSubscriptionUsage(value: unknown): SubscriptionUsageSnapshot {
  const r = asRecord(value, 'my_subscription_usage');
  const usage = asRecord(r.usage, 'my_subscription_usage.usage');
  const limits = asRecord(r.limits, 'my_subscription_usage.limits');
  const rules = asRecord(r.rules, 'my_subscription_usage.rules');
  return {
    periodStart: str(r.periodStart),
    usage: {
      stations: num(usage.stations), employees: num(usage.employees), washes: num(usage.washes),
    },
    limits: {
      stations: nullableNum(limits.stations), employees: nullableNum(limits.employees),
      washesPerMonth: nullableNum(limits.washesPerMonth),
    },
    rows: rowArray(r.rows, 'subscription_usage').map((row) => ({
      companyId: str(row.companyId), stationId: str(row.stationId),
      periodStart: str(row.periodStart), metricKey: str(row.metricKey),
      valueInt: num(row.valueInt), updatedAt: str(row.updatedAt),
    })),
    rules: { quota: str(rules.quota) || 'Limite lue côté serveur' },
  };
}

function planLimitsFromPlans(plans: Plan[]): PlatformPlanLimitRow[] {
  return plans.flatMap((p) => [
    { planId: p.id, key: 'stations', valueInt: p.limits.stations },
    { planId: p.id, key: 'employees', valueInt: p.limits.employees },
    { planId: p.id, key: 'washes_per_month', valueInt: p.limits.washesPerMonth },
  ]);
}

export function emptyPlatformBoard(plans: Plan[] = getPlans()): PlatformSnapshot {
  return {
    companies: [], plans: plans.map((p) => ({ ...p, limits: { ...p.limits }, features: [...p.features] })),
    planLimits: planLimitsFromPlans(plans), subscriptionUsage: [], auditLogs: [],
    stats: {
      companies: 0, suspendedCompanies: 0, plans: plans.length,
      planLimits: plans.length * 3, usageRows: 0, auditLogs: 0, quotasExceeded: 0,
    },
    rules: { ...PLATFORM_RULES },
  };
}

export function platformBoardFromState(state: AppState, plans: Plan[] = getPlans()): PlatformSnapshot {
  const now = new Date().toISOString();
  const companies: PlatformCompanyView[] = state.platformCompanies.map((c) => {
    const plan = plans.find((p) => p.id === c.planName) ?? plans.find((p) => p.name === c.planName);
    const limits = plan ? {
      stations: plan.limits.stations, employees: plan.limits.employees,
      washesPerMonth: plan.limits.washesPerMonth,
    } : { stations: null, employees: null, washesPerMonth: null };
    const quotaExceeded = (limits.stations !== null && c.stations > limits.stations)
      || (limits.employees !== null && (c.employeeCount ?? 0) > limits.employees)
      || (limits.washesPerMonth !== null && (c.washesMonth ?? 0) > limits.washesPerMonth);
    return {
      companyId: c.id, name: c.name, city: c.city, phone: c.phone,
      suspended: c.status === 'suspendue',
      status: c.status,
      planId: plan?.id ?? c.planId ?? null,
      planName: c.planName,
      subscriptionStatus: c.status,
      subscriptionStartedAt: c.createdAt,
      subscriptionReason: null,
      stationCount: c.stations,
      employeeCount: c.employeeCount ?? 0,
      washesMonth: c.washesMonth ?? 0,
      monthlyRevenue: c.monthlyRevenue,
      companyCreatedAt: c.createdAt,
      limits,
      quota: {
        stationsUsed: c.stations, employeesUsed: c.employeeCount ?? 0,
        washesMonthUsed: c.washesMonth ?? 0, quotaExceeded,
      },
    };
  });
  const usage = subscriptionUsageFromState(state);
  return {
    companies,
    plans: plans.map((p) => ({ ...p, limits: { ...p.limits }, features: [...p.features] })),
    planLimits: planLimitsFromPlans(plans),
    subscriptionUsage: usage.rows.map((row) => ({ ...row })),
    auditLogs: state.auditLogs.map((log) => ({
      id: log.id, actorUserId: null, action: log.action,
      entityType: 'companies', entityId: '', detail: { actor: log.actor, detail: log.detail },
      createdAt: log.at,
    })),
    stats: {
      companies: companies.length,
      suspendedCompanies: companies.filter((c) => c.suspended).length,
      plans: plans.length,
      planLimits: plans.length * 3,
      usageRows: usage.rows.length,
      auditLogs: state.auditLogs.length,
      quotasExceeded: companies.filter((c) => c.quota.quotaExceeded).length,
    },
    rules: { ...PLATFORM_RULES },
  };
}

function planFromRow(row: Row): Plan {
  const limits = asRecord(row.limits, 'plans.limits');
  const rawFeatures = Array.isArray(row.features) ? row.features : [];
  return {
    id: str(row.id), name: str(row.name),
    priceMonthly: num(row.priceMonthlyMinor ?? row.priceMonthly),
    trial: row.trial === true || num(row.trialDays) > 0,
    limits: {
      stations: num(limits.stations), employees: num(limits.employees),
      washesPerMonth: num(limits.washesPerMonth),
    },
    features: rawFeatures.filter((f): f is string => typeof f === 'string'),
  };
}

function companyFromRow(row: Row): PlatformCompanyView {
  const limits = asRecord(row.limits, 'companies.limits');
  const quota = asRecord(row.quota, 'companies.quota');
  return {
    companyId: str(row.companyId), name: str(row.name), city: str(row.city), phone: str(row.phone),
    suspended: bool(row.suspended), status: str(row.status),
    planId: nullableStr(row.planId), planName: nullableStr(row.planName),
    subscriptionStatus: nullableStr(row.subscriptionStatus),
    subscriptionStartedAt: nullableStr(row.subscriptionStartedAt),
    subscriptionReason: nullableStr(row.subscriptionReason),
    stationCount: num(row.stationCount), employeeCount: num(row.employeeCount),
    washesMonth: num(row.washesMonth), monthlyRevenue: num(row.monthlyRevenue),
    companyCreatedAt: str(row.companyCreatedAt),
    limits: {
      stations: nullableNum(limits.stations), employees: nullableNum(limits.employees),
      washesPerMonth: nullableNum(limits.washesPerMonth),
    },
    quota: {
      stationsUsed: num(quota.stationsUsed), employeesUsed: num(quota.employeesUsed),
      washesMonthUsed: num(quota.washesMonthUsed), quotaExceeded: bool(quota.quotaExceeded),
    },
  };
}

export function mapPlatformBoard(value: unknown): PlatformSnapshot {
  const r = asRecord(value, 'my_platform_board');
  const stats = asRecord(r.stats, 'my_platform_board.stats');
  const rules = asRecord(r.rules, 'my_platform_board.rules');
  return {
    companies: rowArray(r.companies, 'companies').map(companyFromRow),
    plans: rowArray(r.plans, 'plans').map(planFromRow),
    planLimits: rowArray(r.planLimits, 'plan_limits').map((row) => ({
      planId: str(row.planId), key: str(row.key), valueInt: num(row.valueInt),
    })),
    subscriptionUsage: rowArray(r.subscriptionUsage, 'subscription_usage').map((row) => ({
      companyId: str(row.companyId), stationId: str(row.stationId),
      periodStart: str(row.periodStart), metricKey: str(row.metricKey),
      valueInt: num(row.valueInt), updatedAt: str(row.updatedAt),
    })),
    auditLogs: rowArray(r.auditLogs, 'audit_logs').map((row) => ({
      id: str(row.id), actorUserId: nullableStr(row.actorUserId), action: str(row.action),
      entityType: str(row.entityType), entityId: str(row.entityId),
      detail: typeof row.detail === 'object' && row.detail !== null
        ? row.detail as Row : {},
      createdAt: str(row.createdAt),
    })),
    stats: {
      companies: num(stats.companies), suspendedCompanies: num(stats.suspendedCompanies),
      plans: num(stats.plans), planLimits: num(stats.planLimits),
      usageRows: num(stats.usageRows), auditLogs: num(stats.auditLogs),
      quotasExceeded: num(stats.quotasExceeded),
    },
    rules: {
      pricing: str(rules.pricing) || PLATFORM_RULES.pricing,
      suspension: str(rules.suspension) || PLATFORM_RULES.suspension,
      quotas: str(rules.quotas) || PLATFORM_RULES.quotas,
      audit: str(rules.audit) || PLATFORM_RULES.audit,
    },
  };
}
