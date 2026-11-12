import type {
  AppState, Client, CrmChannel, CrmRules, CrmStats, CustomerPackage,
  CustomerVehicle, Fleet, FleetContract, FleetReceivable, FleetVehicle,
  LoyaltyCard, LoyaltyProgram, LoyaltyTransaction, NotificationOutboxItem,
  PackagePlan, PackageUsage, Promotion, PromotionUsage,
} from '../types';

// ─── Prompt 08 : projection CRM serveur → domaine, aucune donnée fabriquée ───
// `my_crm_board()` renvoie un JSONB camelCase déjà filtré par RLS/station.
// Aucun identifiant de tenant, aucun fournisseur, aucun envoi simulé ici.

export const CRM_CHANNELS: CrmChannel[] = ['none', 'sms', 'email', 'whatsapp'];

export const CRM_RULES: CrmRules = {
  provider: 'Aucun fournisseur connecté : la file reste en attente, aucun envoi simulé.',
  promotion: 'Une promotion par fiche, jamais après encaissement, quota et validité vérifiés côté serveur.',
  package: 'Achat dans la fenêtre du forfait, consommation seulement avant expiration et une seule fois par fiche.',
  loyalty: 'Points calculés sur le montant avant remise, transaction immuable et idempotente.',
  tenant: 'Entreprise et station déduites du JWT : aucun identifiant de tenant côté navigateur.',
};

export interface CustomerProfilePayload {
  stationId: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  channel?: CrmChannel;
  loyaltyOptIn?: boolean;
  customerId?: string | null;
  fleetId?: string | null;
}

export interface CustomerVehiclePayload {
  stationId: string;
  customerId: string;
  plate: string;
  brand?: string;
  model?: string;
  color?: string;
  categoryId?: string | null;
  vehicleId?: string | null;
}

export interface LoyaltyProgramPayload {
  stationId: string;
  name: string;
  pointsPer1000Minor: number;
  redemptionThreshold: number;
  active?: boolean;
}

export interface LoyaltyEnrollmentPayload {
  stationId: string;
  customerId: string;
  programId: string;
  cardNumber?: string;
}

export interface LoyaltyTransactionPayload {
  cardId: string;
  kind: 'earn' | 'redeem';
  pointsDelta: number;
  reason?: string;
  washId?: string | null;
  idempotencyKey?: string | null;
}

export interface LoyaltyAccrualResult {
  points: number;
  duplicate: boolean;
  reason?: string | null;
  applied?: boolean;
}

export interface PackagePlanPayload {
  stationId: string;
  name: string;
  description?: string;
  priceMinor: number;
  washCount: number;
  validityDays: number;
  startsAt?: string;
  endsAt?: string | null;
  active?: boolean;
}

export interface PackageSalePayload {
  stationId: string;
  customerId: string;
  packageId: string;
  purchasedAt?: string;
  idempotencyKey?: string | null;
}

export interface PackageConsumptionResult {
  consumed: boolean;
  duplicate: boolean;
  remaining: number;
  reason?: string | null;
  customerPackageId?: string | null;
}

export interface PromotionPayload {
  stationId: string;
  name: string;
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  startsAt?: string;
  endsAt?: string;
  maxUsages?: number | null;
  minAmountMinor?: number;
  active?: boolean;
}

export interface PromotionApplicationPayload {
  washId: string;
  code: string;
  idempotencyKey?: string | null;
}

export interface PromotionApplicationResult {
  applied: boolean;
  duplicate: boolean;
  discountMinor: number;
  promotionId?: string | null;
}

export interface FleetPayload {
  stationId: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  creditLimitMinor?: number;
  channel?: CrmChannel;
  active?: boolean;
}

export interface FleetContractPayload {
  stationId: string;
  fleetId: string;
  number: string;
  startDate?: string;
  endDate?: string;
  discountPercent?: number;
  creditLimitMinor?: number;
  status?: string;
}

export interface AttachFleetVehiclePayload {
  stationId: string;
  fleetId: string;
  vehicleId: string;
  contractId?: string | null;
}

