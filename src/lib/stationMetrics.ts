import { payMethodFrom, type PayMethod } from '../types';

/** Agrégats exhaustifs de la station, indépendants de la limite de la file. */
export interface StationDayMetric {
  date: string;
  revenue: number;
  collected: number | null;
  expenses: number | null;
  washCount: number;
  finishedCount: number;
}
export interface StationMetrics {
  stationId: string;
  periodStart: string;
  periodEnd: string;
  financeAvailable: boolean;
  trend: StationDayMetric[];
  byMethod: { method: PayMethod; amount: number; count: number }[];
  byDayMethod: { date: string; method: PayMethod; amount: number; count: number }[];
  topServices: { name: string; count: number; revenue: number }[];
  byEmployee: { id: string; name: string; count: number; revenue: number }[];
  bestClients: { name: string; count: number; revenue: number }[];
}

type Row = Record<string, unknown>;
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Indicateurs de station invalides.');
  return value as Row;
}
function array(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('Collection d’indicateurs invalide.');
  return value.map(record);
}
function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Indicateur numérique invalide ou trop grand pour être affiché sans perte.');
  return parsed;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Indicateur textuel invalide.');
  return value;
}
function nullableNumber(value: unknown): number | null { return value === null ? null : number(value); }

export function mapStationMetrics(value: unknown, stationId: string, start: string, end: string): StationMetrics {
  const r = record(value);
  if (r.stationId !== stationId || r.periodStart !== start || r.periodEnd !== end || typeof r.financeAvailable !== 'boolean') {
    throw new Error('La réponse ne correspond pas à la station et à la période demandées.');
  }
  return {
    stationId, periodStart: start, periodEnd: end, financeAvailable: r.financeAvailable,
    trend: array(r.trend).map((d) => ({
      date: text(d.date), revenue: number(d.revenue), collected: nullableNumber(d.collected),
      expenses: nullableNumber(d.expenses), washCount: number(d.washCount), finishedCount: number(d.finishedCount),
    })),
    byMethod: array(r.byMethod).map((m) => ({ method: payMethodFrom(m.method), amount: number(m.amount), count: number(m.count) })),
    byDayMethod: array(r.byDayMethod).map((m) => ({ date: text(m.date), method: payMethodFrom(m.method), amount: number(m.amount), count: number(m.count) })),
    topServices: array(r.topServices).map((x) => ({ name: text(x.name), count: number(x.count), revenue: number(x.revenue) })),
    byEmployee: array(r.byEmployee).map((x) => ({ id: text(x.id), name: text(x.name), count: number(x.count), revenue: number(x.revenue) })),
    bestClients: array(r.bestClients).map((x) => ({ name: text(x.name), count: number(x.count), revenue: number(x.revenue) })),
  };
}
