// ─── WashGuard — types métier ────────────────────────────────────────────────
// Ces types reflètent les futures tables Supabase (companies, stations,
// users, services, vehicle_categories, clients, washes, wash_items,
// payments, cash_sessions, expenses, plans, subscriptions, audit_logs).
// Le frontend seul ne crée aucune donnée métier : tout part vide et
// l'onboarding constate les données réellement enregistrées.

// `support` est conservé pour la démonstration locale ; `super_admin` est le
// rôle réel du back-office SaaS, `laveur` complète les rôles d'exploitation.
export type Role = 'proprietaire' | 'gerant' | 'caissier' | 'laveur' | 'support' | 'super_admin';

// Prompt 05 : les 7 statuts serveur. « ready » (terminé, prêt) n'est PAS
// « delivered » (restitué au client). Les anciennes valeurs FR sont converties
// à la lecture par `normalizeWashes()` et ne sont plus écrites.
export type WashStatus =
  | 'pending' | 'assigned' | 'in_progress' | 'quality_check'
  | 'ready' | 'delivered' | 'cancelled';

export const WASH_STATUS_LABELS: Record<WashStatus, string> = {
  pending: 'En attente',
  assigned: 'Affecté',
  in_progress: 'En cours',
  quality_check: 'Contrôle qualité',
  ready: 'Prêt / terminé',
  delivered: 'Livré',
  cancelled: 'Annulé',
};

/** Table de correspondance des 4 statuts locaux historiques → 7 statuts EN. */
export const LEGACY_WASH_STATUS: Record<string, WashStatus> = {
  en_attente: 'pending',
  en_cours: 'in_progress',
  termine: 'ready', // surtout PAS delivered : la restitution reste à faire
  annule: 'cancelled',
};

