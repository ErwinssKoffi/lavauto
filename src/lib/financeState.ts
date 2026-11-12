import type {
  AppState, CashClosure, CashMovement, CashSession, ChannelReconciliation,
  CommissionPayout, CommissionPeriod, CommissionStatementLine, Expense,
  PayMethod, PaymentCancellation, ProfitabilityReport,
} from '../types';
import { ApiError, PAY_METHOD_LABELS } from '../types';
import { uid } from './format';
import { buildProfitability, channelExpected, financeSnapshotFromState, FIXED_COST_CATEGORIES } from './finance';
import { finishedWashes } from './washLifecycle';

// ─── Prompt 06 : transformations PURES de l'état local ────────────────────────
// Le mode local conserve la même sémantique que les RPC 024–029 : mouvements
// signés, relevés immuables, annulations tracées et canaux figés. Aucune donnée
// de démonstration : seules les actions explicites de l'utilisateur écrivent.

export function emptyFinanceCollections() {
  return {
    cashMovements: [] as CashMovement[],
    cashClosures: [] as CashClosure[],
    paymentMethods: [] as AppState['paymentMethods'],
    reconciliations: [] as ChannelReconciliation[],
    commissionPeriods: [] as CommissionPeriod[],
    commissionLines: [] as CommissionStatementLine[],
    commissionPayouts: [] as CommissionPayout[],
    paymentCancellations: [] as PaymentCancellation[],
    profitability: null as ProfitabilityReport | null,
  };
}

/** Migration idempotente d'un état navigateur P05 vers les collections P06. */
export function withFinanceDefaults(state: AppState): AppState {
  return {
    ...state,
    ...Object.fromEntries(
      Object.entries(emptyFinanceCollections()).map(([key, fallback]) => [
        key,
        (state as unknown as Record<string, unknown>)[key] ?? fallback,
      ])
    ) as ReturnType<typeof emptyFinanceCollections>,
  } as AppState;
}

export function movement(
  state: AppState, sessionId: string, kind: CashMovement['kind'], amount: number,
  method: PayMethod | null, paymentId: string | null, expenseId: string | null,
  reference: string, idempotencyKey: string | null, at: string,
): CashMovement {
  return {
    id: uid('mov'),
    stationId: state.station?.id ?? '',
    cashSessionId: sessionId,
    kind,
    amount,
    uiMethod: method,
    paymentId,
    expenseId,
    reference,
    idempotencyKey,
    createdAt: at,
  };
}

export function cashPaymentMovement(
  state: AppState, washId: string, paymentId: string, amount: number,
  method: PayMethod, idempotencyKey: string | null, at: string,
): CashMovement | null {
  if (method !== 'especes') return null;
  const open = state.cashSessions.find((c) => c.status === 'ouverte');
  if (!open) return null;
  return movement(state, open.id, 'payment_in', amount, method, paymentId, null,
    `Fiche ${washId}`, idempotencyKey ? `cash:${idempotencyKey}` : null, at);
}

/** Comptage = mouvement `closing` (si écart) + relevé figé, jamais une réécriture. */
export function closeCashWithLedger(
  state: AppState, sessionId: string, counted: number, theoretical: number, at: string,
): AppState {
  const diff = counted - theoretical;
  const stationId = state.cashSessions.find((c) => c.id === sessionId)?.stationId
    ?? state.station?.id ?? '';
  const closure: CashClosure = {
    id: uid('close'), stationId, cashSessionId: sessionId,
    counted, theoretical, difference: diff,
    closedBy: state.session?.name ?? '—', createdAt: at,
  };
  const closingMovement = diff === 0 ? null : movement(
    state, sessionId, 'closing', diff, null, null, null,
    'Ecart de cloture', null, at,
  );
  return {
    ...state,
    cashSessions: state.cashSessions.map((c): CashSession => c.id === sessionId ? {
      ...c, status: 'cloturee', closedAt: at, countedAmount: counted,
      closedBy: state.session?.name ?? '—',
    } : c),
    cashClosures: [closure, ...(state.cashClosures ?? [])],
    cashMovements: [
      ...(state.cashMovements ?? []),
      ...(closingMovement ? [closingMovement] : []),
    ],
  };
}

