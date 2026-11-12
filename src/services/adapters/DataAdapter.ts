import type {
  AppState, Client, PayMethod, Plan, ProfitabilityReport, Wash, WashPost,
  WashQualityResult, WashStatus,
} from '../../types';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { FinanceSnapshot } from '../../lib/finance';
import type {
  CostCertificationPayload, CreatePurchaseOrderPayload, InventoryCountPayload,
  ProductPayload, ReceivePurchasePayload, ServiceConsumptionPayload,
  StockSnapshot, SupplierPayload,
} from '../../lib/stock';
import type {
  AttachFleetVehiclePayload, CrmSnapshot, CustomerProfilePayload,
  CustomerVehiclePayload, FleetContractPayload, FleetPayload,
  FleetReceivablePayload, LoyaltyAccrualResult, LoyaltyEnrollmentPayload,
  LoyaltyProgramPayload, LoyaltyTransactionPayload, NotificationPayload,
  PackageConsumptionResult, PackagePlanPayload, PackageSalePayload,
  PromotionApplicationPayload, PromotionApplicationResult, PromotionPayload,
} from '../../lib/crm';
import type {
  AnalyticsSnapshot, PlatformSnapshot, SubscriptionUsageSnapshot,
} from '../../lib/analytics';
import { LocalDataAdapter } from './LocalDataAdapter';
import { SupabaseDataAdapter, type SupabaseReader } from './SupabaseDataAdapter';

// ─── Contrat de données (Prompts 03 + 05) ───────────────────────────────────
// Prompt 03 : lectures seules (plans, bootstrap, catalogue).
// Prompt 05 : le cœur lavages ajoute la lecture du tableau de bord et un port
// d'écritures RPC. Les commandes passent TOUTES par des fonctions
// SECURITY DEFINER qui déduisent le tenant du JWT ; le frontend n'envoie
// jamais d'identifiant d'entreprise. `washCommands` est null en mode local :
// le store continue d'appliquer ses mutations synchrones sur l'état navigateur.
//
// Sécurité : aucun identifiant d'entreprise n'est jamais accepté en paramètre.
// Le serveur le déduit de `auth.uid()` via sa fonction de contexte, et la RLS
// filtre les lignes. Le frontend lit uniquement ce que la RLS rend visible.

export type DataSource = 'local' | 'supabase';

export interface CompanySummary {
  id: string;
  name: string;
  city: string;
  phone: string;
  currencyCode: string;
  suspended: boolean;
}

export interface StationSummary {
  id: string;
  name: string;
  city: string;
  activated: boolean;
}

export interface Bootstrap {
  userId: string;
  fullName: string;
  email: string;
  active: boolean;
  roleKey: string;
  permissions: string[];
  company: CompanySummary;
  stations: StationSummary[];
  stationIds: string[];
}

export interface CatalogCategory {
  id: string;
  stationId: string;
  name: string;
  active: boolean;
}

export interface CatalogService {
  id: string;
  stationId: string;
  name: string;
  description: string;
  active: boolean;
}

export interface CatalogPrice {
  stationId: string;
  serviceId: string;
  vehicleCategoryId: string;
  priceMinor: number;
  currencyCode: string;
}

export interface CatalogSnapshot {
  categories: CatalogCategory[];
  services: CatalogService[];
  prices: CatalogPrice[];
}

/** Payload de création : aucun tenant, prix relus et figés par le serveur. */
export interface WashCreatePayload {
  stationId: string;
  categoryId: string;
  plate: string;
  clientId: string | null;
  clientName: string;
  items: { serviceId: string; qty: number }[];
  discount: number;
  employeeIds: string[];
  postId: string | null;
  idempotencyKey: string;
  payment?: { amount: number; method: PayMethod } | null;
}

export interface WashBoardSnapshot {
  washes: Wash[];
  posts: WashPost[];
}

/** Écritures du cycle de lavage, exclusivement via RPC serveur. */
export interface WashCommands {
  createWash(p: WashCreatePayload): Promise<string>;
  transitionStatus(id: string, to: WashStatus, reason?: string): Promise<void>;
  assign(id: string, userIds: string[], postId: string | null): Promise<void>;
  qualityCheck(id: string, result: WashQualityResult, notes: string): Promise<void>;
  addPayment(id: string, amount: number, method: PayMethod, idempotencyKey: string): Promise<void>;
  createPost(name: string, capacity: number, stationId?: string | null): Promise<void>;
  vehicleHistory(plate: string): Promise<Wash[]>;
}

