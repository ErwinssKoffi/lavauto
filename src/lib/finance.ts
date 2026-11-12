import type {
  AppState, CashClosure, CashMovement, CashMovementKind, CashSession,
  ChannelReconciliation, CommissionPayout, CommissionPeriod,
  CommissionPeriodStatus, CommissionStatementLine, Expense,
  PayMethod, PaymentCancellation, PaymentMethod, ProfitabilityReport,
} from '../types';
import { payMethodFrom } from '../types';
import { STOCK_EXPENSE_CATEGORIES } from './stock';

// ─── Prompt 06 : projections serveur → domaine, aucune donnée fabriquée ───────
// `my_finance_board()` renvoie un JSONB agrégé déjà filtré par RLS et par
// station. Ces fonctions sont pures et testables sans réseau : elles ne créent
// aucun montant, aucun client et aucun tenant.

export interface FinanceSnapshot {
  paymentMethods: PaymentMethod[];
  cashSessions: CashSession[];
  cashMovements: CashMovement[];
  cashClosures: CashClosure[];
  expenses: Expense[];
  reconciliations: ChannelReconciliation[];
  commissionPeriods: CommissionPeriod[];
  commissionLines: CommissionStatementLine[];
  commissionPayouts: CommissionPayout[];
  paymentCancellations: PaymentCancellation[];
}

type Row = Record<string, unknown>;

