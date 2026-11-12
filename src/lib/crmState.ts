import type {
  AppState, Client, CustomerPackage, CustomerVehicle, Fleet, FleetContract,
  FleetReceivable, LoyaltyCard, LoyaltyProgram, LoyaltyTransaction,
  NotificationOutboxItem, PackagePlan, PackageUsage, Promotion, PromotionUsage,
  Wash,
} from '../types';
import { todayISO, uid } from './format';
import {
  CRM_RULES, crmBoardFromState, withCrmDefaults,
  type AttachFleetVehiclePayload, type CustomerProfilePayload,
  type CustomerVehiclePayload, type FleetContractPayload,
  type FleetPayload, type FleetReceivablePayload,
  type LoyaltyAccrualResult, type LoyaltyEnrollmentPayload,
  type LoyaltyProgramPayload, type LoyaltyTransactionPayload,
  type NotificationPayload, type PackageConsumptionResult,
  type PackagePlanPayload, type PackageSalePayload,
  type PromotionApplicationPayload, type PromotionApplicationResult,
  type PromotionPayload,
} from './crm';

// ─── Prompt 08 : transformateurs locaux, miroir honnête des RPC serveur ──────
// Aucune donnée préremplie. En mode Supabase, ce fichier n'est pas utilisé :
// seules les commandes `SECURITY DEFINER` écrivent, avec le tenant du JWT.

export interface CrmMutation<T> {
  state: AppState;
  value: T;
}

const now = (): string => new Date().toISOString();

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function finalize(state: AppState): AppState {
  const board = crmBoardFromState(state);
  return { ...state, crmStats: board.stats, crmRules: { ...CRM_RULES } };
}

function mutation<T>(state: AppState, value: T): CrmMutation<T> {
  return { state: finalize(state), value };
}

function updateWashes(state: AppState, washId: string, patch: Partial<Wash>): AppState {
  return { ...state, washes: state.washes.map((w) => w.id === washId ? { ...w, ...patch } : w) };
}

export function saveCustomerProfileLocal(state: AppState, p: CustomerProfilePayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const name = p.name.trim();
  ensure(name.length >= 2, 'Nom client trop court.');
  const channel = p.channel ?? 'none';
  ensure(['none', 'sms', 'email', 'whatsapp'].includes(channel), 'Canal de communication invalide.');
  const id = p.customerId ?? uid('cli');
  const existing = s.clients.find((c) => c.id === id);
  const client: Client = {
    id,
    stationId: p.stationId,
    name,
    phone: p.phone ?? existing?.phone ?? '',
    email: p.email ?? existing?.email ?? '',
    plate: existing?.plate ?? '',
    notes: p.notes ?? existing?.notes ?? '',
    customerType: p.fleetId ? 'fleet' : (existing?.customerType ?? 'individual'),
    preferredChannel: channel,
    loyaltyOptIn: p.loyaltyOptIn ?? existing?.loyaltyOptIn ?? false,
    fleetId: p.fleetId ?? existing?.fleetId ?? null,
    createdAt: existing?.createdAt ?? now(),
  };
  const clients = existing
    ? s.clients.map((c) => c.id === id ? client : c)
    : [...s.clients, client];
  return mutation({ ...s, clients }, id);
}

export function saveCustomerVehicleLocal(state: AppState, p: CustomerVehiclePayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const plate = p.plate.trim().toUpperCase();
  ensure(plate.length >= 2, 'Plaque invalide.');
  ensure(s.clients.some((c) => c.id === p.customerId), 'Client introuvable.');
  const id = p.vehicleId ?? uid('veh');
  const existing = s.vehicles.find((v) => v.id === id);
  const vehicle: CustomerVehicle = {
    id, stationId: p.stationId, customerId: p.customerId,
    categoryId: p.categoryId ?? existing?.categoryId ?? null,
    plate, brand: p.brand ?? existing?.brand ?? '',
    model: p.model ?? existing?.model ?? '', color: p.color ?? existing?.color ?? '',
    fleetId: existing?.fleetId ?? null, active: existing?.active ?? true,
    createdAt: existing?.createdAt ?? now(),
  };
  const vehicles = existing
    ? s.vehicles.map((v) => v.id === id ? vehicle : v)
    : [...s.vehicles, vehicle];
  const clients = s.clients.map((c) => c.id === p.customerId ? { ...c, plate } : c);
  return mutation({ ...s, vehicles, clients }, id);
}