/** Écritures finance P06 : toutes via RPC SECURITY DEFINER, jamais en direct. */
export interface ExpenseCreatePayload {
  stationId: string;
  amount: number;
  category: string;
  reason: string;
  supplier: string;
  date: string;
  method: PayMethod;
  idempotencyKey: string;
}

export interface FinanceCommands {
  openCash(stationId: string, openingFloat: number, number?: string): Promise<string>;
  closeCash(sessionId: string, counted: number): Promise<void>;
  reopenCash(sessionId: string, reason: string): Promise<void>;
  addExpense(p: ExpenseCreatePayload): Promise<string>;
  cancelExpense(id: string, reason: string): Promise<void>;
  cancelPayment(paymentId: string, reason: string): Promise<void>;
  reconcileChannel(methodId: string, start: string, end: string, counted: number): Promise<void>;
  createCommissionPeriod(stationId: string, start: string, end: string): Promise<string>;
  validateCommissionPeriod(periodId: string): Promise<void>;
  recordCommissionPayout(periodId: string, userId: string, amount: number, reference: string): Promise<void>;
}

/** Écritures stock/fournisseurs/achats P07 : exclusivement via RPC serveur. */
export interface StockCommands {
  saveSupplier(p: SupplierPayload): Promise<string>;
  saveProduct(p: ProductPayload): Promise<string>;
  createPurchaseOrder(p: CreatePurchaseOrderPayload): Promise<string>;
  receivePurchaseLines(p: ReceivePurchasePayload): Promise<void>;
  startInventory(stationId: string): Promise<string>;
  recordInventoryCount(p: InventoryCountPayload): Promise<void>;
  closeInventory(sessionId: string): Promise<void>;
  saveServiceConsumption(p: ServiceConsumptionPayload): Promise<string>;
  consumeWash(washId: string): Promise<void>;
  linkExpenseToOrder(expenseId: string, orderId: string): Promise<void>;
  certifyCosts(p: CostCertificationPayload): Promise<void>;
}

/** Écritures CRM/fidélité/forfaits/promotions/flottes P08 : RPC serveur uniquement. */
export interface CrmCommands {
  saveCustomerProfile(p: CustomerProfilePayload): Promise<string>;
  saveCustomerVehicle(p: CustomerVehiclePayload): Promise<string>;
  createLoyaltyProgram(p: LoyaltyProgramPayload): Promise<string>;
  enrollLoyaltyCustomer(p: LoyaltyEnrollmentPayload): Promise<string>;
  recordLoyaltyTransaction(p: LoyaltyTransactionPayload): Promise<string>;
  accrueLoyaltyForWash(washId: string, idempotencyKey?: string | null): Promise<LoyaltyAccrualResult>;
  savePackagePlan(p: PackagePlanPayload): Promise<string>;
  sellPackageToCustomer(p: PackageSalePayload): Promise<string>;
  consumePackageForWash(washId: string): Promise<PackageConsumptionResult>;
  savePromotion(p: PromotionPayload): Promise<string>;
  applyPromotionToWash(p: PromotionApplicationPayload): Promise<PromotionApplicationResult>;
  saveFleet(p: FleetPayload): Promise<string>;
  saveFleetContract(p: FleetContractPayload): Promise<string>;
  attachFleetVehicle(p: AttachFleetVehiclePayload): Promise<string>;
  recordFleetReceivable(p: FleetReceivablePayload): Promise<string>;
  enqueueNotification(p: NotificationPayload): Promise<string>;
  cancelPendingNotification(id: string): Promise<void>;
}

/** P09 : écriture administrable des formules, limites, abonnements, suspension.
 *  Le super admin envoie un identifiant d'entreprise explicite choisi depuis
 *  le board : aucune commande métier de tenant n'accepte un tenant du JWT. */
export interface PlanPayload {
  planId: string;
  name: string;
  priceMinor: number;
  trialDays: number;
  active: boolean;
  sortOrder: number;
  features: string[];
}

export interface PlanLimitPayload {
  planId: string;
  key: 'stations' | 'employees' | 'washes_per_month';
  valueInt: number;
}

export interface CompanySubscriptionPayload {
  companyId: string;
  planId: string;
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
}

export interface CompanySuspensionPayload {
  companyId: string;
  suspended: boolean;
}

