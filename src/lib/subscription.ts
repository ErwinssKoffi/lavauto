import type { AppState, Plan, PlanFeature, PlanFeatures } from '../types';
import { isDate } from './validation';

export const FEATURE_KEYS: PlanFeature[] = ['stock', 'loyalty', 'fleets', 'consolidation', 'audit'];
export const FEATURE_LABELS: Record<PlanFeature, string> = {
  stock: 'Stock, achats et consommations',
  loyalty: 'Fidélité, forfaits et promotions',
  fleets: 'Flottes et contrats',
  consolidation: 'Consolidation multi-stations',
  audit: 'Journal des opérations sensibles',
};
export const CORE_FEATURES = 'Lavages, clients, employés, caisse, dépenses, rapports et commissions';
export const NO_ADVANCED: PlanFeatures = { stock: false, loyalty: false, fleets: false, consolidation: false, audit: false };

export interface SubscriptionRequest {
  id: string;
  companyId: string;
  companyName: string;
  fromPlanId: string | null;
  toPlanId: string;
  toPlanName: string;
  requestedAt: string;
}

export interface SubscriptionAccess {
  id: string;
  companyId: string;
  planId: string;
  planName: string;
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  startedAt: string;
  trialEndsAt: string | null;
  /** Jour de fin exclusif, à minuit UTC, pour une formule payante. */
  currentPeriodEnd: string | null;
  pendingPlanId: string | null;
  canWrite: boolean;
  reason: string | null;
  features: PlanFeatures;
  /** Date limite estimée depuis l'horloge serveur ; jamais une autorisation serveur. */
  clientWriteDeadline: number | null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse d’abonnement invalide.');
  return value as Record<string, unknown>;
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Réponse d’abonnement incomplète.');
  return value;
}
function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

/** Ne jamais accepter une réponse partielle ou attribuée à une autre entreprise. */
export function mapSubscriptionAccess(raw: unknown, companyId: string, receivedAt = Date.now()): SubscriptionAccess {
  const r = record(raw);
  const status = requiredString(r.status);
  if (!['trial', 'active', 'past_due', 'suspended', 'cancelled'].includes(status)
    || r.companyId !== companyId || typeof r.canWrite !== 'boolean') {
    throw new Error('Abonnement serveur incohérent ou attribué à une autre entreprise.');
  }
  const featuresRaw = record(r.features);
  const features = { ...NO_ADVANCED };
  for (const key of FEATURE_KEYS) {
    if (typeof featuresRaw[key] !== 'boolean') throw new Error('Droits de formule incomplets.');
    features[key] = featuresRaw[key] as boolean;
  }
  const startedAt = requiredString(r.startedAt);
  const trialEndsAt = nullableString(r.trialEndsAt);
  const currentPeriodEnd = nullableString(r.currentPeriodEnd);
  const serverTime = Date.parse(requiredString(r.serverTime));
  if (!Number.isFinite(serverTime) || !Number.isFinite(Date.parse(startedAt))
    || (trialEndsAt !== null && !Number.isFinite(Date.parse(trialEndsAt)))
    || (currentPeriodEnd !== null && !isDate(currentPeriodEnd))
    || (status === 'active' && currentPeriodEnd === null)) {
    throw new Error('Dates d’abonnement illisibles.');
  }
  const planId = requiredString(r.planId);
  const endTime = status === 'trial' && trialEndsAt ? Date.parse(trialEndsAt)
    : status === 'active' && currentPeriodEnd ? Date.parse(`${currentPeriodEnd}T00:00:00.000Z`) : null;
  if (r.canWrite && ((status !== 'trial' && status !== 'active')
    || (status === 'trial' && planId !== 'essai')
    || (status === 'active' && planId === 'essai')
    || endTime === null || endTime <= serverTime)) {
    throw new Error('Statut et autorisation d’abonnement incohérents.');
  }
  return {
    id: requiredString(r.id), companyId, planId, planName: requiredString(r.planName),
    status: status as SubscriptionAccess['status'], startedAt, trialEndsAt, currentPeriodEnd,
    pendingPlanId: nullableString(r.pendingPlanId), canWrite: r.canWrite,
    reason: nullableString(r.reason), features,
    clientWriteDeadline: endTime === null ? null : receivedAt + (endTime - serverTime),
  };
}

/** Calcul non sécurisé réservé à la démonstration sur cet appareil. */
export function localSubscriptionAccess(state: AppState, plans: Plan[], now = Date.now()): SubscriptionAccess | null {
  const sub = state.subscription;
  if (!sub || !state.company || sub.companyId !== state.company.id) return null;
  const plan = plans.find((item) => item.id === sub.planId);
  const trialEnd = sub.trialEndsAt ? Date.parse(sub.trialEndsAt) : NaN;
  const trial = sub.status === 'essai' && sub.planId === 'essai';
  const active = sub.status === 'active' && sub.planId !== 'essai';
  const canWrite = !state.company.suspended && (active || (trial && Number.isFinite(trialEnd) && trialEnd > now));
  return {
    id: sub.id, companyId: sub.companyId, planId: sub.planId, planName: plan?.name ?? sub.planId,
    status: trial ? 'trial' : active ? 'active' : 'suspended',
    startedAt: sub.startedAt, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: null, pendingPlanId: sub.pendingPlanId,
    canWrite, reason: canWrite ? null : trial ? 'trial_expired' : 'suspended',
    features: { ...NO_ADVANCED, ...plan?.entitlements },
    clientWriteDeadline: trial && Number.isFinite(trialEnd) ? trialEnd : null,
  };
}

export function accessCanWrite(access: SubscriptionAccess | null, now = Date.now()): boolean {
  if (!access?.canWrite) return false;
  // Seules les anciennes données de démonstration peuvent représenter une
  // formule active sans échéance ; le mapping serveur exige une date payante.
  if (access.clientWriteDeadline === null) return access.status === 'active';
  return access.clientWriteDeadline > now;
}

export function permissionFeature(permission: string): PlanFeature | null {
  if (permission.startsWith('inventory.')) return 'stock';
  if (/^(crm|loyalty|packages|promotions|notifications)\./.test(permission)) return 'loyalty';
  if (permission.startsWith('fleets.')) return 'fleets';
  if (permission === 'analytics.view' || permission === 'analytics.compare') return 'consolidation';
  if (permission === 'audit.view') return 'audit';
  return null;
}

export function filterPlanPermissions(permissions: string[], access: SubscriptionAccess | null, isAdmin: boolean): string[] {
  if (isAdmin) return permissions;
  return permissions.filter((permission) => {
    const feature = permissionFeature(permission);
    return feature === null || access?.features[feature] === true;
  });
}