export function createLoyaltyProgramLocal(state: AppState, p: LoyaltyProgramPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  ensure(p.name.trim().length >= 2, 'Nom du programme trop court.');
  ensure(p.pointsPer1000Minor > 0 && p.redemptionThreshold > 0, 'Barème de fidélité invalide.');
  const id = uid('prog');
  const program: LoyaltyProgram = {
    id, stationId: p.stationId, name: p.name.trim(),
    pointsPer1000Minor: Math.round(p.pointsPer1000Minor),
    redemptionThreshold: Math.round(p.redemptionThreshold),
    active: p.active ?? true, createdAt: now(),
  };
  return mutation({ ...s, loyaltyPrograms: [...s.loyaltyPrograms, program] }, id);
}

export function enrollLoyaltyCustomerLocal(state: AppState, p: LoyaltyEnrollmentPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  ensure(s.clients.some((c) => c.id === p.customerId), 'Client introuvable.');
  ensure(s.loyaltyPrograms.some((x) => x.id === p.programId && x.active), 'Programme inactif.');
  ensure(!s.loyaltyCards.some((c) => c.customerId === p.customerId && c.programId === p.programId && c.status === 'active'), 'Client déjà inscrit à ce programme.');
  const id = uid('card');
  const card: LoyaltyCard = {
    id, stationId: p.stationId, customerId: p.customerId, programId: p.programId,
    cardNumber: p.cardNumber?.trim() || `LC-${id.slice(-6).toUpperCase()}`,
    pointsBalance: 0, status: 'active', createdAt: now(),
  };
  return mutation({ ...s, loyaltyCards: [...s.loyaltyCards, card] }, id);
}

export function recordLoyaltyTransactionLocal(state: AppState, p: LoyaltyTransactionPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const key = p.idempotencyKey?.trim() || null;
  if (key) {
    const duplicate = s.loyaltyTransactions.find((t) => t.idempotencyKey === key);
    if (duplicate) return mutation(s, duplicate.id);
  }
  const card = s.loyaltyCards.find((c) => c.id === p.cardId);
  ensure(card, 'Carte de fidélité introuvable.');
  ensure(Number.isInteger(p.pointsDelta) && p.pointsDelta !== 0, 'Variation de points invalide.');
  const balance = (card as LoyaltyCard).pointsBalance + p.pointsDelta;
  ensure(balance >= 0, 'Solde de points insuffisant.');
  const id = uid('ltx');
  const tx: LoyaltyTransaction = {
    id, stationId: (card as LoyaltyCard).stationId, cardId: p.cardId,
    washId: p.washId ?? null, kind: p.kind,
    pointsDelta: Math.round(p.pointsDelta), reason: p.reason ?? '',
    createdAt: now(), idempotencyKey: key,
  };
  return mutation({
    ...s,
    loyaltyTransactions: [...s.loyaltyTransactions, tx],
    loyaltyCards: s.loyaltyCards.map((c) => c.id === p.cardId ? { ...c, pointsBalance: balance } : c),
  }, id);
}