/** P09 : 5 commandes serveur, exclusivement réservées au super admin. */
export interface AnalyticsCommands {
  refreshSubscriptionUsage(periodStart: string): Promise<void>;
  savePlan(p: PlanPayload): Promise<string>;
  setPlanLimit(p: PlanLimitPayload): Promise<void>;
  setCompanySubscription(p: CompanySubscriptionPayload): Promise<void>;
  setCompanySuspended(p: CompanySuspensionPayload): Promise<void>;
}

/** Interface commune : deux implémentations, mêmes types de domaine. */
export interface DataAdapter {
  readonly source: DataSource;
  /** Formules actives + limites : table `plans` / `plan_limits`. */
  listPlans(): Promise<Plan[]>;
  /** Contexte du tenant, déduit du JWT côté serveur, sans identifiant client. */
  getBootstrap(): Promise<Bootstrap | null>;
  /** Catalogue et grille tarifaire visibles via RLS, sans filtre de tenant. */
  listCatalog(): Promise<CatalogSnapshot>;
  /** Clients du tenant, avec UUID serveur pour la création de fiche (P05). */
  listClients(): Promise<Client[]>;
  /** Fiches + postes visibles, projetés par `my_wash_board()` / `my_wash_posts()`. */
  listWashBoard(): Promise<WashBoardSnapshot>;
  /** null en local ; commandes RPC `SECURITY DEFINER` en mode supabase. */
  readonly washCommands: WashCommands | null;
  /** P06 : lecture finance agrégée par `my_finance_board()` en mode serveur. */
  listFinanceBoard(): Promise<FinanceSnapshot>;
  /** P06 : rapport honnête « coûts manquants », RPC ou calcul local. */
  listProfitability(start: string, end: string): Promise<ProfitabilityReport>;
  /** null en local ; commandes finance RPC `SECURITY DEFINER` en mode supabase. */
  readonly financeCommands: FinanceCommands | null;
  /** P07 : board `my_stock_board()` en mode serveur, projection locale sinon. */
  listStockBoard(): Promise<StockSnapshot>;
  /** null en local ; commandes stock/certification RPC en mode supabase. */
  readonly stockCommands: StockCommands | null;
  /** P08 : board `my_crm_board()` en mode serveur, projection locale sinon. */
  listCrmBoard(): Promise<CrmSnapshot>;
  /** null en local ; 17 commandes CRM/notifications RPC en mode supabase. */
  readonly crmCommands: CrmCommands | null;
  /** P09 : board station/consolidé RPC en mode serveur, calcul local sinon. */
  listAnalyticsBoard(start: string, end: string, compareStart: string | null, compareEnd: string | null): Promise<AnalyticsSnapshot>;
  /** P09 : usage et limites relus côté serveur, jamais fournis par l'UI. */
  listSubscriptionUsage(periodStart: string): Promise<SubscriptionUsageSnapshot>;
  /** P09 : entreprises, formules, quotas, suspension et journaux hors tenant. */
  listPlatformBoard(): Promise<PlatformSnapshot>;
  /** null en local ; 5 commandes du back-office RPC en mode supabase. */
  readonly analyticsCommands: AnalyticsCommands | null;
}

/** Valeurs acceptées pour VITE_DATA_SOURCE. Toute autre valeur est refusée. */
export function resolveDataSource(raw: string | undefined | null): DataSource {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'local') return 'local';
  if (value === 'supabase') return 'supabase';
  throw new Error(`VITE_DATA_SOURCE invalide : « ${raw} ». Utilisez local ou supabase.`);
}

/** `import.meta.env` n'existe que dans Vite ; garde-fou pour les tests Node. */
function viteEnv(key: string): string | undefined {
  // Référence explicite : Vite et esbuild remplacent `import.meta.env` par un
  // objet, tandis qu'un bundle CJS de test obtient `undefined` sans planter.
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  return env?.[key];
}

export function getDataSource(): DataSource {
  return resolveDataSource(viteEnv('VITE_DATA_SOURCE'));
}

/**
 * Sélection de l'adaptateur. `local` est le défaut : rollback immédiat et
 * démonstration inchangée. `supabase` exige un client configuré avec la clé
 * PUBLISHABLE, jamais la clé service_role.
 */
export function getDataAdapter(getState: () => AppState): DataAdapter {
  const source = getDataSource();
  if (source === 'local') return new LocalDataAdapter(getState);
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'VITE_DATA_SOURCE=supabase exige VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (clé publishable).'
    );
  }
  // Le client Supabase complet satisfait ce contrat de lecture ; le cast
  // isole la surface utilisée et permet d'injecter un faux lecteur en test.
  return new SupabaseDataAdapter(supabase as unknown as SupabaseReader);
}