/** Annulation d'un encaissement conservée ; ajustement caisse uniquement si ouverte. */
export function cancelPaymentWithLedger(
  state: AppState, paymentId: string, reason: string, at: string,
): AppState {
  const wash = state.washes.find((w) => (w.payments ?? []).some((p) => p.id === paymentId));
  const payment = wash?.payments.find((p) => p.id === paymentId);
  if (!wash || !payment) throw new ApiError('not_found', 'Paiement introuvable.');
  if ((state.paymentCancellations ?? []).some((c) => c.paymentId === paymentId)) {
    throw new ApiError('already_cancelled', 'Ce paiement est déjà annulé.');
  }
  const isCash = payment.method === 'especes';
  const original = (state.cashMovements ?? []).find(
    (m) => m.paymentId === paymentId && m.kind === 'payment_in'
  );
  const linkedSession = original
    ? state.cashSessions.find((c) => c.id === original.cashSessionId)
    : state.cashSessions.find((c) => c.status === 'ouverte');
  if (isCash && linkedSession && linkedSession.status !== 'ouverte') {
    throw new ApiError('cash_closed', 'Caisse clôturée : réouverture requise avant annulation.');
  }
  const cancellation: PaymentCancellation = {
    id: uid('cancel'), paymentId, amount: payment.amount, reason, at,
  };
  const adjustment = isCash && linkedSession
    ? movement(state, linkedSession.id, 'adjustment', -payment.amount, payment.method,
      paymentId, null, 'Remboursement / annulation encaissement',
      `cancel-payment:${paymentId}`, at)
    : null;
  return {
    ...state,
    washes: state.washes.map((w) => w.id === wash.id ? {
      ...w,
      paid: Math.max(0, w.paid - payment.amount),
      payments: w.payments.map((p) => p.id === paymentId ? {
        ...p, cancelledAt: at, cancelReason: reason,
      } : p),
    } : w),
    paymentCancellations: [cancellation, ...(state.paymentCancellations ?? [])],
    cashMovements: [
      ...(state.cashMovements ?? []),
      ...(adjustment ? [adjustment] : []),
    ],
  };
}

/** Annulation d'une dépense : trace + ajustement, jamais de suppression. */
export function cancelExpenseWithLedger(
  state: AppState, expenseId: string, reason: string, at: string,
): AppState {
  const expense = (state.expenses ?? []).find((e) => e.id === expenseId);
  if (!expense) throw new ApiError('not_found', 'Dépense introuvable.');
  if (expense.status === 'annulee') {
    throw new ApiError('already_cancelled', 'Cette dépense est déjà annulée.');
  }
  const original = (state.cashMovements ?? []).find(
    (m) => m.expenseId === expenseId && m.kind === 'expense_out'
  );
  const linkedSession = original
    ? state.cashSessions.find((c) => c.id === original.cashSessionId)
    : expense.cashSessionId
      ? state.cashSessions.find((c) => c.id === expense.cashSessionId)
      : null;
  if (expense.method === 'especes' && linkedSession && linkedSession.status !== 'ouverte') {
    throw new ApiError('cash_closed', 'Caisse clôturée : réouverture requise avant annulation.');
  }
  const adjustment = expense.method === 'especes' && linkedSession
    ? movement(state, linkedSession.id, 'adjustment', expense.amount, expense.method,
      null, expenseId, 'Annulation depense', `cancel-expense:${expenseId}`, at)
    : null;
  return {
    ...state,
    expenses: state.expenses.map((e): Expense => e.id === expenseId ? {
      ...e, status: 'annulee', cancelReason: reason,
    } : e),
    cashMovements: [
      ...(state.cashMovements ?? []),
      ...(adjustment ? [adjustment] : []),
    ],
  };
}

/** Rapprochement d'UN SEUL canal ; un relevé figé n'est jamais recalculé. */
export function reconcileChannelLocal(
  state: AppState, methodId: string, start: string, end: string, counted: number, at: string,
): AppState {
  const method = financeSnapshotFromState(state).paymentMethods.find((m) => m.id === methodId);
  if (!method) throw new ApiError('not_found', 'Canal introuvable.');
  if ((state.reconciliations ?? []).some(
    (r) => r.methodId === methodId && r.start === start && r.end === end
  )) {
    throw new ApiError('frozen_reconciliation', 'Rapprochement déjà figé pour ce canal et cette période.');
  }
  const expected = channelExpected(state, methodId, start, end);
  const reconciliation: ChannelReconciliation = {
    id: uid('recon'), stationId: method.stationId, methodId, uiMethod: method.uiMethod,
    start, end, expected, counted, difference: counted - expected,
    frozen: true, validatedAt: at,
  };
  return {
    ...state,
    reconciliations: [reconciliation, ...(state.reconciliations ?? [])],
  };
}

/** Brouillon de période : aucune ligne de commission n'est encore figée. */
export function createCommissionPeriodLocal(
  state: AppState, stationId: string, start: string, end: string,
): { state: AppState; id: string } {
  const duplicate = (state.commissionPeriods ?? []).find(
    (p) => p.stationId === stationId && p.start === start && p.end === end
  );
  if (duplicate) {
    if (duplicate.status !== 'draft') {
      throw new ApiError('frozen_period', 'Période figée : non recalculable.');
    }
    return { state, id: duplicate.id };
  }
  const period: CommissionPeriod = {
    id: uid('period'), stationId, start, end, status: 'draft', validatedAt: null,
  };
  return {
    state: { ...state, commissionPeriods: [period, ...(state.commissionPeriods ?? [])] },
    id: period.id,
  };
}