export function accrueLoyaltyForWashLocal(state: AppState, washId: string, key?: string | null): CrmMutation<LoyaltyAccrualResult> {
  const s = withCrmDefaults(state);
  const idempotencyKey = key?.trim() || `loyalty:${washId}`;
  if (s.loyaltyTransactions.some((t) => t.idempotencyKey === idempotencyKey)) {
    return mutation(s, { points: 0, duplicate: true, applied: false });
  }
  const wash = s.washes.find((w) => w.id === washId);
  if (!wash) return mutation(s, { points: 0, duplicate: false, reason: 'no_wash', applied: false });
  const card = s.loyaltyCards.find((c) => c.customerId === wash.clientId && c.status === 'active');
  if (!card) return mutation(s, { points: 0, duplicate: false, reason: 'no_card', applied: false });
  const program = s.loyaltyPrograms.find((p) => p.id === card.programId && p.active);
  if (!program) return mutation(s, { points: 0, duplicate: false, reason: 'inactive_program', applied: false });
  const base = Math.max(0, wash.total + wash.discount);
  const points = Math.floor(base / 1000) * program.pointsPer1000Minor;
  if (points <= 0) return mutation(s, { points: 0, duplicate: false, reason: 'below_threshold', applied: false });
  const tx: LoyaltyTransaction = {
    id: uid('ltx'), stationId: wash.stationId, cardId: card.id,
    washId, kind: 'earn', pointsDelta: points,
    reason: 'Points gagnés sur lavage', createdAt: now(),
    idempotencyKey,
  };
  const next: AppState = {
    ...s,
    loyaltyTransactions: [...s.loyaltyTransactions, tx],
    loyaltyCards: s.loyaltyCards.map((c) => c.id === card.id ? { ...c, pointsBalance: c.pointsBalance + points } : c),
  };
  return mutation(updateWashes(next, washId, {
    loyaltyPointsEarned: (wash.loyaltyPointsEarned ?? 0) + points,
  }), { points, duplicate: false, applied: true });
}

export function savePackagePlanLocal(state: AppState, p: PackagePlanPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const startsAt = p.startsAt || todayISO();
  const endsAt = p.endsAt || null;
  ensure(p.name.trim().length >= 2, 'Nom du forfait trop court.');
  ensure(p.priceMinor >= 0 && p.washCount > 0 && p.validityDays > 0, 'Conditions du forfait invalides.');
  ensure(!endsAt || startsAt <= endsAt, 'Fenêtre de validité du forfait inversée.');
  const id = uid('pkg');
  const plan: PackagePlan = {
    id, stationId: p.stationId, name: p.name.trim(),
    description: p.description ?? '', priceMinor: Math.round(p.priceMinor),
    washCount: Math.round(p.washCount), validityDays: Math.round(p.validityDays),
    startsAt, endsAt, active: p.active ?? true, createdAt: now(),
  };
  return mutation({ ...s, packagePlans: [...s.packagePlans, plan] }, id);
}

export function sellPackageToCustomerLocal(state: AppState, p: PackageSalePayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const key = p.idempotencyKey?.trim() || null;
  if (key) {
    const duplicate = s.customerPackages.find((c) => c.idempotencyKey === key);
    if (duplicate) return mutation(s, duplicate.id);
  }
  const plan = s.packagePlans.find((x) => x.id === p.packageId && x.active);
  ensure(plan, 'Forfait inactif ou introuvable.');
  ensure(s.clients.some((c) => c.id === p.customerId), 'Client introuvable.');
  const purchasedAt = p.purchasedAt || todayISO();
  const activePlan = plan as PackagePlan;
  ensure(purchasedAt >= activePlan.startsAt && (!activePlan.endsAt || purchasedAt <= activePlan.endsAt), 'Achat hors fenêtre de validité du forfait.');
  const id = uid('cpkg');
  const sold: CustomerPackage = {
    id, stationId: p.stationId, customerId: p.customerId, packageId: activePlan.id,
    purchasedAt, expiresAt: addDays(purchasedAt, activePlan.validityDays),
    washesRemaining: activePlan.washCount, status: 'active',
    createdAt: now(), idempotencyKey: key,
  };
  return mutation({ ...s, customerPackages: [...s.customerPackages, sold] }, id);
}