export interface FleetReceivablePayload {
  stationId: string;
  fleetId: string;
  contractId: string;
  amountMinor: number;
  washId?: string | null;
  dueDate?: string;
  idempotencyKey?: string | null;
}

export interface NotificationPayload {
  stationId: string;
  templateKey: string;
  customerId?: string | null;
  fleetId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface CrmSnapshot {
  clients: Client[];
  vehicles: CustomerVehicle[];
  loyaltyPrograms: LoyaltyProgram[];
  loyaltyCards: LoyaltyCard[];
  loyaltyTransactions: LoyaltyTransaction[];
  packagePlans: PackagePlan[];
  customerPackages: CustomerPackage[];
  packageUsages: PackageUsage[];
  promotions: Promotion[];
  promotionUsages: PromotionUsage[];
  fleets: Fleet[];
  fleetContracts: FleetContract[];
  fleetVehicles: FleetVehicle[];
  fleetReceivables: FleetReceivable[];
  notificationOutbox: NotificationOutboxItem[];
  stats: CrmStats;
  rules: CrmRules;
}

export const EMPTY_CRM_STATS: CrmStats = {
  clients: 0, vehicles: 0, activeCards: 0, activePackages: 0,
  activePromotions: 0, fleets: 0, openReceivablesMinor: 0,
  pendingNotifications: 0,
};

/** Collections P08 : TOUTES vides, aucun client/forfait/notification fabriqué. */
export function emptyCrmCollections(): Pick<AppState,
  'vehicles' | 'loyaltyPrograms' | 'loyaltyCards' | 'loyaltyTransactions' |
  'packagePlans' | 'customerPackages' | 'packageUsages' | 'promotions' |
  'promotionUsages' | 'fleets' | 'fleetContracts' | 'fleetVehicles' |
  'fleetReceivables' | 'notificationOutbox' | 'crmStats' | 'crmRules'
> {
  return {
    vehicles: [],
    loyaltyPrograms: [],
    loyaltyCards: [],
    loyaltyTransactions: [],
    packagePlans: [],
    customerPackages: [],
    packageUsages: [],
    promotions: [],
    promotionUsages: [],
    fleets: [],
    fleetContracts: [],
    fleetVehicles: [],
    fleetReceivables: [],
    notificationOutbox: [],
    crmStats: { ...EMPTY_CRM_STATS },
    crmRules: { ...CRM_RULES },
  };
}

/** Compatibilité ascendante : une ancienne fiche locale n'a pas les champs P08. */
export function withCrmDefaults(state: AppState): AppState {
  const defaults = emptyCrmCollections();
  const clients = (state.clients ?? []).map((c) => ({
    ...c,
    email: c.email ?? '',
    customerType: c.customerType ?? 'individual',
    preferredChannel: c.preferredChannel ?? 'none',
    loyaltyOptIn: c.loyaltyOptIn ?? false,
    fleetId: c.fleetId ?? null,
  }));
  return {
    ...state,
    clients,
    ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
      key, (state as unknown as Record<string, unknown>)[key] ?? value,
    ])),
  } as AppState;
}

/** Projection locale : les mêmes 15 collections et stats, sans RPC. */
export function crmBoardFromState(value: AppState): CrmSnapshot {
  const state = withCrmDefaults(value);
  const today = new Date().toISOString().slice(0, 10);
  const within = (start: string, end: string | null): boolean =>
    start <= today && (end === null || end === '' || today <= end);
  const stats: CrmStats = {
    clients: state.clients.length,
    vehicles: state.vehicles.length,
    activeCards: state.loyaltyCards.filter((c) => c.status === 'active').length,
    activePackages: state.customerPackages.filter((p) =>
      p.status === 'active' && p.expiresAt >= today).length,
    activePromotions: state.promotions.filter((p) =>
      p.active && within(p.startsAt, p.endsAt)).length,
    fleets: state.fleets.length,
    openReceivablesMinor: state.fleetReceivables
      .filter((r) => r.status === 'open')
      .reduce((sum, r) => sum + r.amountMinor, 0),
    pendingNotifications: state.notificationOutbox.filter((n) => n.status === 'pending').length,
  };
  return {
    clients: state.clients,
    vehicles: state.vehicles,
    loyaltyPrograms: state.loyaltyPrograms,
    loyaltyCards: state.loyaltyCards,
    loyaltyTransactions: state.loyaltyTransactions,
    packagePlans: state.packagePlans,
    customerPackages: state.customerPackages,
    packageUsages: state.packageUsages,
    promotions: state.promotions,
    promotionUsages: state.promotionUsages,
    fleets: state.fleets,
    fleetContracts: state.fleetContracts,
    fleetVehicles: state.fleetVehicles,
    fleetReceivables: state.fleetReceivables,
    notificationOutbox: state.notificationOutbox,
    stats,
    rules: { ...CRM_RULES },
  };
}

