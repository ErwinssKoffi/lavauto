// ─── WashGuard — types métier ────────────────────────────────────────────────
// Ces types reflètent les futures tables Supabase (companies, stations,
// users, services, vehicle_categories, clients, washes, wash_items,
// payments, cash_sessions, expenses, plans, subscriptions, audit_logs).
// Le frontend seul ne crée aucune donnée métier : tout part vide et
// l'onboarding constate les données réellement enregistrées.

export type Role = 'proprietaire' | 'gerant' | 'caissier' | 'laveur' | 'support';

export type WashStatus =
  | 'en_attente'
  | 'assigne'
  | 'en_cours'
  | 'controle_qualite'
  | 'termine'
  | 'livre'
  | 'annule';

export type PayMethod = 'especes' | 'mobile_money' | 'carte' | 'virement';

export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile Money',
  carte: 'Carte',
  virement: 'Virement',
};

export const WASH_STATUS_LABELS: Record<WashStatus, string> = {
  en_attente: 'En attente',
  assigne: 'Assigné',
  en_cours: 'En cours',
  controle_qualite: 'Contrôle qualité',
  termine: 'Terminé',
  livre: 'Livré',
  annule: 'Annulé',
};

export const ROLE_LABELS: Record<Role, string> = {
  proprietaire: 'Propriétaire',
  gerant: 'Gérant',
  caissier: 'Caissier',
  laveur: 'Laveur',
  support: 'Support WashGuard',
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
  logoUrl: string | null;
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
  assignedStationIds?: string[] | null; // stations assignées (multi-stations)
  createdAt: string;
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
  employeeId: string;
  items: WashItem[];
  discount: number;
  total: number;
  paid: number;
  status: WashStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt: string | null;
  deliveredAt?: string | null;
  bayId?: string | null;
  bayName?: string | null;
  cancelledReason: string | null;
  payments: Payment[];
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
}

export interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  trial: boolean;
  limits: { stations: number; employees: number; washesPerMonth: number };
  features: string[];
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
  status: 'active' | 'essai' | 'suspendue';
  stations: number;
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
  stations?: Station[];
  users: AppUser[];
  vehicleCategories: VehicleCategory[];
  services: Service[];
  clients: Client[];
  washes: Wash[];
  cashSessions: CashSession[];
  expenses: Expense[];
  subscription: Subscription | null;
  auditLogs: AuditLog[];
  platformCompanies: PlatformCompany[];
  session: Session | null;
  demoMode: boolean;
  washCounter: number;
  // Stockage local de démonstration uniquement. La vraie authentification
  // sera Supabase Auth (aucun mot de passe ne transite par le frontend).
  passwords: Record<string, string>;
  // Extensions de domaine PostgreSQL Prompt 03
  washBays?: WashBay[];
  products?: Product[];
  suppliers?: Supplier[];
  stockMovements?: StockMovement[];
  commissionPeriods?: CommissionPeriod[];
  commissionPayouts?: CommissionPayout[];
  attendanceRecords?: AttendanceRecord[];
}

// ─── Tables Métier Étendues (Architecture PostgreSQL Supabase) ────────────────

export interface WashBay {
  id: string;
  stationId: string;
  name: string;
  bayType: 'manuelle' | 'automatique' | 'finition' | 'sechage';
  active: boolean;
  currentWashId?: string | null;
}

export interface WashQualityCheck {
  id: string;
  washId: string;
  checkedBy: string;
  checkedAt: string;
  exteriorScore: number; // 1 à 5
  interiorScore: number; // 1 à 5
  rimsScore: number;     // 1 à 5
  approved: boolean;
  notes?: string | null;
}

export interface ProductCategory {
  id: string;
  stationId: string;
  name: string;
  code: string;
}

export interface Supplier {
  id: string;
  stationId: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  active: boolean;
}

export interface Product {
  id: string;
  stationId: string;
  categoryId?: string | null;
  supplierId?: string | null;
  sku: string;
  name: string;
  unit: string; // 'L', 'kg', 'unite', 'bidon_5L'
  costPrice: number; // en FCFA
  sellingPrice?: number | null; // en FCFA si revente directe
  currentStock: number;
  minStockAlert: number;
  active: boolean;
}

export interface StockMovement {
  id: string;
  stationId: string;
  productId: string;
  movementType: 'entree_livraison' | 'sortie_lavage' | 'ajustement_inventaire' | 'perte_vol';
  qty: number;
  unitCost: number;
  referenceType?: string | null; // 'wash', 'purchase_order', 'manual'
  referenceId?: string | null;
  performedBy: string;
  performedAt: string;
  notes?: string | null;
}

export interface ServiceRecipe {
  id: string;
  serviceId: string;
  productId: string;
  quantityRequired: number;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrder {
  id: string;
  stationId: string;
  supplierId: string;
  orderNumber: string;
  status: 'brouillon' | 'commandee' | 'receptionnee_partielle' | 'receptionnee' | 'annulee';
  orderedAt?: string | null;
  receivedAt?: string | null;
  totalAmount: number;
  items?: PurchaseOrderItem[];
}

export interface CommissionPeriod {
  id: string;
  stationId: string;
  periodStart: string; // 'aaaa-mm-jj'
  periodEnd: string;   // 'aaaa-mm-jj'
  status: 'ouverte' | 'validee' | 'payee';
  totalCommissionDue: number;
  totalCommissionPaid: number;
}

export interface CommissionPayout {
  id: string;
  periodId: string;
  employeeId: string;
  washesCount: number;
  revenueGenerated: number;
  commissionAmount: number;
  paidAt?: string | null;
  paymentMethod?: PayMethod | null;
  paidBy?: string | null;
}

export interface AttendanceRecord {
  id: string;
  stationId: string;
  employeeId: string;
  workDate: string; // 'aaaa-mm-jj'
  checkInTime?: string | null;
  checkOutTime?: string | null;
  status: 'present' | 'absent' | 'retard' | 'conge';
  notes?: string | null;
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