export function consumePackageForWashLocal(state: AppState, washId: string): CrmMutation<PackageConsumptionResult> {
  const s = withCrmDefaults(state);
  const wash = s.washes.find((w) => w.id === washId);
  if (!wash) return mutation(s, { consumed: false, duplicate: false, remaining: 0, reason: 'no_wash' });
  if (wash.packageId || s.packageUsages.some((u) => u.washId === washId)) {
    return mutation(s, { consumed: false, duplicate: true, remaining: 0, customerPackageId: wash.packageId ?? null });
  }
  const today = todayISO();
  const owned = s.customerPackages.find((cp) => cp.customerId === wash.clientId
    && cp.status === 'active' && cp.washesRemaining > 0 && cp.expiresAt >= today
    && s.packagePlans.some((p) => p.id === cp.packageId && p.active
      && p.startsAt <= today && (!p.endsAt || today <= p.endsAt)));
  if (!owned) {
    return mutation(s, { consumed: false, duplicate: false, remaining: 0, reason: 'no_active_package' });
  }
  const remaining = owned.washesRemaining - 1;
  const usage: PackageUsage = {
    id: uid('puse'), stationId: wash.stationId, customerPackageId: owned.id,
    washId, createdAt: now(),
  };
  const next: AppState = {
    ...s,
    customerPackages: s.customerPackages.map((cp) => cp.id === owned.id ? {
      ...cp, washesRemaining: remaining, status: remaining === 0 ? 'exhausted' : 'active',
    } : cp),
    packageUsages: [...s.packageUsages, usage],
  };
  return mutation(updateWashes(next, washId, { packageId: owned.id }), {
    consumed: true, duplicate: false, remaining, customerPackageId: owned.id,
  });
}

export function savePromotionLocal(state: AppState, p: PromotionPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const startsAt = p.startsAt || todayISO();
  const endsAt = p.endsAt || addDays(startsAt, 30);
  const code = p.code.trim().toUpperCase();
  ensure(p.name.trim().length >= 2 && code.length >= 2, 'Promotion incomplète.');
  ensure(p.value > 0 && startsAt <= endsAt, 'Conditions de promotion invalides.');
  ensure(p.kind === 'percent' ? p.value <= 100 : p.value > 0, 'Valeur de promotion invalide.');
  ensure(p.maxUsages === null || p.maxUsages === undefined || p.maxUsages > 0, 'Quota de promotion invalide.');
  const id = uid('promo');
  const promotion: Promotion = {
    id, stationId: p.stationId, name: p.name.trim(), code,
    kind: p.kind, value: Math.round(p.value),
    minAmountMinor: Math.max(0, Math.round(p.minAmountMinor ?? 0)),
    maxUsages: p.maxUsages ?? null, usageCount: 0,
    startsAt, endsAt, active: p.active ?? true, createdAt: now(),
  };
  return mutation({ ...s, promotions: [...s.promotions, promotion] }, id);
}