function asRecord(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Ligne ${label} invalide reçue depuis my_finance_board().`);
  }
  return value as Row;
}

function arr(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`Collection ${label} invalide.`);
  return value.map((entry) => asRecord(entry, label));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function method(value: unknown): PayMethod {
  return payMethodFrom(value);
}

function iso(value: unknown, fallback: string): string {
  const str = text(value);
  return str || fallback;
}

function dateOnly(value: unknown, fallback: string): string {
  const str = text(value);
  return str ? str.slice(0, 10) : fallback;
}

const NOW = new Date().toISOString();

/** `my_finance_board()` → état UI typé, sans identifiant d'entreprise. */
export function mapFinanceBoard(value: unknown): FinanceSnapshot {
  const board = asRecord(value, 'my_finance_board');
  return {
    paymentMethods: arr(board.paymentMethods, 'paymentMethods').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), key: text(r.key),
      label: text(r.label), uiMethod: method(r.uiMethod),
      affectsCash: bool(r.affectsCash), active: bool(r.active),
    })),
    cashSessions: arr(board.cashSessions, 'cashSessions').map((r) => ({
      id: text(r.id), stationId: text(r.stationId),
      openedBy: text(r.openedBy), openedAt: iso(r.openedAt, NOW),
      openingFloat: number(r.openingFloat),
      closedAt: nullableText(r.closedAt),
      countedAmount: r.countedAmount === null || r.countedAmount === undefined
        ? null : number(r.countedAmount),
      closedBy: nullableText(r.closedBy),
      status: text(r.status) === 'ouverte' ? 'ouverte' : 'cloturee',
      reopenReason: nullableText(r.reopenReason),
      reopenedAt: nullableText(r.reopenedAt),
    })),
    cashMovements: arr(board.cashMovements, 'cashMovements').map((r) => ({
      id: text(r.id), stationId: text(r.stationId),
      cashSessionId: text(r.cashSessionId),
      kind: (text(r.kind) || 'adjustment') as CashMovementKind,
      amount: number(r.amount),
      uiMethod: r.uiMethod === null || r.uiMethod === undefined ? null : method(r.uiMethod),
      paymentId: nullableText(r.paymentId), expenseId: nullableText(r.expenseId),
      reference: text(r.reference), idempotencyKey: nullableText(r.idempotencyKey),
      createdAt: iso(r.createdAt, NOW),
    })),
    cashClosures: arr(board.cashClosures, 'cashClosures').map((r) => ({
      id: text(r.id), stationId: text(r.stationId),
      cashSessionId: text(r.cashSessionId), counted: number(r.counted),
      theoretical: number(r.theoretical), difference: number(r.difference),
      closedBy: text(r.closedBy), createdAt: iso(r.createdAt, NOW),
    })),
    expenses: arr(board.expenses, 'expenses').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), amount: number(r.amount),
      category: text(r.category) || 'Autre', reason: text(r.reason),
      supplier: text(r.supplier), date: dateOnly(r.date, NOW.slice(0, 10)),
      method: method(r.method), cashSessionId: nullableText(r.cashSessionId),
      status: text(r.status) === 'annulee' ? 'annulee' : 'enregistree',
      cancelReason: nullableText(r.cancelReason), createdBy: text(r.createdBy),
      createdAt: iso(r.createdAt, NOW), idempotencyKey: nullableText(r.idempotencyKey),
      purchaseOrderId: nullableText(r.purchaseOrderId),
    })),
    reconciliations: arr(board.reconciliations, 'reconciliations').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), methodId: text(r.methodId),
      uiMethod: method(r.uiMethod), start: dateOnly(r.start, NOW.slice(0, 10)),
      end: dateOnly(r.end, NOW.slice(0, 10)), expected: number(r.expected),
      counted: number(r.counted), difference: number(r.difference),
      frozen: bool(r.frozen), validatedAt: nullableText(r.validatedAt),
    })),
    commissionPeriods: arr(board.commissionPeriods, 'commissionPeriods').map((r) => ({
      id: text(r.id), stationId: text(r.stationId),
      start: dateOnly(r.start, NOW.slice(0, 10)), end: dateOnly(r.end, NOW.slice(0, 10)),
      status: (['draft', 'validated', 'paid'].includes(text(r.status))
        ? text(r.status) : 'draft') as CommissionPeriodStatus,
      validatedAt: nullableText(r.validatedAt),
    })),
    commissionLines: arr(board.commissionLines, 'commissionLines').map((r) => ({
      id: text(r.id), periodId: text(r.periodId), userId: text(r.userId),
      userName: text(r.userName) || 'Employé', washes: number(r.washes),
      base: number(r.base), rate: number(r.rate), rateOrigin: text(r.rateOrigin),
      amount: number(r.amount), createdAt: iso(r.createdAt, NOW),
    })),
    commissionPayouts: arr(board.commissionPayouts, 'commissionPayouts').map((r) => ({
      id: text(r.id), periodId: text(r.periodId), userId: text(r.userId),
      amount: number(r.amount), reference: text(r.reference), paidAt: iso(r.paidAt, NOW),
    })),
    paymentCancellations: arr(board.paymentCancellations, 'paymentCancellations').map((r) => ({
      id: text(r.id), paymentId: text(r.paymentId), amount: number(r.amount),
      reason: text(r.reason), at: iso(r.at, NOW),
    })),
  };
}

/** Repli local : l'état navigateur est déjà la source de vérité en mode local. */
export function financeSnapshotFromState(state: AppState): FinanceSnapshot {
  // Le mode local n'a pas besoin de lignes `payment_methods` persistées :
  // les quatre canaux configurés sur la station servent d'identifiants stables.
  const configured = state.station?.paymentMethods ?? [];
  const localMethods: PaymentMethod[] = configured.map((uiMethod) => ({
    id: `local:${uiMethod}`,
    stationId: state.station?.id ?? '',
    key: uiMethod,
    label: uiMethod,
    uiMethod,
    affectsCash: uiMethod === 'especes',
    active: true,
  }));
  return {
    paymentMethods: (state.paymentMethods ?? []).length ? (state.paymentMethods ?? []) : localMethods,
    cashSessions: state.cashSessions ?? [],
    cashMovements: state.cashMovements ?? [],
    cashClosures: state.cashClosures ?? [],
    expenses: state.expenses ?? [],
    reconciliations: state.reconciliations ?? [],
    commissionPeriods: state.commissionPeriods ?? [],
    commissionLines: state.commissionLines ?? [],
    commissionPayouts: state.commissionPayouts ?? [],
    paymentCancellations: state.paymentCancellations ?? [],
  };
}

export const FIXED_COST_CATEGORIES = [
  'loyer', 'salaires', 'eau', 'electricite', 'électricité', 'assurance', 'abonnement',
];

function inRange(isoValue: string, start: Date, end: Date): boolean {
  const t = new Date(isoValue).getTime();
  return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
}

/**
 * Rapport de rentabilité LOCAL, miroir exact de `my_profitability()`.
 * Aucun « bénéfice net » sans attestation : P07 fournit les coûts de consommation.
 */
export function buildProfitability(state: AppState, start: Date, end: Date): ProfitabilityReport {
  const washes = (state.washes ?? []).filter(
    (w) => w.status !== 'cancelled' && inRange(w.createdAt, start, end)
  );
  const revenue = washes.reduce((sum, w) => sum + w.total, 0);
  const allPayments = (state.washes ?? []).flatMap((w) => w.payments ?? [])
    .filter((p) => inRange(p.at, start, end));
  const cancellations = (state.paymentCancellations ?? []).filter((c) => inRange(c.at, start, end));
  const collected = allPayments.reduce((sum, p) => sum + p.amount, 0)
    - cancellations.reduce((sum, c) => sum + c.amount, 0);
  const receivables = washes.reduce((sum, w) => sum + Math.max(w.total - w.paid, 0), 0);
  const recorded = (state.expenses ?? []).filter(
    (e) => e.status === 'enregistree' && inRange(e.date + 'T00:00:00', start, end)
  );
  const expenses = recorded.reduce((sum, e) => sum + e.amount, 0);
  const fixedCosts = recorded
    .filter((e) => FIXED_COST_CATEGORIES.includes(e.category.trim().toLowerCase()))
    .reduce((sum, e) => sum + e.amount, 0);
  const frozenPeriods = new Set(
    (state.commissionPeriods ?? [])
      .filter((p) => p.status === 'validated' || p.status === 'paid')
      .map((p) => p.id)
  );
  const commissions = (state.commissionLines ?? [])
    .filter((l) => frozenPeriods.has(l.periodId) && inRange(l.createdAt, start, end))
    .reduce((sum, l) => sum + l.amount, 0);

  const movements = state.stockMovements ?? [];
  const purchases = movements
    .filter((m) => m.kind === 'purchase_receipt' && inRange(m.createdAt, start, end))
    .reduce((sum, m) => sum + Math.max(0, m.qtyDelta) * m.unitCostMinor, 0);
  const consumptions = movements
    .filter((m) => m.kind === 'consumption' && inRange(m.createdAt, start, end))
    .reduce((sum, m) => sum + Math.max(0, -m.qtyDelta) * m.unitCostMinor, 0);
  const operatingExpenses = recorded
    .filter((e) => !(STOCK_EXPENSE_CATEGORIES.includes(e.category.trim().toLowerCase()) && e.purchaseOrderId))
    .reduce((sum, e) => sum + e.amount, 0);
  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);
  const certification = (state.costCertifications ?? [])
    .find((c) => c.start === startISO && c.end === endISO);
  const definitions = {
    revenue: 'Chiffre d affaires : total des fiches non annulees de la periode',
    collected: 'Encaissements nets : paiements moins annulations',
    receivables: 'Creances : total moins encaisse des fiches non annulees',
    purchases: 'Acquisitions de stock : jamais une charge de periode',
    consumptions: 'Cout des produits consommes, valorise au cout moyen de reception',
    operatingExpenses: 'Charges d exploitation hors achats de stock deja rattaches',
    partialBalance: 'Solde partiel : encaisse moins depenses constatees ; PAS un benefice net',
  };
  if (certification) {
    return {
      periodStart: startISO, periodEnd: endISO,
      revenue: certification.revenueMinor, collected, receivables, expenses, purchases,
      consumptions: certification.consumptionCostMinor,
      operatingExpenses: certification.operatingExpenseMinor,
      commissions: certification.commissionCostMinor, fixedCosts,
      partialBalance: collected - expenses,
      grossMargin: certification.grossMarginMinor,
      result: certification.resultMinor,
      costsMissing: false,
      certified: true,
      certifiedAt: certification.certifiedAt,
      attestation: certification.attestation,
      label: 'Couts certifies : resultat net calculable',
      missing: [],
      definitions: {
        ...definitions,
        grossMargin: 'Marge brute certifiee : CA moins consommations valorisees',
        result: 'Resultat net certifie : marge brute moins charges d exploitation et commissions',
      },
    };
  }
  return {
    periodStart: startISO,
    periodEnd: endISO,
    revenue, collected, receivables, expenses,
    purchases, consumptions, operatingExpenses, commissions, fixedCosts,
    partialBalance: collected - expenses,
    grossMargin: null,
    result: null,
    costsMissing: true,
    certified: false,
    certifiedAt: null,
    attestation: null,
    label: 'Couts manquants : resultat net non calculable avant P07',
    missing: [
      'Consommations valorisees par lavage (P07)',
      'Attestation des couts de la periode',
      'Achats de stock non doublement comptes',
      'Commissions de periode non validee',
    ],
    definitions,
  };
}

/** `my_profitability()` → rapport typé, sans transformer NULL en 0. */
export function mapProfitability(value: unknown): ProfitabilityReport {
  const r = asRecord(value, 'my_profitability');
  const strArray = (v: unknown): string[] => Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string') : [];
  const definitions: Record<string, string> = {};
  const rawDefinitions = r.definitions;
  if (typeof rawDefinitions === 'object' && rawDefinitions !== null && !Array.isArray(rawDefinitions)) {
    Object.entries(rawDefinitions as Row).forEach(([key, val]) => {
      if (typeof val === 'string') definitions[key] = val;
    });
  }
  return {
    periodStart: text(r.periodStart), periodEnd: text(r.periodEnd),
    revenue: number(r.revenue), collected: number(r.collected),
    receivables: number(r.receivables), expenses: number(r.expenses),
    purchases: number(r.purchases), consumptions: number(r.consumptions),
    commissions: number(r.commissions), fixedCosts: number(r.fixedCosts),
    partialBalance: number(r.partialBalance),
    grossMargin: r.grossMargin === null || r.grossMargin === undefined ? null : number(r.grossMargin),
    result: r.result === null || r.result === undefined ? null : number(r.result),
    costsMissing: bool(r.costsMissing),
    label: text(r.label),
    missing: strArray(r.missing),
    definitions,
    operatingExpenses: number(r.operatingExpenses),
    certified: bool(r.certified),
    certifiedAt: nullableText(r.certifiedAt),
    attestation: nullableText(r.attestation),
  };
}

/** Attendu d'un canal sur une période : paiements nets du seul moyen choisi. */
export function channelExpected(
  state: AppState, methodId: string, start: string, end: string
): number {
  const from = new Date(start + 'T00:00:00');
  const to = new Date(end + 'T23:59:59');
  // Le mode local dérive ses canaux de `station.paymentMethods` : aucun faux
  // identifiant de canal n'est créé pour autant.
  const methods = new Set(
    financeSnapshotFromState(state).paymentMethods
      .filter((m) => m.id === methodId).map((m) => m.uiMethod)
  );
  const payments = (state.washes ?? []).flatMap((w) => w.payments ?? [])
    .filter((p) => methods.has(p.method) && inRange(p.at, from, to));
  const cancelledIds = new Set((state.paymentCancellations ?? [])
    .filter((c) => inRange(c.at, from, to)).map((c) => c.paymentId));
  return payments
    .filter((p) => !cancelledIds.has(p.id))
    .reduce((sum, p) => sum + p.amount, 0);
}