/** Transitions MANUELLES de l'UI, miroir de la garde serveur (migrations 021/023). */
export const WASH_STATUS_FLOW: Record<WashStatus, WashStatus[]> = {
  pending: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['quality_check', 'cancelled'],
  // « ready » est INTERDIT ici : seul recordQualityCheck() (ou la RPC
  // serveur record_wash_quality_check) peut approuver et passer à ready.
  // C'est l'unique exception à canTransitionWash(), des deux côtés.
  quality_check: ['in_progress', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export type PayMethod =
  | 'especes'
  | 'wave'
  | 'orange_money'
  | 'mtn_momo'
  | 'mobile_money'
  | 'carte'
  | 'virement';

export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  especes: 'Espèces',
  wave: 'Wave CI',
  orange_money: 'Orange Money',
  mtn_momo: 'MTN MoMo',
  mobile_money: 'Mobile Money',
  carte: 'Carte bancaire',
  virement: 'Virement bancaire',
};

/** Clé serveur `payment_methods.key` ↔ moyen de paiement de l'interface. */
export const PAY_METHOD_DB_KEY: Record<PayMethod, string> = {
  especes: 'cash',
  wave: 'wave',
  orange_money: 'orange_money',
  mtn_momo: 'mtn_momo',
  mobile_money: 'mobile_money',
  carte: 'card',
  virement: 'transfer',
};

/** Clé serveur `payment_methods.key` → moyen de paiement de l'interface. */
export const PAY_METHOD_FROM_DB_KEY: Record<string, PayMethod> = {
  cash: 'especes',
  wave: 'wave',
  orange_money: 'orange_money',
  mtn_momo: 'mtn_momo',
  mobile_money: 'mobile_money',
  card: 'carte',
  transfer: 'virement',
  other: 'mobile_money',
  // Les boards serveurs exposent déjà les clés UI (`payment_method_ui_key`).
  especes: 'especes',
  carte: 'carte',
  virement: 'virement',
};

/** Normalise une clé DB (`cash`) ou UI (`especes`) vers le domaine frontend. */
export function payMethodFrom(value: unknown): PayMethod {
  const key = typeof value === 'string' ? value.trim() : '';
  return PAY_METHOD_FROM_DB_KEY[key] ?? 'mobile_money';
}

export type WashQualityResult = 'approved' | 'rejected';

export interface WashStatusEvent {
  id: string;
  fromStatus: WashStatus | null;
  toStatus: WashStatus;
  reason: string | null;
  at: string;
  actorUserId: string | null;
}

export interface WashPost {
  id: string;
  /** Station serveur : l'UI ne propose jamais un poste d'une autre station. */
  stationId: string;
  name: string;
  capacity: number;
  active: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  proprietaire: 'Propriétaire',
  gerant: 'Gérant',
  caissier: 'Caissier',
  laveur: 'Laveur',
  support: 'Support WashGuard',
  super_admin: 'Super admin SaaS',
};

export interface Company {
  id: string;
  name: string;
  city: string;
  phone: string;
  createdAt: string;
  suspended: boolean;
}

export interface DayHours {
  day: string; // 'Lundi' …
  open: string; // '08:00'
  close: string; // '18:00'
  closed: boolean;
}

export interface Station {
  id: string;
  companyId: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  currency: 'FCFA';
  /** Chemin de l’objet dans le bucket privé, jamais une URL signée. */
  logoPath: string | null;
  hours: DayHours[];
  paymentMethods: PayMethod[];
  cashRequiresOpen: boolean; // espèces exigent une caisse ouverte
  maxCashierDiscount: number; // remise max du caissier (FCFA)
  commissionRate: number; // barème par défaut (%) pour les laveurs
  monthlyTarget: number; // objectif de CA du mois (FCFA)
  activated: boolean;
  activatedAt: string | null;
}

export interface AppUser {
  id: string;
  companyId: string | null;
  stationId: string | null;
  name: string;
  email: string;
  phone: string;
  role: Role;
  active: boolean;
  commissionRateOverride: number | null; // exception posée sur le compte
  createdAt: string;
  /** Affectations multi-stations (Prompt 04), vide en mode local. */
  stationIds?: string[];
}

export interface VehicleCategory {
  id: string;
  stationId: string;
  name: string;
  active: boolean;
}

export interface Service {
  id: string;
  stationId: string;
  name: string;
  description: string;
  active: boolean;
  // Grille tarifaire : prix par catégorie de véhicule.
  prices: Record<string, number>;
}

export interface Client {
  id: string;
  stationId: string;
  name: string;
  phone: string;
  plate: string;
  notes: string;
  createdAt: string;
  /** P08 : champs additifs, absents des anciennes fiches locales. */
  email?: string;
  customerType?: 'individual' | 'fleet';
  preferredChannel?: 'none' | 'sms' | 'email' | 'whatsapp';
  loyaltyOptIn?: boolean;
  fleetId?: string | null;
}

export type CrmChannel = 'none' | 'sms' | 'email' | 'whatsapp';

export interface CustomerVehicle {
  id: string;
  stationId: string;
  customerId: string | null;
  categoryId: string | null;
  plate: string;
  brand: string;
  model: string;
  color: string;
  fleetId: string | null;
  active: boolean;
  createdAt: string;
}

export interface LoyaltyProgram {
  id: string;
  stationId: string;
  name: string;
  pointsPer1000Minor: number;
  redemptionThreshold: number;
  active: boolean;
  createdAt: string;
}

export interface LoyaltyCard {
  id: string;
  stationId: string;
  customerId: string;
  programId: string;
  cardNumber: string;
  pointsBalance: number;
  status: string;
  createdAt: string;
}

export interface LoyaltyTransaction {
  id: string;
  stationId: string;
  cardId: string;
  washId: string | null;
  kind: string;
  pointsDelta: number;
  reason: string;
  createdAt: string;
  /** Clé locale uniquement : le board serveur ne l'expose pas. */
  idempotencyKey?: string | null;
}

export interface PackagePlan {
  id: string;
  stationId: string;
  name: string;
  description: string;
  priceMinor: number;
  washCount: number;
  validityDays: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface CustomerPackage {
  id: string;
  stationId: string;
  customerId: string;
  packageId: string;
  purchasedAt: string;
  expiresAt: string;
  washesRemaining: number;
  status: string;
  createdAt: string;
  idempotencyKey?: string | null;
}

export interface PackageUsage {
  id: string;
  stationId: string;
  customerPackageId: string;
  washId: string;
  createdAt: string;
}

export interface Promotion {
  id: string;
  stationId: string;
  name: string;
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  minAmountMinor: number;
  maxUsages: number | null;
  usageCount: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
}

export interface PromotionUsage {
  id: string;
  stationId: string;
  promotionId: string;
  washId: string;
  customerId: string | null;
  discountMinor: number;
  createdAt: string;
  idempotencyKey?: string | null;
}

export interface Fleet {
  id: string;
  stationId: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  creditLimitMinor: number;
  preferredChannel: CrmChannel;
  active: boolean;
  createdAt: string;
}

export interface FleetContract {
  id: string;
  stationId: string;
  fleetId: string;
  number: string;
  startDate: string;
  endDate: string;
  discountPercent: number;
  creditLimitMinor: number;
  status: string;
  createdAt: string;
}

export interface FleetVehicle {
  id: string;
  stationId: string;
  fleetId: string;
  vehicleId: string;
  contractId: string | null;
  active: boolean;
  createdAt: string;
}

export interface FleetReceivable {
  id: string;
  stationId: string;
  fleetId: string;
  contractId: string;
  washId: string | null;
  amountMinor: number;
  dueDate: string;
  status: string;
  settledAt: string | null;
  createdAt: string;
  idempotencyKey?: string | null;
}

export interface NotificationOutboxItem {
  id: string;
  stationId: string;
  customerId: string | null;
  fleetId: string | null;
  channel: CrmChannel;
  templateKey: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'cancelled';
  createdAt: string;
  cancelledAt: string | null;
  idempotencyKey?: string | null;
}

export interface CrmStats {
  clients: number;
  vehicles: number;
  activeCards: number;
  activePackages: number;
  activePromotions: number;
  fleets: number;
  openReceivablesMinor: number;
  pendingNotifications: number;
}

export interface CrmRules {
  provider: string;
  promotion: string;
  package: string;
  loyalty: string;
  tenant: string;
}

export interface WashItem {
  serviceId: string;
  serviceName: string;
  unitPrice: number; // prix figé au moment du lavage
  qty: number;
}

export interface Payment {
  id: string;
  amount: number;
  method: PayMethod;
  at: string;
  byUserId: string;
  /** Clé d'idempotence UI : un double clic ne crée jamais deux encaissements. */
  idempotencyKey?: string | null;
  /** Remboursement : la ligne reste, elle est seulement marquée annulée. */
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

export interface Wash {
  id: string;
  stationId: string;
  number: string;
  clientId: string | null;
  clientName: string | null;
  vehicleCategoryId: string;
  vehicleLabel: string;
  plate: string;
  /** Premier employé affecté (compatibilité commissions/rapports §3.1). */
  employeeId: string;
  /** Affectations multiples sur un ou plusieurs postes (Prompt 05). */
  assignedUserIds: string[];
  postId: string | null;
  items: WashItem[];
  discount: number;
  total: number;
  paid: number;
  status: WashStatus;
  createdAt: string;
  finishedAt: string | null;
  deliveredAt: string | null;
  cancelledReason: string | null;
  payments: Payment[];
  /** Historique horodaté, dont l'événement initial créé à l'import. */
  history: WashStatusEvent[];
  qualityResult: WashQualityResult | null;
  qualityNotes: string | null;
  /** P08 : champs enrichis par les RPC, absents des anciennes fiches. */
  promotionId?: string | null;
  promotionDiscountMinor?: number;
  packageId?: string | null;
  fleetContractId?: string | null;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
}

export interface CashSession {
  id: string;
  stationId: string;
  openedBy: string;
  openedAt: string;
  openingFloat: number;
  closedAt: string | null;
  countedAmount: number | null;
  closedBy: string | null;
  status: 'ouverte' | 'cloturee';
  reopenReason: string | null;
  reopenedAt: string | null;
}

// ─── Prompt 06 : finance, mouvements, rapprochements, rentabilité ─────────────
/** Méthode serveur `payment_methods` : un canal de rapprochement distinct. */
export interface PaymentMethod {
  id: string;
  stationId: string;
  key: string;
  label: string;
  uiMethod: PayMethod;
  affectsCash: boolean;
  active: boolean;
}

export type CashMovementKind =
  | 'opening' | 'payment_in' | 'expense_out' | 'closing' | 'reopen' | 'adjustment';

/** Un comptage devient un mouvement `closing` immuable, pas une colonne réécrite. */
export interface CashMovement {
  id: string;
  stationId: string;
  cashSessionId: string;
  kind: CashMovementKind;
  amount: number;
  uiMethod: PayMethod | null;
  paymentId: string | null;
  expenseId: string | null;
  reference: string;
  idempotencyKey: string | null;
  createdAt: string;
}

/** Relevé de clôture figé : théorique, compté, écart, horodatage. */
export interface CashClosure {
  id: string;
  stationId: string;
  cashSessionId: string;
  counted: number;
  theoretical: number;
  difference: number;
  closedBy: string;
  createdAt: string;
}

/** Espèces et Mobile Money ne sont JAMAIS rapprochés ensemble. */
export interface ChannelReconciliation {
  id: string;
  stationId: string;
  methodId: string;
  uiMethod: PayMethod;
  start: string;
  end: string;
  expected: number;
  counted: number;
  difference: number;
  frozen: boolean;
  validatedAt: string | null;
}

export type CommissionPeriodStatus = 'draft' | 'validated' | 'paid';

export interface CommissionPeriod {
  id: string;
  stationId: string;
  start: string;
  end: string;
  status: CommissionPeriodStatus;
  validatedAt: string | null;
}

/** Relevé figé après validation : plus jamais recalculé. */
export interface CommissionStatementLine {
  id: string;
  periodId: string;
  userId: string;
  userName: string;
  washes: number;
  base: number;
  rate: number;
  rateOrigin: string;
  amount: number;
  createdAt: string;
}

export interface CommissionPayout {
  id: string;
  periodId: string;
  userId: string;
  amount: number;
  reference: string;
  paidAt: string;
}

export interface PaymentCancellation {
  id: string;
  paymentId: string;
  amount: number;
  reason: string;
  at: string;
}

/**
 * Rapport honnête : `partialBalance` est un SOLDE PARTIEL, jamais un bénéfice
 * net. `grossMargin`/`result` restent NULL tant que les coûts P07 manquent.
 */
export interface ProfitabilityReport {
  periodStart: string;
  periodEnd: string;
  revenue: number;
  collected: number;
  receivables: number;
  expenses: number;
  /** NULL lorsque le module stock ou ses données ne sont pas disponibles. */
  purchases: number | null;
  consumptions: number | null;
  commissions: number;
  fixedCosts: number | null;
  partialBalance: number;
  grossMargin: number | null;
  result: number | null;
  costsMissing: boolean;
  label: string;
  missing: string[];
  definitions: Record<string, string>;
  /** NULL si le calcul hors achats de stock n'est pas disponible. */
  operatingExpenses?: number | null;
  certified?: boolean;
  certifiedAt?: string | null;
  attestation?: string | null;
}

export interface Expense {
  id: string;
  stationId: string;
  amount: number;
  category: string;
  reason: string;
  supplier: string;
  date: string; // 'aaaa-mm-jj'
  method: PayMethod;
  cashSessionId: string | null;
  status: 'enregistree' | 'annulee';
  cancelReason: string | null;
  createdBy: string;
  createdAt: string;
  idempotencyKey?: string | null;
  /** P07 : rattachement explicite d'un achat de stock déjà compté en réception. */
  purchaseOrderId?: string | null;
}

// ─── Prompt 07 : stock, fournisseurs, achats, inventaires, consommations ─────
export interface ProductCategory {
  id: string;
  stationId: string;
  name: string;
  active: boolean;
}

export interface Supplier {
  id: string;
  stationId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  active: boolean;
}

export interface Product {
  id: string;
  stationId: string;
  categoryId: string | null;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  averageCostMinor: number;
  active: boolean;
}

export type PurchaseOrderStatus =
  | 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrder {
  id: string;
  stationId: string;
  supplierId: string | null;
  number: string;
  status: PurchaseOrderStatus;
  orderedAt: string;
  expectedAt: string | null;
  note: string;
}

export interface PurchaseOrderItem {
  id: string;
  stationId: string;
  orderId: string;
  productId: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCostMinor: number;
}

export type StockMovementKind =
  | 'purchase_receipt' | 'consumption' | 'inventory_adjustment' | 'return' | 'loss';

export interface StockMovement {
  id: string;
  stationId: string;
  productId: string;
  kind: StockMovementKind;
  qtyDelta: number;
  unitCostMinor: number;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string | null;
  note: string;
  createdAt: string;
}

export interface StockLevel {
  productId: string;
  stationId: string;
  name: string;
  unit: string;
  reorderLevel: number;
  qtyOnHand: number;
  averageCostMinor: number;
  valueMinor: number;
}

export interface InventorySession {
  id: string;
  stationId: string;
  status: 'open' | 'closed';
  startedAt: string;
  closedAt: string | null;
}

export interface InventoryItem {
  id: string;
  stationId: string;
  sessionId: string;
  productId: string;
  expectedQty: number;
  countedQty: number;
  difference: number;
  reason: string;
}

export interface StockService {
  id: string;
  stationId: string;
  name: string;
  active: boolean;
}

export interface ServiceProductConsumption {
  id: string;
  stationId: string;
  serviceId: string;
  productId: string;
  qtyPerWash: number;
  active: boolean;
}

export interface StockReceiptEvent {
  id: string;
  stationId: string;
  orderId: string;
  receiptKey: string;
  lines: unknown[];
  createdAt: string;
}

export interface StockConsumptionRun {
  id: string;
  stationId: string;
  washId: string;
  movementCount: number;
  valuedMinor: number;
  createdAt: string;
}

export interface CostCertification {
  id: string;
  start: string;
  end: string;
  revenueMinor: number;
  consumptionCostMinor: number;
  operatingExpenseMinor: number;
  commissionCostMinor: number;
  grossMarginMinor: number;
  resultMinor: number;
  attestation: string;
  certifiedAt: string;
}

export interface StockAlert {
  productId: string;
  stationId: string;
  name: string;
  qtyOnHand: number;
  reorderLevel: number;
  severity: 'rupture' | 'seuil';
}

export interface StockValuation {
  stockValueMinor: number;
  productsValued: number;
  consumptionCostMinor: number;
  purchaseCostMinor: number;
  openOrders: number;
  lowStockAlerts: number;
}

export type PlanFeature = 'stock' | 'loyalty' | 'fleets' | 'consolidation' | 'audit';
export type PlanFeatures = Record<PlanFeature, boolean>;

export interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  trial: boolean;
  limits: { stations: number; employees: number; washesPerMonth: number };
  /** Descriptions commerciales, distinctes des droits techniques ci-dessous. */
  features: string[];
  entitlements?: PlanFeatures;
}

export interface Subscription {
  id: string;
  companyId: string;
  planId: string;
  status: 'essai' | 'active' | 'en_attente' | 'suspendue';
  startedAt: string;
  trialEndsAt: string | null;
  pendingPlanId: string | null;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface PlatformCompany {
  id: string;
  name: string;
  city: string;
  phone: string;
  planName: string;
  /** P09 : identifiant et compteurs de quota fournis par le board plateforme. */
  planId?: string | null;
  status: 'active' | 'essai' | 'suspendue';
  stations: number;
  employeeCount?: number;
  washesMonth?: number;
  monthlyRevenue: number;
  createdAt: string;
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null;
  stationId: string | null;
}

export interface AppState {
  company: Company | null;
  station: Station | null;
  users: AppUser[];
  vehicleCategories: VehicleCategory[];
  services: Service[];
  clients: Client[];
  washes: Wash[];
  washPosts: WashPost[];
  cashSessions: CashSession[];
  /** P06 : le comptage est un mouvement `closing` + un relevé immuable. */
  cashMovements: CashMovement[];
  cashClosures: CashClosure[];
  expenses: Expense[];
  paymentMethods: PaymentMethod[];
  reconciliations: ChannelReconciliation[];
  commissionPeriods: CommissionPeriod[];
  commissionLines: CommissionStatementLine[];
  commissionPayouts: CommissionPayout[];
  paymentCancellations: PaymentCancellation[];
  profitability: ProfitabilityReport | null;
  /** P07 : collections serveur/locales, toutes vides au démarrage. */
  productCategories: ProductCategory[];
  suppliers: Supplier[];
  products: Product[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderItems: PurchaseOrderItem[];
  stockLevels: StockLevel[];
  stockMovements: StockMovement[];
  inventorySessions: InventorySession[];
  inventoryItems: InventoryItem[];
  stockServices: StockService[];
  serviceConsumptions: ServiceProductConsumption[];
  receiptEvents: StockReceiptEvent[];
  consumptionRuns: StockConsumptionRun[];
  costCertifications: CostCertification[];
  stockAlerts: StockAlert[];
  stockValuation: StockValuation;
  /** P08 : 15 collections CRM, toutes vides au démarrage, sans fixture. */
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
  crmStats: CrmStats;
  crmRules: CrmRules;
  subscription: Subscription | null;
  auditLogs: AuditLog[];
  platformCompanies: PlatformCompany[];
  session: Session | null;
  demoMode: boolean;
  washCounter: number;
  // Les mots de passe de démonstration ne sont plus dans l'état métier :
  // voir lib/demoPasswords.ts. En mode Supabase, Auth est la seule autorité.
}

export class ApiError extends Error {
  code: string;
  missing?: string[];
  constructor(code: string, message: string, missing?: string[]) {
    super(message);
    this.code = code;
    this.missing = missing;
  }
}