export function applyPromotionToWashLocal(state: AppState, p: PromotionApplicationPayload): CrmMutation<PromotionApplicationResult> {
  const s = withCrmDefaults(state);
  const code = p.code.trim().toUpperCase();
  const promo = s.promotions.find((x) => x.code.toUpperCase() === code && x.active);
  const wash = s.washes.find((w) => w.id === p.washId);
  const key = p.idempotencyKey?.trim()
    || (promo ? `promo:${p.washId}:${promo.id}` : `promo:${p.washId}:${code}`);
  if (key) {
    const duplicate = s.promotionUsages.find((u) => u.idempotencyKey === key);
    if (duplicate) {
      return mutation(s, {
        applied: false, duplicate: true, discountMinor: duplicate.discountMinor,
        promotionId: duplicate.promotionId,
      });
    }
  }
  ensure(wash, 'Fiche introuvable.');
  const current = wash as Wash;
  ensure(current.status !== 'cancelled', 'Fiche annulée.');
  ensure((current.payments ?? []).length === 0, 'Promotion impossible après encaissement.');
  ensure(promo, 'Promotion inactive ou hors validité.');
  const activePromo = promo as Promotion;
  const today = todayISO();
  ensure(activePromo.startsAt <= today && today <= activePromo.endsAt, 'Promotion hors validité.');
  ensure(activePromo.maxUsages === null || activePromo.usageCount < activePromo.maxUsages, 'Quota de promotion atteint.');
  ensure(!current.promotionId && !s.promotionUsages.some((u) => u.washId === p.washId), 'Une seule promotion par fiche.');
  const base = Math.max(0, current.total + current.discount);
  ensure(base >= activePromo.minAmountMinor, 'Montant minimum non atteint.');
  const discount = Math.min(base, activePromo.kind === 'percent'
    ? Math.round(base * activePromo.value / 100) : activePromo.value);
  ensure(discount > 0, 'Remise nulle interdite.');
  const usage: PromotionUsage = {
    id: uid('puse'), stationId: current.stationId, promotionId: activePromo.id,
    washId: p.washId, customerId: current.clientId,
    discountMinor: discount, createdAt: now(), idempotencyKey: key,
  };
  const next: AppState = {
    ...s,
    promotions: s.promotions.map((x) => x.id === activePromo.id ? { ...x, usageCount: x.usageCount + 1 } : x),
    promotionUsages: [...s.promotionUsages, usage],
  };
  return mutation(updateWashes(next, p.washId, {
    discount: current.discount + discount,
    total: Math.max(0, base - current.discount - discount),
    promotionId: activePromo.id,
    promotionDiscountMinor: discount,
  }), { applied: true, duplicate: false, discountMinor: discount, promotionId: activePromo.id });
}

export function saveFleetLocal(state: AppState, p: FleetPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  ensure(p.name.trim().length >= 2, 'Nom de flotte trop court.');
  const channel = p.channel ?? 'none';
  ensure(['none', 'sms', 'email', 'whatsapp'].includes(channel), 'Canal de communication invalide.');
  const id = uid('fleet');
  const fleet: Fleet = {
    id, stationId: p.stationId, name: p.name.trim(),
    contactName: p.contactName ?? '', phone: p.phone ?? '', email: p.email ?? '',
    creditLimitMinor: Math.max(0, Math.round(p.creditLimitMinor ?? 0)),
    preferredChannel: channel, active: p.active ?? true, createdAt: now(),
  };
  return mutation({ ...s, fleets: [...s.fleets, fleet] }, id);
}

export function saveFleetContractLocal(state: AppState, p: FleetContractPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const number = p.number.trim().toUpperCase();
  const startDate = p.startDate || todayISO();
  const endDate = p.endDate || addDays(startDate, 365);
  ensure(number.length >= 2 && startDate <= endDate, 'Contrat de flotte invalide.');
  const conflict = s.fleetContracts.find((c) => c.number.toUpperCase() === number && c.fleetId !== p.fleetId);
  ensure(!conflict, 'Numéro de contrat déjà utilisé par une autre flotte.');
  ensure(s.fleets.some((f) => f.id === p.fleetId), 'Flotte introuvable.');
  const id = uid('fct');
  const contract: FleetContract = {
    id, stationId: p.stationId, fleetId: p.fleetId, number,
    startDate, endDate, discountPercent: Math.max(0, Math.round(p.discountPercent ?? 0)),
    creditLimitMinor: Math.max(0, Math.round(p.creditLimitMinor ?? 0)),
    status: p.status ?? 'active', createdAt: now(),
  };
  return mutation({ ...s, fleetContracts: [...s.fleetContracts, contract] }, id);
}