type Row = Record<string, unknown>;

function asRecord(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Ligne ${label} invalide reçue depuis my_crm_board().`);
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
  const v = text(value);
  return v || null;
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined || value === '' ? null : num(value);
}

function bool(value: unknown): boolean {
  return value === true;
}

function channel(value: unknown): CrmChannel {
  const v = text(value);
  return CRM_CHANNELS.includes(v as CrmChannel) ? v as CrmChannel : 'none';
}

function payload(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Conversion pure du JSONB `my_crm_board()` vers les types UI. */
export function mapCrmBoard(value: unknown): CrmSnapshot {
  const board = asRecord(value, 'my_crm_board');
  const stats = asRecord(board.stats ?? {}, 'stats');
  const rules = asRecord(board.rules ?? {}, 'rules');
  const clients: Client[] = arr(board.clients, 'clients').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), name: text(r.name),
    phone: text(r.phone), email: text(r.email), plate: text(r.plate),
    notes: text(r.notes), createdAt: text(r.createdAt),
    customerType: (text(r.customerType) || 'individual') as Client['customerType'],
    preferredChannel: channel(r.preferredChannel),
    loyaltyOptIn: bool(r.loyaltyOptIn), fleetId: nullableText(r.fleetId),
  }));
  const vehicles: CustomerVehicle[] = arr(board.vehicles, 'vehicles').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), customerId: nullableText(r.customerId),
    categoryId: nullableText(r.categoryId), plate: text(r.plate), brand: text(r.brand),
    model: text(r.model), color: text(r.color), fleetId: nullableText(r.fleetId),
    active: bool(r.active), createdAt: text(r.createdAt),
  }));
  const loyaltyPrograms: LoyaltyProgram[] = arr(board.loyaltyPrograms, 'loyaltyPrograms').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), name: text(r.name),
    pointsPer1000Minor: num(r.pointsPer1000Minor),
    redemptionThreshold: num(r.redemptionThreshold),
    active: bool(r.active), createdAt: text(r.createdAt),
  }));
  const loyaltyCards: LoyaltyCard[] = arr(board.loyaltyCards, 'loyaltyCards').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), customerId: text(r.customerId),
    programId: text(r.programId), cardNumber: text(r.cardNumber),
    pointsBalance: num(r.pointsBalance), status: text(r.status),
    createdAt: text(r.createdAt),
  }));
  const loyaltyTransactions: LoyaltyTransaction[] = arr(board.loyaltyTransactions, 'loyaltyTransactions').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), cardId: text(r.cardId),
    washId: nullableText(r.washId), kind: text(r.kind),
    pointsDelta: num(r.pointsDelta), reason: text(r.reason),
    createdAt: text(r.createdAt),
  }));
  const packagePlans: PackagePlan[] = arr(board.packagePlans, 'packagePlans').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), name: text(r.name),
    description: text(r.description), priceMinor: num(r.priceMinor),
    washCount: num(r.washCount), validityDays: num(r.validityDays),
    startsAt: text(r.startsAt), endsAt: nullableText(r.endsAt),
    active: bool(r.active), createdAt: text(r.createdAt),
  }));
  const customerPackages: CustomerPackage[] = arr(board.customerPackages, 'customerPackages').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), customerId: text(r.customerId),
    packageId: text(r.packageId), purchasedAt: text(r.purchasedAt),
    expiresAt: text(r.expiresAt), washesRemaining: num(r.washesRemaining),
    status: text(r.status), createdAt: text(r.createdAt),
  }));
  const packageUsages: PackageUsage[] = arr(board.packageUsages, 'packageUsages').map((r) => ({
    id: text(r.id), stationId: text(r.stationId),
    customerPackageId: text(r.customerPackageId), washId: text(r.washId),
    createdAt: text(r.createdAt),
  }));
  const promotions: Promotion[] = arr(board.promotions, 'promotions').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), name: text(r.name),
    code: text(r.code), kind: (text(r.kind) === 'amount' ? 'amount' : 'percent'),
    value: num(r.value), minAmountMinor: num(r.minAmountMinor),
    maxUsages: nullableNum(r.maxUsages), usageCount: num(r.usageCount),
    startsAt: text(r.startsAt), endsAt: text(r.endsAt),
    active: bool(r.active), createdAt: text(r.createdAt),
  }));
  const promotionUsages: PromotionUsage[] = arr(board.promotionUsages, 'promotionUsages').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), promotionId: text(r.promotionId),
    washId: text(r.washId), customerId: nullableText(r.customerId),
    discountMinor: num(r.discountMinor), createdAt: text(r.createdAt),
  }));
  const fleets: Fleet[] = arr(board.fleets, 'fleets').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), name: text(r.name),
    contactName: text(r.contactName), phone: text(r.phone), email: text(r.email),
    creditLimitMinor: num(r.creditLimitMinor), preferredChannel: channel(r.preferredChannel),
    active: bool(r.active), createdAt: text(r.createdAt),
  }));
  const fleetContracts: FleetContract[] = arr(board.fleetContracts, 'fleetContracts').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), fleetId: text(r.fleetId),
    number: text(r.number), startDate: text(r.startDate), endDate: text(r.endDate),
    discountPercent: num(r.discountPercent), creditLimitMinor: num(r.creditLimitMinor),
    status: text(r.status), createdAt: text(r.createdAt),
  }));
  const fleetVehicles: FleetVehicle[] = arr(board.fleetVehicles, 'fleetVehicles').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), fleetId: text(r.fleetId),
    vehicleId: text(r.vehicleId), contractId: nullableText(r.contractId),
    active: bool(r.active), createdAt: text(r.createdAt),
  }));
  const fleetReceivables: FleetReceivable[] = arr(board.fleetReceivables, 'fleetReceivables').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), fleetId: text(r.fleetId),
    contractId: text(r.contractId), washId: nullableText(r.washId),
    amountMinor: num(r.amountMinor), dueDate: text(r.dueDate),
    status: text(r.status), settledAt: nullableText(r.settledAt),
    createdAt: text(r.createdAt),
  }));
  const notificationOutbox: NotificationOutboxItem[] = arr(board.notificationOutbox, 'notificationOutbox').map((r) => ({
    id: text(r.id), stationId: text(r.stationId), customerId: nullableText(r.customerId),
    fleetId: nullableText(r.fleetId), channel: channel(r.channel),
    templateKey: text(r.templateKey), payload: payload(r.payload),
    status: text(r.status) === 'cancelled' ? 'cancelled' : 'pending',
    createdAt: text(r.createdAt), cancelledAt: nullableText(r.cancelledAt),
  }));
  return {
    clients, vehicles, loyaltyPrograms, loyaltyCards, loyaltyTransactions,
    packagePlans, customerPackages, packageUsages, promotions, promotionUsages,
    fleets, fleetContracts, fleetVehicles, fleetReceivables, notificationOutbox,
    stats: {
      clients: num(stats.clients), vehicles: num(stats.vehicles),
      activeCards: num(stats.activeCards), activePackages: num(stats.activePackages),
      activePromotions: num(stats.activePromotions), fleets: num(stats.fleets),
      openReceivablesMinor: num(stats.openReceivablesMinor),
      pendingNotifications: num(stats.pendingNotifications),
    },
    rules: {
      provider: text(rules.provider) || CRM_RULES.provider,
      promotion: text(rules.promotion) || CRM_RULES.promotion,
      package: text(rules.package) || CRM_RULES.package,
      loyalty: text(rules.loyalty) || CRM_RULES.loyalty,
      tenant: text(rules.tenant) || CRM_RULES.tenant,
    },
  };
}