function linesForPeriod(state: AppState, period: CommissionPeriod, at: string): CommissionStatementLine[] {
  const from = new Date(period.start + 'T00:00:00').getTime();
  const to = new Date(period.end + 'T23:59:59').getTime();
  const byUser = new Map<string, { base: number; washes: number }>();
  finishedWashes(state.washes).forEach((w) => {
    const atMs = new Date(w.finishedAt ?? w.createdAt).getTime();
    if (!Number.isFinite(atMs) || atMs < from || atMs > to) return;
    const ids = Array.isArray(w.assignedUserIds) && w.assignedUserIds.length
      ? [...new Set(w.assignedUserIds)] : [w.employeeId];
    const share = w.total / Math.max(ids.length, 1);
    ids.forEach((userId) => {
      const cur = byUser.get(userId) ?? { base: 0, washes: 0 };
      cur.base += share; cur.washes += 1; byUser.set(userId, cur);
    });
  });
  return [...byUser.entries()].map(([userId, totals]) => {
    const user = state.users.find((u) => u.id === userId);
    const override = user?.commissionRateOverride != null;
    const rate = override ? (user?.commissionRateOverride as number) : state.station?.commissionRate ?? 0;
    return {
      id: uid('commission'), periodId: period.id, userId,
      userName: user?.name ?? 'Employé supprimé',
      washes: totals.washes, base: Math.round(totals.base), rate,
      rateOrigin: override ? 'contract' : 'station',
      amount: Math.round(totals.base * rate / 100), createdAt: at,
    };
  });
}

/** Validation = génération unique + gel ; plus aucun recalcul ultérieur. */
export function validateCommissionPeriodLocal(state: AppState, periodId: string, at: string): AppState {
  const period = (state.commissionPeriods ?? []).find((p) => p.id === periodId);
  if (!period) throw new ApiError('not_found', 'Période de commission introuvable.');
  if (period.status !== 'draft') {
    throw new ApiError('frozen_period', 'Période validée : non recalculable.');
  }
  const lines = linesForPeriod(state, period, at);
  return {
    ...state,
    commissionPeriods: (state.commissionPeriods ?? []).map((p) => p.id === periodId ? {
      ...p, status: 'validated', validatedAt: at,
    } : p),
    commissionLines: [
      ...(state.commissionLines ?? []).filter((l) => l.periodId !== periodId),
      ...lines,
    ],
  };
}

export function recordCommissionPayoutLocal(
  state: AppState, periodId: string, userId: string, amount: number,
  reference: string, at: string,
): AppState {
  const period = (state.commissionPeriods ?? []).find((p) => p.id === periodId);
  if (!period) throw new ApiError('not_found', 'Période introuvable.');
  if (period.status !== 'validated' && period.status !== 'paid') {
    throw new ApiError('frozen_period', 'Période non validée.');
  }
  if ((state.commissionPayouts ?? []).some((p) => p.periodId === periodId && p.userId === userId)) {
    throw new ApiError('already_paid', 'Commission déjà payée pour cet employé.');
  }
  const payout: CommissionPayout = {
    id: uid('payout'), periodId, userId, amount, reference, paidAt: at,
  };
  const payouts = [payout, ...(state.commissionPayouts ?? [])];
  const lines = (state.commissionLines ?? []).filter((l) => l.periodId === periodId);
  const allPaid = lines.length > 0 && lines.every(
    (l) => payouts.some((p) => p.userId === l.userId)
  );
  return {
    ...state,
    commissionPayouts: payouts,
    commissionPeriods: (state.commissionPeriods ?? []).map((p) => p.id === periodId && allPaid
      ? { ...p, status: 'paid' } : p),
  };
}

/** Rapport local, pour les écrans : exactement le même contrat que la RPC. */
export function localProfitability(state: AppState, start: string, end: string): ProfitabilityReport {
  return buildProfitability(state, new Date(start + 'T00:00:00'), new Date(end + 'T23:59:59'));
}

/** Libellés stables pour l'export CSV et les contrôles. */
export const PROFITABILITY_ROWS: (keyof ProfitabilityReport)[] = [
  'revenue', 'collected', 'receivables', 'expenses', 'purchases',
  'consumptions', 'commissions', 'fixedCosts', 'partialBalance',
];

export const FINANCE_SUMMARY_LABELS = {
  revenue: "Chiffre d'affaires", collected: 'Encaissé', receivables: 'Créances',
  expenses: 'Dépenses', purchases: 'Achats valorisés (P07)',
  consumptions: 'Consommations (P07)', commissions: 'Commissions validées',
  fixedCosts: 'Charges fixes', partialBalance: 'Solde partiel',
  grossMargin: 'Marge brute', result: 'Résultat net',
} as const;

export function isFixedCost(category: string): boolean {
  return FIXED_COST_CATEGORIES.includes(category.trim().toLowerCase());
}

export function methodLabel(method: PayMethod): string {
  return PAY_METHOD_LABELS[method];
}