export function attachFleetVehicleLocal(state: AppState, p: AttachFleetVehiclePayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  ensure(s.fleets.some((f) => f.id === p.fleetId), 'Flotte introuvable.');
  ensure(s.vehicles.some((v) => v.id === p.vehicleId), 'Véhicule introuvable.');
  const id = uid('fveh');
  const link = {
    id, stationId: p.stationId, fleetId: p.fleetId, vehicleId: p.vehicleId,
    contractId: p.contractId ?? null, active: true, createdAt: now(),
  };
  return mutation({ ...s, fleetVehicles: [...s.fleetVehicles, link] }, id);
}

export function recordFleetReceivableLocal(state: AppState, p: FleetReceivablePayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const key = p.idempotencyKey?.trim() || null;
  if (key) {
    const duplicate = s.fleetReceivables.find((r) => r.idempotencyKey === key);
    if (duplicate) return mutation(s, duplicate.id);
  }
  ensure(p.amountMinor > 0, 'Créance invalide.');
  const today = todayISO();
  const contract = s.fleetContracts.find((c) => c.id === p.contractId
    && c.fleetId === p.fleetId && c.status === 'active'
    && c.startDate <= today && today <= c.endDate);
  ensure(contract, 'Contrat de flotte inactif ou hors validité.');
  const open = s.fleetReceivables
    .filter((r) => r.fleetId === p.fleetId && r.contractId === p.contractId && r.status === 'open')
    .reduce((sum, r) => sum + r.amountMinor, 0);
  ensure(open + p.amountMinor <= (contract as FleetContract).creditLimitMinor, 'Limite de crédit flotte dépassée.');
  const id = uid('recv');
  const receivable: FleetReceivable = {
    id, stationId: p.stationId, fleetId: p.fleetId, contractId: p.contractId,
    washId: p.washId ?? null, amountMinor: Math.round(p.amountMinor),
    dueDate: p.dueDate || today, status: 'open', settledAt: null,
    createdAt: now(), idempotencyKey: key,
  };
  return mutation({ ...s, fleetReceivables: [...s.fleetReceivables, receivable] }, id);
}

export function enqueueNotificationLocal(state: AppState, p: NotificationPayload): CrmMutation<string> {
  const s = withCrmDefaults(state);
  const key = p.idempotencyKey?.trim() || null;
  if (key) {
    const duplicate = s.notificationOutbox.find((n) => n.idempotencyKey === key);
    if (duplicate) return mutation(s, duplicate.id);
  }
  ensure(p.templateKey.trim().length >= 2, 'Modèle de notification invalide.');
  ensure(Boolean(p.customerId) !== Boolean(p.fleetId), 'Une seule cible de notification autorisée.');
  const customer = p.customerId ? s.clients.find((c) => c.id === p.customerId) : null;
  const fleet = p.fleetId ? s.fleets.find((f) => f.id === p.fleetId) : null;
  const channel = customer?.preferredChannel ?? fleet?.preferredChannel ?? 'none';
  ensure(channel !== 'none', 'Aucun canal de communication choisi : notification non mise en attente.');
  const id = uid('notif');
  const item: NotificationOutboxItem = {
    id, stationId: p.stationId, customerId: p.customerId ?? null,
    fleetId: p.fleetId ?? null, channel, templateKey: p.templateKey.trim(),
    payload: p.payload ?? {}, status: 'pending', createdAt: now(),
    cancelledAt: null, idempotencyKey: key,
  };
  return mutation({ ...s, notificationOutbox: [...s.notificationOutbox, item] }, id);
}

export function cancelPendingNotificationLocal(state: AppState, id: string): CrmMutation<void> {
  const s = withCrmDefaults(state);
  const item = s.notificationOutbox.find((n) => n.id === id && n.status === 'pending');
  ensure(item, 'Notification en attente introuvable.');
  return mutation({
    ...s,
    notificationOutbox: s.notificationOutbox.map((n) => n.id === id
      ? { ...n, status: 'cancelled' as const, cancelledAt: now() } : n),
  }, undefined);
}
