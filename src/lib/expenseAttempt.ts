import type { ExpenseCreatePayload } from '../services/adapters/DataAdapter';
import { validateExpense } from './validation';

/** Une réponse perdue n'est pas un refus SQL confirmé. */
export class ExpenseCommandError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown') {
    super(message);
    this.name = 'ExpenseCommandError';
  }
}

export interface PendingExpense {
  version: 1;
  userId: string;
  stationId: string;
  startedAt: string;
  payload: ExpenseCreatePayload;
}

const PREFIX = 'washguard.pending-expense.v1';
const keyFor = (userId: string, stationId: string) => `${PREFIX}:${userId}:${stationId}`;

function valid(value: unknown, userId: string, stationId: string): value is PendingExpense {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Partial<PendingExpense>;
  if (p.version !== 1 || !userId || !stationId || p.userId !== userId || p.stationId !== stationId
    || typeof p.startedAt !== 'string' || !Number.isFinite(Date.parse(p.startedAt))
    || !p.payload || typeof p.payload !== 'object' || p.payload.stationId !== stationId
    || typeof p.payload.idempotencyKey !== 'string' || !/^[A-Za-z0-9._-]{8,120}$/.test(p.payload.idempotencyKey)) return false;
  try { validateExpense(p.payload); return true; } catch { return false; }
}

export function readPendingExpense(userId: string, stationId: string): PendingExpense | null {
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(keyFor(userId, stationId)); }
  catch { throw new Error('Stockage de session indisponible : vérifiez les dépenses avant toute nouvelle opération.'); }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!valid(value, userId, stationId)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Tentative de dépense illisible : vérifiez les dépenses avant de poursuivre.');
  }
}

export function savePendingExpense(pending: PendingExpense): void {
  if (!valid(pending, pending.userId, pending.stationId)) throw new Error('Dépense invalide : aucune opération envoyée.');
  try {
    const key = keyFor(pending.userId, pending.stationId);
    const raw = JSON.stringify(pending);
    window.sessionStorage.setItem(key, raw);
    if (window.sessionStorage.getItem(key) !== raw) throw new Error('storage');
  } catch { throw new Error('Stockage de session indisponible : aucune dépense envoyée.'); }
}

export function assertPendingExpense(pending: PendingExpense): void {
  const existing = readPendingExpense(pending.userId, pending.stationId);
  if (!existing) throw new Error('La tentative conservée a disparu : vérifiez les dépenses avant de poursuivre.');
  if (JSON.stringify(existing) !== JSON.stringify(pending)) {
    throw new Error('La tentative conservée a changé : vérifiez les dépenses avant de poursuivre.');
  }
}

export function clearPendingExpense(pending: PendingExpense): void {
  assertPendingExpense(pending);
  window.sessionStorage.removeItem(keyFor(pending.userId, pending.stationId));
  if (window.sessionStorage.getItem(keyFor(pending.userId, pending.stationId)) !== null) {
    throw new Error('Effacement de la tentative non confirmé.');
  }
}
