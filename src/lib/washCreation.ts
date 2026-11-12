import type { WashCreatePayload } from '../services/adapters/DataAdapter';
import { PAY_METHOD_DB_KEY } from '../types';

/** Un refus serveur explicite est différent d'une réponse perdue ou illisible. */
export class WashCreationError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown') {
    super(message);
    this.name = 'WashCreationError';
  }
}

/** Copie exacte de la commande, pour rejouer la même clé après un résultat incertain. */
export interface PendingWashCreation {
  version: 1;
  userId: string;
  stationId: string;
  startedAt: string;
  payload: WashCreatePayload;
}

const PREFIX = 'washguard.pending-wash.v1';
const storageKey = (userId: string, stationId: string) => `${PREFIX}:${userId}:${stationId}`;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Ne jamais rejouer une commande partiellement corrompue comme une nouvelle saisie. */
function validPending(value: unknown, userId: string, stationId: string): value is PendingWashCreation {
  if (!object(value) || value.version !== 1 || value.userId !== userId || value.stationId !== stationId
    || !nonempty(userId) || !nonempty(stationId) || typeof value.startedAt !== 'string'
    || !Number.isFinite(Date.parse(value.startedAt)) || !object(value.payload)) return false;
  const p = value.payload;
  if (p.stationId !== stationId || !nonempty(p.categoryId) || typeof p.plate !== 'string'
    || (p.clientId !== null && typeof p.clientId !== 'string') || typeof p.clientName !== 'string'
    || (p.postId !== null && typeof p.postId !== 'string')
    || typeof p.idempotencyKey !== 'string' || !/^[A-Za-z0-9._-]{8,120}$/.test(p.idempotencyKey)
    || !Number.isSafeInteger(p.discount) || (p.discount as number) < 0
    || !Array.isArray(p.items) || p.items.length === 0
    || !p.items.every((item: unknown) => object(item) && nonempty(item.serviceId)
      && Number.isSafeInteger(item.qty) && (item.qty as number) > 0)
    || !Array.isArray(p.employeeIds) || !p.employeeIds.every(nonempty)) return false;
  return p.payment === null || (object(p.payment)
    && Number.isSafeInteger(p.payment.amount) && (p.payment.amount as number) > 0
    && typeof p.payment.method === 'string'
    && Object.prototype.hasOwnProperty.call(PAY_METHOD_DB_KEY, p.payment.method));
}

function storage(): Storage {
  try { return window.sessionStorage; }
  catch { throw new Error('La conservation de la tentative est indisponible dans ce navigateur : aucune fiche n’a été envoyée.'); }
}

/** Un état corrompu bloque une nouvelle création plutôt que d'effacer une tentative incertaine. */
export function readPendingWash(userId: string, stationId: string): PendingWashCreation | null {
  let raw: string | null;
  try { raw = storage().getItem(storageKey(userId, stationId)); }
  catch { throw new Error('La conservation de la tentative est indisponible dans ce navigateur : vérifiez les fiches avant toute nouvelle création.'); }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!validPending(value, userId, stationId)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Tentative de création illisible : vérifiez les fiches et contactez un administrateur avant toute nouvelle création.');
  }
}

/** Écrire AVANT la requête : un rechargement pendant l'appel doit garder sa clé. */
export function savePendingWash(pending: PendingWashCreation): void {
  if (!validPending(pending, pending.userId, pending.stationId)) {
    throw new Error('Fiche invalide : utilisez des montants et quantités entiers. Aucune fiche n’a été envoyée.');
  }
  try {
    const key = storageKey(pending.userId, pending.stationId);
    const value = JSON.stringify(pending);
    const target = storage();
    target.setItem(key, value);
    if (target.getItem(key) !== value) throw new Error('storage');
  } catch {
    throw new Error('La conservation de la tentative est indisponible dans ce navigateur : aucune fiche n’a été envoyée.');
  }
}

export function clearPendingWash(pending: PendingWashCreation): void {
  // Ne jamais effacer une autre tentative si le contexte a changé entre-temps.
  const current = readPendingWash(pending.userId, pending.stationId);
  if (current?.payload.idempotencyKey === pending.payload.idempotencyKey) {
    storage().removeItem(storageKey(pending.userId, pending.stationId));
  }
}
