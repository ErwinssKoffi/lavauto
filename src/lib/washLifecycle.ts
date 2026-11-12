import type {
  Wash, WashStatus, WashStatusEvent, WashQualityResult,
} from '../types';
import { LEGACY_WASH_STATUS, WASH_STATUS_FLOW, payMethodFrom } from '../types';

// ─── Prompt 05 : règles pures du cycle de lavage ─────────────────────────────
// Miroir EXACT du trigger SQL `assert_wash_status_transition()` (migration 021).
// Aucune écriture ici : le store local et l'adaptateur Supabase appliquent ces
// règles avant d'appeler les RPC, qui restent l'autorité côté serveur.

export const ALL_WASH_STATUSES: WashStatus[] = [
  'pending', 'assigned', 'in_progress', 'quality_check', 'ready', 'delivered', 'cancelled',
];

export function isWashStatus(value: unknown): value is WashStatus {
  return typeof value === 'string' && (ALL_WASH_STATUSES as string[]).includes(value);
}

/** Statuts vers lesquels une fiche peut évoluer (annulation incluse). */
export function nextWashStatuses(from: WashStatus): WashStatus[] {
  if (from === 'cancelled' || from === 'delivered') return [];
  return WASH_STATUS_FLOW[from].filter((s) => s !== 'cancelled');
}

export function canTransitionWash(from: WashStatus, to: WashStatus): boolean {
  return WASH_STATUS_FLOW[from].includes(to);
}

export function washEvent(
  from: WashStatus | null, to: WashStatus, reason: string | null,
  at: string, actor: string | null, id: string,
): WashStatusEvent {
  return { id, fromStatus: from, toStatus: to, reason, at, actorUserId: actor };
}

/**
 * Migration à la lecture des anciennes fiches `washguard.state.v1` :
 * 4 statuts FR → 7 statuts EN, UN événement d'historique initial par fiche
 * importée, et valeurs par défaut des nouveaux champs. Idempotent : une fiche
 * déjà normalisée n'est pas modifiée.
 */
export function normalizeWashes(value: unknown[] | undefined): Wash[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const w = raw as Partial<Wash> & { status?: string };
    const legacy = LEGACY_WASH_STATUS[w.status ?? ''];
    const status: WashStatus = legacy ?? (isWashStatus(w.status) ? w.status : 'pending');
    const migrated = Boolean(legacy) || !isWashStatus(w.status);
    const createdAt = typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString();
    const id = typeof w.id === 'string' ? w.id : `wash-import-${index}`;
    const history: WashStatusEvent[] = Array.isArray(w.history) ? w.history : [];
    if (migrated || history.length === 0) {
      history.unshift(washEvent(
        null, status,
        migrated ? 'Import du statut historique (mapping FR → EN)' : 'Création de la fiche',
        createdAt, null, `${id}-initial`,
      ));
    }
    const assignedUserIds = Array.isArray(w.assignedUserIds)
      ? w.assignedUserIds.filter((u): u is string => typeof u === 'string')
      : (typeof w.employeeId === 'string' && w.employeeId ? [w.employeeId] : []);
    return {
      ...w,
      id,
      status,
      createdAt,
      history,
      assignedUserIds,
      employeeId: typeof w.employeeId === 'string' ? w.employeeId : (assignedUserIds[0] ?? ''),
      postId: typeof w.postId === 'string' ? w.postId : null,
      deliveredAt: typeof w.deliveredAt === 'string' ? w.deliveredAt : null,
      finishedAt: typeof w.finishedAt === 'string' ? w.finishedAt : null,
      cancelledReason: typeof w.cancelledReason === 'string' ? w.cancelledReason : null,
      qualityResult: (w.qualityResult === 'approved' || w.qualityResult === 'rejected')
        ? w.qualityResult as WashQualityResult : null,
      qualityNotes: typeof w.qualityNotes === 'string' ? w.qualityNotes : null,
      items: Array.isArray(w.items) ? w.items : [],
      payments: (Array.isArray(w.payments) ? w.payments : []).map((p) => ({
        ...p,
        method: payMethodFrom(p?.method),
        idempotencyKey: typeof p?.idempotencyKey === 'string' ? p.idempotencyKey : null,
        cancelledAt: typeof p?.cancelledAt === 'string' ? p.cancelledAt : null,
        cancelReason: typeof p?.cancelReason === 'string' ? p.cancelReason : null,
      })),
    } as Wash;
  });
}

/** Un lavage « prêt » n'est PAS « livré » : distinction métier centrale. */
export function isReadyNotDelivered(w: Wash): boolean {
  return w.status === 'ready' && w.deliveredAt === null;
}

/** Chaque fiche n'est comptée qu'une fois, quel que soit son statut final. */
export function countUniqueWashes(washes: Wash[]): number {
  return new Set(washes.map((w) => w.id)).size;
}

/** Commissions : lavages terminés (prêts OU livrés), jamais deux fois. */
export function finishedWashes(washes: Wash[]): Wash[] {
  const seen = new Set<string>();
  return washes.filter((w) => {
    if (seen.has(w.id) || (w.status !== 'ready' && w.status !== 'delivered')) return false;
    seen.add(w.id);
    return true;
  });
}

export function washStatusTone(status: WashStatus): 'success' | 'danger' | 'accent' | 'warn' {
  if (status === 'cancelled') return 'danger';
  if (status === 'delivered' || status === 'ready') return 'success';
  if (status === 'in_progress' || status === 'quality_check' || status === 'assigned') return 'accent';
  return 'warn';
}
