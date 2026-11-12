import { PAY_METHOD_DB_KEY, type PayMethod } from '../types';
import { MAX_MONEY } from './validation';

/** Résultat d'une commande serveur : un refus certain n'est pas une réponse perdue. */
export class PaymentCommandError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown') {
    super(message);
    this.name = 'PaymentCommandError';
  }
}

export interface PendingPayment {
  version: 1;
  userId: string;
  stationId: string;
  washId: string;
  amount: number;
  method: PayMethod;
  key: string;
}

const prefix = 'washguard.pending-payment.v1';
const storageKey = (user: string, station: string, wash: string) => `${prefix}:${user}:${station}:${wash}`;
function valid(value: unknown, user: string, station: string, wash: string): value is PendingPayment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return p.version === 1 && p.userId === user && p.stationId === station && p.washId === wash
    && Boolean(user && station && wash) && typeof p.amount === 'number' && Number.isSafeInteger(p.amount)
    && p.amount > 0 && p.amount <= MAX_MONEY && typeof p.method === 'string'
    && Object.prototype.hasOwnProperty.call(PAY_METHOD_DB_KEY, p.method)
    && typeof p.key === 'string' && /^[A-Za-z0-9._-]{8,120}$/.test(p.key);
}

export function readPendingPayment(user: string, station: string, wash: string): PendingPayment | null {
  let raw: string | null;
  try { raw = sessionStorage.getItem(storageKey(user, station, wash)); }
  catch { throw new Error('Stockage de session indisponible : vérifiez les encaissements avant toute nouvelle opération.'); }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed, user, station, wash)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('Tentative de paiement illisible : vérifiez les encaissements avant de poursuivre.');
  }
}

export function savePendingPayment(p: PendingPayment): void {
  if (!valid(p, p.userId, p.stationId, p.washId)) throw new Error('Paiement invalide : aucun encaissement envoyé.');
  try {
    const key = storageKey(p.userId, p.stationId, p.washId);
    const value = JSON.stringify(p);
    sessionStorage.setItem(key, value);
    if (sessionStorage.getItem(key) !== value) throw new Error('storage');
  } catch { throw new Error('Stockage de session indisponible : aucun encaissement envoyé.'); }
}

export function clearPendingPayment(p: PendingPayment): void {
  if (readPendingPayment(p.userId, p.stationId, p.washId)?.key === p.key) {
    sessionStorage.removeItem(storageKey(p.userId, p.stationId, p.washId));
  }
}
