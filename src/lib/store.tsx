import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AppState, AppUser, CashSession, Client, Company, DayHours, Expense, PayMethod,
  Plan, Role, Service, Session, Station, Subscription, VehicleCategory, Wash,
  WashItem, WashPost, WashQualityResult, WashStatus,
} from '../types';
import { ApiError, PAY_METHOD_DB_KEY } from '../types';
import { canTransitionWash, normalizeWashes, washEvent } from './washLifecycle';
import { mapCatalogToState } from './catalog';
import { theoreticalCash } from './metrics';
import {
  cancelExpenseWithLedger, cancelPaymentWithLedger, closeCashWithLedger,
  createCommissionPeriodLocal, emptyFinanceCollections, localProfitability,
  cashPaymentMovement, reconcileChannelLocal, recordCommissionPayoutLocal,
  validateCommissionPeriodLocal, withFinanceDefaults,
} from './financeState';
import {
  emptyStockCollections, seedLocalDemoStock, withStockDefaults,
  type CostCertificationPayload, type CreatePurchaseOrderPayload,
  type InventoryCountPayload, type ProductPayload, type ReceivePurchasePayload,
  type ServiceConsumptionPayload, type SupplierPayload, type StockSnapshot,
} from './stock';
import {
  certifyCostsLocal, closeInventoryLocal, consumeWashLocal,
  createPurchaseOrderLocal, linkExpenseToOrderLocal, receivePurchaseLinesLocal,
  recordInventoryCountLocal, saveProductLocal, saveServiceConsumptionLocal,
  saveSupplierLocal, startInventoryLocal,
  updateProductThresholdLocal, adjustProductStockQtyLocal,
} from './stockState';
import {
  crmBoardFromState, emptyCrmCollections, withCrmDefaults,
  type AttachFleetVehiclePayload, type CrmSnapshot,
  type CustomerProfilePayload, type CustomerVehiclePayload,
  type FleetContractPayload, type FleetPayload, type FleetReceivablePayload,
  type LoyaltyAccrualResult, type LoyaltyEnrollmentPayload,
  type LoyaltyProgramPayload, type LoyaltyTransactionPayload,
  type NotificationPayload, type PackageConsumptionResult,
  type PackagePlanPayload, type PackageSalePayload,
  type PromotionApplicationPayload, type PromotionApplicationResult,
  type PromotionPayload,
} from './crm';
import {
  accrueLoyaltyForWashLocal, applyPromotionToWashLocal,
  attachFleetVehicleLocal, cancelPendingNotificationLocal,
  consumePackageForWashLocal, createLoyaltyProgramLocal,
  enrollLoyaltyCustomerLocal, enqueueNotificationLocal,
  recordFleetReceivableLocal, recordLoyaltyTransactionLocal,
  saveCustomerProfileLocal, saveCustomerVehicleLocal,
  saveFleetContractLocal, saveFleetLocal, savePackagePlanLocal,
  savePromotionLocal, sellPackageToCustomerLocal,
  type CrmMutation,
} from './crmState';
import { formatFCFA, uid, todayISO } from './format';
import { idempotencyKey } from './network';
import {
  clearPendingWash, readPendingWash, savePendingWash, WashCreationError,
  type PendingWashCreation,
} from './washCreation';
import { getPlans, setPlansCache } from './plans';
import {
  analyticsBoardFromState, emptyAnalyticsBoard, emptyPlatformBoard,
  emptySubscriptionUsage, monthStartISO, platformBoardFromState,
  subscriptionUsageFromState,
  type AnalyticsSnapshot, type PlatformSnapshot, type SubscriptionUsageSnapshot,
} from './analytics';
import {
  getDataSource, getDataAdapter,
  type CompanySubscriptionPayload, type CompanySuspensionPayload,
  type DataAdapter, type DataSource, type PlanLimitPayload, type PlanPayload,
} from '../services/adapters/DataAdapter';
import { getAuthPort } from '../services/auth/getAuthPort';
import type { AuthPort, AuthResult, AuthChange } from '../services/auth/AuthPort';
import {
  mapIdentityToAppState, type AuthIdentity, type Invitation, type InvitePayload,
  type SignUpPayload, type UpdateUserPayload,
} from '../services/auth/authTypes';
import { clearDemoPasswords } from './demoPasswords';
import { isStationLogoPath } from './image';
import type { StationMetrics } from './stationMetrics';
import { clearPendingPayment, readPendingPayment, savePendingPayment, PaymentCommandError, type PendingPayment } from './paymentAttempt';
import {
  validateCertification, validateConsumption, validateCustomer, validateDate, validateEmail,
  validateExpense, validateFleet, validateFleetContract, validateFleetReceivable, validateInventory,
  validateMoney, validateOrder, validatePackage, validatePercentage, validatePeriod, validatePhone, validatePlate,
  validateProduct, validatePromotion, validateQuantity, validateReceipt, validateSupplier, validateWash,
} from './validation';
import type { LocalAuthAdapter } from '../services/auth/LocalAuthAdapter';

// ═══════════════════════════════════════════════════════════════════════════
// Couche de données WashGuard — FRONTEND UNIQUEMENT
//
// En l'absence de backend branché, l'état est conservé dans le navigateur.
// Cette couche simule le *contrat* du serveur, pas des données :
//   • l'inscription crée UNE SEULE FOIS entreprise + station + compte
//     propriétaire + abonnement d'essai ;
//   • l'onboarding est CONSTATÉ sur les données enregistrées (aucune case
//     cochée par le navigateur) ;
//   • tant que la station n'est pas activée, toute écriture métier lève
//     409 onboarding_incomplete avec la liste de ce qui manque ;
//   • aucun prix de prestation ni aucune donnée d'exemple n'est prérempli.
//
// Le Prompt 03 ajoute un adaptateur de DONNÉES EN LECTURE SEULE. Le Prompt 04
// branche Supabase Auth via un port : `onAuthStateChange` vérifie le JWT et
// relit le contexte RBAC serveur. La session UI n'est jamais forgée depuis
// localStorage ; les écritures métier restent locales jusqu'aux RPC P05+,
// sans réécrire les formulaires ni le contrat général de useStore().
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'washguard.state.v1';

export const DEFAULT_DAYS: DayHours[] = [
  { day: 'Lundi', open: '08:00', close: '18:00', closed: false },
  { day: 'Mardi', open: '08:00', close: '18:00', closed: false },
  { day: 'Mercredi', open: '08:00', close: '18:00', closed: false },
  { day: 'Jeudi', open: '08:00', close: '18:00', closed: false },
  { day: 'Vendredi', open: '08:00', close: '18:00', closed: false },
  { day: 'Samedi', open: '08:00', close: '18:00', closed: false },
  { day: 'Dimanche', open: '08:00', close: '18:00', closed: false },
];

export const emptyState = (): AppState => ({
  company: null,
  station: null,
  users: [],
  vehicleCategories: [],
  services: [],
  clients: [],
  washes: [],
  washPosts: [],
  cashSessions: [],
  expenses: [],
  ...emptyFinanceCollections(),
  ...emptyStockCollections(),
  ...emptyCrmCollections(),
  subscription: null,
  auditLogs: [],
  platformCompanies: [],
  session: null,
  demoMode: getDataSource() === 'local',
  washCounter: 0,
});

const TEST_AUTH = import.meta.env.VITE_WG_TEST_AUTH === '1';

interface TestBridge { __WG_TEST_SESSION__?: { session?: Session | null } }

/** L'état métier est persisté, JAMAIS la session (Prompt 04). */
export function load(): AppState {
  let persisted: Partial<AppState> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      const { session: _ignored, ...rest } = parsed;
      persisted = rest;
    }
  } catch { /* état corrompu → repartir à vide */ }
  const state: AppState = withCrmDefaults(withStockDefaults(withFinanceDefaults({
    ...emptyState(), ...persisted, session: null,
  })));
  // Les anciennes URL (parfois signées ou externes) ne sont jamais réutilisées
  // comme chemin privé. Un nouveau téléversement est nécessaire pour ces logos.
  if (state.station) {
    const { logoUrl: _legacyLogoUrl, ...station } = state.station as Station & { logoUrl?: unknown };
    state.station = { ...station, logoPath: isStationLogoPath(station.logoPath)
      && station.logoPath.startsWith(`${station.companyId}/`) ? station.logoPath : null };
  }
  // Prompt 05 : mapping des 4 statuts FR → 7 statuts EN + historique initial
  // par fiche importée. Idempotent, appliqué à chaque lecture du stockage.
  state.washes = normalizeWashes(persisted.washes as unknown[] | undefined);
  state.washPosts = Array.isArray(persisted.washPosts) ? persisted.washPosts : [];
  // Pont de compilation réservé au harnais JSDOM ; absent de la build Vite.
  if (TEST_AUTH && typeof window !== 'undefined') {
    const injected = (window as unknown as TestBridge).__WG_TEST_SESSION__?.session;
    if (injected) state.session = injected;
  }
  return state;
}

export function persist(state: AppState): void {
  try {
    const { session: _ignored, ...withoutSession } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutSession));
  } catch { /* quota plein ou stockage indisponible */ }
}

// ─── Onboarding : 13 étapes, 8 obligatoires, état constaté ───────────────────
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  required: boolean;
  done: boolean;
  hint: string;
}

export function computeOnboarding(s: AppState): OnboardingStep[] {
  const st = s.station;
  const co = s.company;
  const cats = s.vehicleCategories.filter((c) => c.active);
  const svcs = s.services.filter((v) => v.active);
  const pricesComplete =
    cats.length > 0 && svcs.length > 0 &&
    svcs.every((v) => cats.every((c) => (v.prices[c.id] ?? 0) > 0));
  const hoursSet = Boolean(st && st.hours.length === 7 && st.hours.some((h) => !h.closed));

  return [
    {
      id: 'entreprise', title: 'Identité de l’entreprise', required: true,
      description: 'Raison sociale, ville et téléphone de l’entreprise.',
      done: Boolean(co && co.name.trim() && co.city.trim() && co.phone.trim()),
      hint: 'Renseignez le nom, la ville et le téléphone.',
    },
    {
      id: 'station', title: 'Identité de la station', required: true,
      description: 'Nom, adresse et ville de la station.',
      done: Boolean(st && st.name.trim() && st.address.trim() && st.city.trim()),
      hint: 'Renseignez le nom, l’adresse et la ville.',
    },
    {
      id: 'horaires', title: 'Horaires d’ouverture', required: true,
      description: 'Les sept jours de la semaine, avec les jours fermés.',
      done: hoursSet,
      hint: 'Validez au moins un jour ouvert.',
    },
    {
      id: 'categories', title: 'Catégories de véhicules', required: true,
      description: 'Les types de véhicules que vous lavez (ex. Berline, 4×4).',
      done: cats.length > 0,
      hint: 'Ajoutez au moins une catégorie.',
    },
    {
      id: 'catalogue', title: 'Catalogue des prestations', required: true,
      description: 'Les prestations proposées par votre station.',
      done: svcs.length > 0,
      hint: 'Ajoutez au moins une prestation.',
    },
    {
      id: 'tarifs', title: 'Grille tarifaire', required: true,
      description: 'Un prix par prestation et par catégorie de véhicule.',
      done: pricesComplete,
      hint: `Chaque prestation doit avoir un prix pour chaque catégorie (${cats.length} catégorie(s) × ${svcs.length} prestation(s)).`,
    },
    {
      id: 'paiements', title: 'Moyens de paiement', required: true,
      description: 'Espèces, Mobile Money, carte, virement.',
      done: Boolean(st && st.paymentMethods.length > 0),
      hint: 'Sélectionnez au moins un moyen de paiement.',
    },
    {
      id: 'equipe', title: 'Comptes employés', required: false,
      description: 'Ajoutez vos laveurs, gérants et caissiers.',
      done: s.users.filter((u) => u.role !== 'proprietaire').length > 0,
      hint: 'Facultatif : le compte propriétaire suffit pour ouvrir.',
    },
    {
      id: 'logo', title: 'Logo de la station', required: false,
      description: 'Ajoutez un logo dans le stockage privé.',
      done: isStationLogoPath(st?.logoPath),
      hint: 'Facultatif.',
    },
    {
      id: 'caisse', title: 'Règles de caisse', required: false,
      description: 'Caisse obligatoire pour les espèces, remise maximale du caissier.',
      done: Boolean(st && (st.maxCashierDiscount > 0 || !st.cashRequiresOpen)),
      hint: 'Facultatif : des règles par défaut sont déjà appliquées.',
    },
    {
      id: 'commissions', title: 'Barème des commissions', required: false,
      description: 'Pourcentage dû aux laveurs sur les lavages terminés.',
      done: Boolean(st && st.commissionRate > 0),
      hint: 'Facultatif : 0 % tant que vous n’avez pas choisi.',
    },
    {
      id: 'objectif', title: 'Objectif du mois', required: false,
      description: 'Objectif de chiffre d’affaires suivi sur le tableau de bord.',
      done: Boolean(st && st.monthlyTarget > 0),
      hint: 'Facultatif.',
    },
    {
      id: 'activation', title: 'Activation de la station', required: true,
      description: 'Ouvre l’exploitation : fiches, encaissements, caisse et dépenses.',
      done: Boolean(st?.activated),
      hint: 'Activez une fois les sept étapes obligatoires constatées.',
    },
  ];
}

export function missingRequired(s: AppState): string[] {
  return computeOnboarding(s)
    .filter((step) => step.required && step.id !== 'activation' && !step.done)
    .map((step) => step.title);
}

// ─── Contexte ────────────────────────────────────────────────────────────────
export interface Toast { id: string; kind: 'success' | 'error' | 'info'; message: string }

export interface WashPayload {
  categoryId: string;
  plate: string;
  /** Premier employé (compatibilité) ; `employeeIds` porte les affectations multiples. */
  employeeId: string;
  employeeIds?: string[];
  postId?: string | null;
  clientId: string | null;
  clientName: string;
  items: { serviceId: string; qty: number }[];
  discount: number;
  payment?: { amount: number; method: PayMethod } | null;
}

interface Ctx {
  state: AppState;
  toasts: Toast[];
  notify: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  /** Formules affichées : cache du repli local ou lignes lues dans `plans`. */
  plans: Plan[];
  /** Source active (diagnostic) : `local` par défaut, `supabase` en lecture seule. */
  dataSource: DataSource;
  /** Les simulations de stock sont réservées à une source ET une Auth locales. */
  isLocalStockDemo: boolean;
  /** Les commandes stock sont reliées au port RPC Supabase. */
  isServerStock: boolean;
  /** Erreur de chargement des tarifs : aucun prix local n'est affiché en repli. */
  plansError: string | null;
  onboarding: OnboardingStep[];
  missing: string[];
  // Auth / RBAC (Prompt 04) : serveur唯一 autorité, UI = reflet des permissions.
  authReady: boolean;
  authError: string | null;
  authRecovery: boolean;
  authKind: AuthPort['kind'];
  identity: AuthIdentity | null;
  /** Sélection de confort : les autorisations restent vérifiées par le serveur. */
  selectStation: (stationId: string) => void;
  assignableUsers: AppUser[];
  stationMetrics: StationMetrics | null;
  stationMetricsError: string | null;
  refreshStationMetrics: (start: string, end: string) => Promise<void>;
  invitations: Invitation[];
  clearAuthError: () => void;
  signUp: (p: SignUpPayload) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  inviteUser: (p: InvitePayload) => Promise<{ id: string; message?: string }>;
  revokeInvitation: (id: string) => Promise<void>;
  updateUser: (p: UpdateUserPayload) => Promise<void>;
  refreshUsers: () => Promise<AppUser[]>;
  refreshInvitations: () => Promise<Invitation[]>;
  // données de base / paramètres
  updateCompany: (patch: Partial<Company>) => void;
  updateStation: (patch: Partial<Station>) => void;
  setStationLogoPath: (stationId: string, userId: string, path: string | null) => void;
  setHours: (hours: DayHours[]) => void;
  addCategory: (name: string) => void;
  toggleCategory: (id: string) => void;
  removeCategory: (id: string) => void;
  addService: (name: string, description: string) => void;
  updateService: (id: string, patch: Partial<Service>) => void;
  setPrice: (serviceId: string, categoryId: string, price: number) => void;
  removeService: (id: string) => void;
  updateEmployee: (id: string, patch: Partial<AppUser>) => void;
  addClient: (p: { name: string; phone: string; plate: string; notes: string }) => void;
  updateClient: (id: string, p: Partial<Client>) => void;
  // exploitation (protégées par le garde 409)
  // Prompt 05 : sync en mode local, Promise (RPC serveur) en mode supabase.
  createWash: (p: WashPayload) => Wash | Promise<Wash>;
  /** Tentative conservée dans cet onglet lorsqu'une réponse serveur est incertaine. */
  pendingWash: PendingWashCreation | null;
  pendingWashError: string | null;
  retryPendingWash: () => Promise<void>;
  setWashStatus: (id: string, status: WashStatus, reason?: string) => void | Promise<void>;
  addPayment: (washId: string, amount: number, method: PayMethod, idempotencyKey?: string) => void | Promise<void>;
  assignWash: (id: string, userIds: string[], postId?: string | null) => void | Promise<void>;
  recordQualityCheck: (id: string, result: WashQualityResult, notes: string) => void | Promise<void>;
  createWashPost: (name: string, capacity?: number, stationId?: string | null) => void | Promise<void>;
  refreshWashes: () => Promise<void>;
  vehicleHistory: (plate: string) => Promise<Wash[]>;
  openCash: (openingFloat: number) => void | Promise<void>;
  closeCash: (counted: number) => void | Promise<void>;
  reopenCash: (sessionId: string, reason: string) => void | Promise<void>;
  addExpense: (p: Omit<Expense, 'id' | 'stationId' | 'status' | 'cancelReason' | 'createdBy' | 'createdAt' | 'cashSessionId'>) => void | Promise<void>;
  cancelExpense: (id: string, reason: string) => void | Promise<void>;
  // Prompt 06 : annulation d'encaissement, rapprochements par canal, relevés figés.
  cancelPayment: (paymentId: string, reason: string) => void | Promise<void>;
  reconcileChannel: (methodId: string, start: string, end: string, counted: number) => void | Promise<void>;
  createCommissionPeriod: (stationId: string, start: string, end: string) => string | Promise<string>;
  validateCommissionPeriod: (periodId: string) => void | Promise<void>;
  recordCommissionPayout: (periodId: string, userId: string, amount: number, reference: string) => void | Promise<void>;
  /** Recharge `my_finance_board()` + `my_profitability()` (ou calcule le local). */
  refreshFinance: (start?: string, end?: string) => Promise<void>;
  // Prompt 07 : stocks, achats, inventaires, consommations, certification.
  refreshStock: () => Promise<void>;
  saveSupplier: (p: SupplierPayload) => string | Promise<string>;
  saveProduct: (p: ProductPayload) => string | Promise<string>;
  createPurchaseOrder: (p: CreatePurchaseOrderPayload) => string | Promise<string>;
  receivePurchaseLines: (p: ReceivePurchasePayload) => void | Promise<void>;
  startInventory: (stationId: string) => string | Promise<string>;
  recordInventoryCount: (p: InventoryCountPayload) => void | Promise<void>;
  closeInventory: (sessionId: string) => void | Promise<void>;
  saveServiceConsumption: (p: ServiceConsumptionPayload) => string | Promise<string>;
  consumeWash: (washId: string) => void | Promise<void>;
  linkExpenseToOrder: (expenseId: string, orderId: string) => void | Promise<void>;
  certifyCosts: (p: CostCertificationPayload) => void | Promise<void>;
  updateStockThreshold: (productId: string, reorderLevel: number) => void;
  adjustProductStock: (productId: string, qtyOnHand: number) => void;
  // Prompt 08 : CRM, fidélité, forfaits, promotions, flottes, file d'attente.
  refreshCrm: () => Promise<void>;
  saveCustomerProfile: (p: CustomerProfilePayload) => string | Promise<string>;
  saveCustomerVehicle: (p: CustomerVehiclePayload) => string | Promise<string>;
  createLoyaltyProgram: (p: LoyaltyProgramPayload) => string | Promise<string>;
  enrollLoyaltyCustomer: (p: LoyaltyEnrollmentPayload) => string | Promise<string>;
  recordLoyaltyTransaction: (p: LoyaltyTransactionPayload) => string | Promise<string>;
  accrueLoyaltyForWash: (washId: string, key?: string | null) => LoyaltyAccrualResult | Promise<LoyaltyAccrualResult>;
  savePackagePlan: (p: PackagePlanPayload) => string | Promise<string>;
  sellPackageToCustomer: (p: PackageSalePayload) => string | Promise<string>;
  consumePackageForWash: (washId: string) => PackageConsumptionResult | Promise<PackageConsumptionResult>;
  savePromotion: (p: PromotionPayload) => string | Promise<string>;
  applyPromotionToWash: (p: PromotionApplicationPayload) => PromotionApplicationResult | Promise<PromotionApplicationResult>;
  saveFleet: (p: FleetPayload) => string | Promise<string>;
  saveFleetContract: (p: FleetContractPayload) => string | Promise<string>;
  attachFleetVehicle: (p: AttachFleetVehiclePayload) => string | Promise<string>;
  recordFleetReceivable: (p: FleetReceivablePayload) => string | Promise<string>;
  enqueueNotification: (p: NotificationPayload) => string | Promise<string>;
  cancelPendingNotification: (id: string) => void | Promise<void>;
  // Prompt 09 : analytics, comparaison, quotas et back-office plateforme.
  analyticsBoard: AnalyticsSnapshot;
  subscriptionUsage: SubscriptionUsageSnapshot;
  platformBoard: PlatformSnapshot;
  analyticsError: string | null;
  platformError: string | null;
  refreshAnalytics: (
    start?: string, end?: string, compareStart?: string | null, compareEnd?: string | null
  ) => Promise<void>;
  refreshSubscriptionUsage: (periodStart?: string) => Promise<void>;
  refreshUsageCounters: (periodStart?: string) => Promise<void>;
  refreshPlatform: () => Promise<void>;
  savePlan: (p: PlanPayload) => Promise<string>;
  setPlanLimit: (p: PlanLimitPayload) => Promise<void>;
  setCompanySubscription: (p: CompanySubscriptionPayload) => Promise<void>;
  setCompanySuspended: (p: CompanySuspensionPayload) => Promise<void>;
  // abonnement / plateforme
  requestPlanChange: (planId: string) => void;
  toggleCompanySuspension: (companyId: string) => void;
  activateStation: () => void;
  resetAll: () => Promise<void>;
}

const StoreContext = createContext<Ctx | null>(null);

function logAction(state: AppState, action: string, detail: string): AppState['auditLogs'] {
  const actor = state.session?.name ?? 'Système';
  return [{ id: uid('log'), at: new Date().toISOString(), actor, action, detail }, ...state.auditLogs].slice(0, 200);
}

/** Les collections d'une station ne doivent jamais subsister lors d'un changement. */
function clearStationCollections(s: AppState): AppState {
  return {
    ...s, vehicleCategories: [], services: [], clients: [], washes: [], washPosts: [],
    cashSessions: [], expenses: [], ...emptyFinanceCollections(),
    ...emptyStockCollections(), ...emptyCrmCollections(), auditLogs: [], washCounter: 0,
  };
}

type StationScope = { epoch: number; userId: string | null; companyId: string | null; stationId: string | null };
const stationSelectionKey = (userId: string, companyId: string | null) =>
  `washguard.station-selection.v1:${userId}:${companyId ?? ''}`;
function rememberStation(userId: string, companyId: string | null, stationId: string): void {
  try { sessionStorage.setItem(stationSelectionKey(userId, companyId), stationId); } catch { /* facultatif */ }
}
function rememberedStation(userId: string, companyId: string | null): string | null {
  try { return sessionStorage.getItem(stationSelectionKey(userId, companyId)); } catch { return null; }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Les données métier connectées ne sont ni restaurées ni persistées dans le
  // cache de démonstration : seul un contexte JWT vérifié peut les afficher.
  const [state, setState] = useState<AppState>(() => getDataSource() === 'supabase' && !TEST_AUTH ? emptyState() : load());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRecovery, setAuthRecovery] = useState(false);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [pendingWashState, setPendingWashState] = useState<PendingWashCreation | null>(null);
  const [pendingWashError, setPendingWashError] = useState<string | null>(null);
  const washCreationInFlight = useRef(new Set<string>());
  const paymentsInFlight = useRef(new Set<string>());
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('washguard.theme') === 'light' ? 'light' : 'dark'
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const authKeyRef = useRef('');
  const authGenerationRef = useRef(0);
  const scopeRef = useRef<StationScope>({ epoch: 0, userId: null, companyId: null, stationId: null });
  const requestVersions = useRef<Record<string, number>>({});
  const financePeriod = useRef<{ start: string; end: string } | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<AppUser[]>([]);
  const [stationMetrics, setStationMetrics] = useState<StationMetrics | null>(null);
  const [stationMetricsError, setStationMetricsError] = useState<string | null>(null);
  /** La dernière requête gagne, et A → B → A invalide aussi les anciennes réponses A. */
  const beginRequest = useCallback((key: string) => {
    const epoch = scopeRef.current.epoch;
    const version = (requestVersions.current[key] ?? 0) + 1;
    requestVersions.current[key] = version;
    return () => scopeRef.current.epoch === epoch && requestVersions.current[key] === version;
  }, []);
  const authPort = useMemo<AuthPort>(() => getAuthPort({
    getState: () => stateRef.current,
    setState: (updater) => setState(updater),
  }), []);

  // ── Adaptateur de lecture (Prompt 03) ──────────────────────────────────────
  // Le mode local conserve ses tarifs immédiatement. Le mode Supabase part
  // SANS prix : si la base ne répond pas, aucun tarif local n'est présenté
  // comme un tarif de la base ; une erreur explicite est affichée à la place.
  const dataSource = getDataSource();
  const adapter = useMemo(() => getDataAdapter(() => stateRef.current), []);
  // `demoMode` décrit l'état de l'interface et n'est pas un garde de sécurité.
  // Une configuration mixte ne doit jamais activer ces mutations locales.
  const isLocalStockDemo = dataSource === 'local' && authPort.kind === 'local';
  // Les RPC exigent une vraie session Supabase Auth. Le harnais JSDOM garde le
  // port Auth local même en VITE_DATA_SOURCE=supabase : il continue donc à
  // exercer les règles métier locales (gardes 409, caisse, prix figé).
  const serverWash = dataSource === 'supabase' && authPort.kind === 'supabase' && Boolean(adapter.washCommands);
  // P06 : les mêmes RPC sont aussi l'autorité pour caisse, dépenses, canaux,
  // commissions et rentabilité. Le mode local conserve ses transformateurs purs.
  const serverFinance = dataSource === 'supabase' && authPort.kind === 'supabase'
    && Boolean(adapter.financeCommands);
  // P07 : `my_stock_board()` et les 11 RPC sont l'autorité en mode branché.
  const serverStock = dataSource === 'supabase' && authPort.kind === 'supabase'
    && Boolean(adapter.stockCommands);
  // P08 : `my_crm_board()` et les 17 RPC sont l'autorité en mode branché.
  const serverCrm = dataSource === 'supabase' && authPort.kind === 'supabase'
    && Boolean(adapter.crmCommands);
  // P09 : `my_analytics_board()`, `my_subscription_usage()` et
  // `my_platform_board()` deviennent l'autorité en mode branché. Les valeurs
  // locales restent calculées à partir de l'état réellement enregistré.
  const serverAnalytics = dataSource === 'supabase' && authPort.kind === 'supabase'
    && Boolean(adapter.analyticsCommands);
  const [plans, setPlans] = useState<Plan[]>(() => dataSource === 'local' ? getPlans() : []);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [analyticsBoard, setAnalyticsBoard] = useState<AnalyticsSnapshot>(() => emptyAnalyticsBoard());
  const [subscriptionUsage, setSubscriptionUsage] = useState<SubscriptionUsageSnapshot>(() => emptySubscriptionUsage());
  const [platformBoard, setPlatformBoard] = useState<PlatformSnapshot>(() => emptyPlatformBoard(dataSource === 'local' ? getPlans() : []));
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);

  // Une tentative indécise appartient à l'utilisateur et à la station vérifiés,
  // jamais à une session restaurée depuis localStorage. Elle survit au reload
  // de cet onglet, pas à l'effacement de son stockage ni à un autre appareil.
  const pendingWash = serverWash && pendingWashState?.userId === identity?.userId
    && pendingWashState?.stationId === state.station?.id ? pendingWashState : null;
  useEffect(() => {
    if (!serverWash || !authReady || !identity?.userId || !state.station?.id) {
      setPendingWashState(null);
      setPendingWashError(null);
      return;
    }
    try {
      setPendingWashState(readPendingWash(identity.userId, state.station.id));
      setPendingWashError(null);
    } catch (error) {
      setPendingWashState(null);
      setPendingWashError(error instanceof Error ? error.message : 'Tentative de création inaccessible.');
    }
  }, [serverWash, authReady, identity?.userId, state.station?.id]);

  // Les produits d'exemple ne sont créés que pour la démonstration entièrement
  // locale, jamais lors de la normalisation d'un tableau de bord serveur vide.
  useEffect(() => {
    if (isLocalStockDemo && state.station && state.products.length === 0) {
      setState((current) => seedLocalDemoStock(current));
    }
  }, [isLocalStockDemo, state.station?.id, state.products.length]);

  useEffect(() => {
    if (authPort.kind === 'local') persist(state);
  }, [state, authPort.kind]);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = uid('toast');
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const sessionFromIdentity = useCallback((value: AuthIdentity, stationId: string | null): Session => ({
    userId: value.userId,
    email: value.email,
    name: value.fullName,
    role: value.role,
    companyId: value.companyId,
    stationId,
  }), []);

  const reasonMessage = useCallback((reason: AuthChange['reason']): string | null => {
    if (reason === 'account_disabled') return 'Ce compte est désactivé. Contactez le propriétaire de la station.';
    if (reason === 'email_unconfirmed') return 'Confirmez votre adresse e-mail avec le lien reçu avant de vous connecter.';
    if (reason === 'session_expired') return 'Votre session a expiré. Reconnectez-vous.';
    if (reason === 'no_profile') return 'Votre profil n’est pas encore rattaché à une entreprise.';
    return null;
  }, []);

  const refreshInvitations = useCallback(async (): Promise<Invitation[]> => {
    const generation = authGenerationRef.current;
    const list = await authPort.listInvitations();
    if (generation === authGenerationRef.current) setInvitations(list);
    return list;
  }, [authPort]);

  const refreshUsers = useCallback(async (): Promise<AppUser[]> => {
    const generation = authGenerationRef.current;
    const users = await authPort.refreshUsers();
    if (generation === authGenerationRef.current) setState((s) => ({ ...s, users }));
    return users;
  }, [authPort]);

  const applyAuthChange = useCallback((change: AuthChange) => {
    const value = change.identity;
    if (change.type === 'PASSWORD_RECOVERY') setAuthRecovery(true);

    if (!value || !value.active || !value.emailConfirmed) {
      authGenerationRef.current += 1;
      authKeyRef.current = 'signed-out';
      scopeRef.current = { epoch: scopeRef.current.epoch + 1, userId: null, companyId: null, stationId: null };
      setState((s) => authPort.kind === 'supabase' ? emptyState() : { ...s, session: null });
      setIdentity(null);
      setInvitations([]);
      setToasts([]);
      setAssignableUsers([]);
      setStationMetrics(null);
      setStationMetricsError(null);
      setAnalyticsBoard(emptyAnalyticsBoard());
      setSubscriptionUsage(emptySubscriptionUsage());
      setPlatformBoard(emptyPlatformBoard());
      setAuthError(value && !value.active
        ? 'Ce compte est désactivé. Contactez le propriétaire de la station.'
        : value && !value.emailConfirmed
          ? 'Confirmez votre adresse e-mail avec le lien reçu.'
          : reasonMessage(change.reason));
      setAuthReady(true);
      return;
    }
    const key = JSON.stringify([
      value.userId, value.email, value.fullName, value.roleKey, value.permissions,
      value.active, value.companyId, value.company, value.stations, value.isPlatformAdmin, value.profileReady,
    ]);
    if (key === authKeyRef.current) return;
    const previousScope = scopeRef.current;
    const sameUser = previousScope.userId === value.userId && previousScope.companyId === value.companyId;
    const previousStation = stateRef.current.station;
    const available = new Set(value.stations.map((s) => s.id));
    const selected = [sameUser ? previousScope.stationId : null,
      rememberedStation(value.userId, value.companyId), value.stations[0]?.id ?? null]
      .find((id): id is string => Boolean(id && available.has(id))) ?? null;
    const changedScope = !sameUser || previousScope.stationId !== selected;
    // Des permissions peuvent être retirées sans changer de station. Ne pas
    // conserver une projection chargée sous les anciennes autorisations.
    const invalidate = changedScope || (authPort.kind === 'supabase' && sameUser && key !== authKeyRef.current);
    if (invalidate) {
      scopeRef.current = { epoch: previousScope.epoch + 1, userId: value.userId, companyId: value.companyId, stationId: selected };
      setAssignableUsers([]);
      setStationMetrics(null);
      setStationMetricsError(null);
      setAnalyticsBoard(emptyAnalyticsBoard()); setAnalyticsError(null);
      setSubscriptionUsage(emptySubscriptionUsage()); setPlatformBoard(emptyPlatformBoard()); setPlatformError(null);
      setToasts([]);
    }
    if (selected) rememberStation(value.userId, value.companyId, selected);
    const generation = ++authGenerationRef.current;
    authKeyRef.current = key;
    if (authPort.kind === 'supabase' && !sameUser) setAuthReady(false);
    const nextSession = sessionFromIdentity(value, selected);
    const projection = mapIdentityToAppState(value, [], selected);
    setIdentity(value);
    setAuthError(null);
    setState((s) => {
      if (authPort.kind === 'local') return { ...s, session: nextSession };
      const base = sameUser ? s : { ...emptyState(), demoMode: false };
      const clean = invalidate ? clearStationCollections(base) : base;
      const incoming = projection.station;
      const current = !changedScope ? s.station : null;
      const summary = value.stations.find((item) => item.id === selected);
      const station = incoming && current && incoming.id === current.id ? {
        ...incoming,
        // Les anciens contextes ne contenaient pas ces champs. Ne pas effacer
        // les réglages courants lorsqu'ils sont absents de la projection.
        address: summary?.address === undefined ? current.address : incoming.address,
        phone: summary?.phone === undefined ? current.phone : incoming.phone,
        hours: summary?.hours === undefined ? current.hours : incoming.hours,
        paymentMethods: current.paymentMethods,
        cashRequiresOpen: current.cashRequiresOpen, maxCashierDiscount: current.maxCashierDiscount,
        commissionRate: current.commissionRate, monthlyTarget: current.monthlyTarget,
        logoPath: previousStation?.logoPath !== current.logoPath ? current.logoPath : incoming.logoPath,
      } : incoming;
      return { ...clean, session: nextSession, company: projection.company, station, demoMode: false };
    });

    void (async () => {
      try {
        const { users } = await authPort.listUsers();
        if (authGenerationRef.current !== generation) return;
        if (authPort.kind === 'supabase') {
          // Une sélection effectuée pendant la lecture est conservée.
          const projected = mapIdentityToAppState(value, users, scopeRef.current.stationId);
          setState((s) => authGenerationRef.current === generation && s.session?.userId === value.userId
            ? { ...s, users: projected.users } : s);
        }
        const nextInvitations = await authPort.listInvitations();
        if (authGenerationRef.current === generation) setInvitations(nextInvitations);
      } catch {
        if (authGenerationRef.current === generation) setAuthError('Lecture du profil ou des permissions impossible.');
      } finally {
        if (authGenerationRef.current === generation) setAuthReady(true);
      }
    })();
  }, [authPort, sessionFromIdentity, reasonMessage]);

  const selectStation = useCallback((stationId: string) => {
    if (authPort.kind !== 'supabase' || !authReady || !identity
      || identity.userId !== scopeRef.current.userId || !identity.stations.some((s) => s.id === stationId)) {
      throw new ApiError('station_inaccessible', 'Cette station n’est pas accessible à votre session.');
    }
    if (scopeRef.current.stationId === stationId) return;
    // Invalidation synchrone AVANT le rendu : même une réponse déjà en vol pour
    // la première station ne peut pas être appliquée au nouveau contexte.
    scopeRef.current = { epoch: scopeRef.current.epoch + 1, userId: identity.userId,
      companyId: identity.companyId, stationId };
    rememberStation(identity.userId, identity.companyId, stationId);
    const projected = mapIdentityToAppState(identity, [], stationId);
    setAssignableUsers([]);
    setStationMetrics(null);
    setStationMetricsError(null);
    setToasts([]);
    setState((s) => ({ ...clearStationCollections(s), station: projected.station,
      session: sessionFromIdentity(identity, stationId) }));
  }, [authPort.kind, authReady, identity, sessionFromIdentity]);

  // UN seul abonnement Auth, jamais de fetchMeOnce(), jamais de boucle 401.
  useEffect(() => {
    let active = true;
    const subscription = authPort.onAuthStateChange((change) => {
      if (active) applyAuthChange(change);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [authPort, applyAuthChange]);

  // Chargement unique des formules + alimentation du cache partagé
  // `planById()` (vitrine, Abonnement, demandes de changement de formule).
  useEffect(() => {
    let active = true;
    adapter.listPlans().then((loaded) => {
      if (!active) return;
      setPlansCache(loaded);
      setPlans(loaded);
      setPlansError(null);
    }, (error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : 'Lecture des formules impossible.';
      setPlansCache([]);
      setPlans([]);
      setPlansError(message);
      notify('error', `Formules et tarifs indisponibles : ${message}`);
    });
    return () => { active = false; };
  }, [adapter, notify]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('washguard.theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  const onboarding = useMemo(() => computeOnboarding(state), [state]);
  const missing = useMemo(() => missingRequired(state), [state]);

  /** Toutes les écritures métier passent par ce garde. */
  const assertActivated = useCallback(() => {
    const s = stateRef.current;
    if (!s.station?.activated) {
      throw new ApiError(
        'onboarding_incomplete',
        'La station n’est pas encore activée : les fiches, encaissements, la caisse et les dépenses sont bloqués.',
        missingRequired(s)
      );
    }
  }, []);

  /** Mutation simple, avec journalisation optionnelle. */
  const mutate = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), []);

  // ── Prompt 05 + 06 : boards serveur et commandes RPC ───────────────────────
  const refreshFinance = useCallback(async (from?: string, to?: string): Promise<void> => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = from ?? financePeriod.current?.start ?? `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
    const endStr = to ?? financePeriod.current?.end ?? todayISO();
    validatePeriod(start, endStr, 366);
    if (from !== undefined || to !== undefined) financePeriod.current = { start, end: endStr };
    if (!serverFinance) {
      setState((cur) => withFinanceDefaults({ ...cur, profitability: localProfitability(cur, start, endStr) }));
      return;
    }
    const stationId = scopeRef.current.stationId;
    if (!authReady || !identity || !stationId || !identity.permissions.some((p) =>
      ['reports.view', 'cash.open', 'cash.close', 'cash.reopen', 'expenses.create', 'expenses.cancel', 'commissions.view'].includes(p))) return;
    const current = beginRequest('finance');
    try {
      const [board, report] = await Promise.all([
        adapter.listFinanceBoard(stationId),
        identity.permissions.includes('reports.view') ? adapter.listProfitability(start, endStr, stationId) : Promise.resolve(null),
      ]);
      if (!current()) return;
      setState((cur) => {
        if (!current()) return cur;
        return withStockDefaults(withFinanceDefaults({ ...cur, ...board, profitability: report }));
      });
    } catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverFinance, authReady, identity, state.station?.id]);

  const refreshWashes = useCallback(async (expectedPayment?: { washId: string; key: string }): Promise<void> => {
    if (!serverWash) {
      const board = await adapter.listWashBoard();
      setState((cur) => ({ ...cur, washes: board.washes, washPosts: board.posts }));
      return;
    }
    const stationId = scopeRef.current.stationId;
    if (!authReady || !identity || !stationId || !identity.permissions.includes('washes.view')) {
      if (expectedPayment) throw new Error('Lecture de la fiche non autorisée.');
      return;
    }
    const current = beginRequest('washes');
    try {
      const [board, catalog, clients, assignable] = await Promise.all([
        adapter.listWashBoard(stationId), adapter.listCatalog(stationId), adapter.listClients(stationId),
        identity.permissions.includes('washes.assign') ? adapter.listAssignableUsers(stationId) : Promise.resolve([]),
      ]);
      if (!current()) {
        if (expectedPayment) throw new Error('Lecture de la fiche dépassée par une autre actualisation.');
        return;
      }
      if (expectedPayment && !board.washes.find((wash) => wash.id === expectedPayment.washId)
        ?.payments.some((payment) => payment.idempotencyKey === expectedPayment.key)) {
        throw new Error('Paiement absent de la lecture de la fiche.');
      }
      const projected = mapCatalogToState(catalog);
      setAssignableUsers(assignable);
      setState((cur) => {
        if (!current()) return cur;
        return { ...cur, washes: board.washes, washPosts: board.posts,
          vehicleCategories: projected.vehicleCategories, services: projected.services,
          // La liste lavage fait autorité pour l'appartenance à cette station ;
          // les champs CRM supplémentaires déjà chargés restent disponibles.
          clients: clients.map((client) => ({ ...cur.clients.find((x) => x.id === client.id), ...client })) };
      });
    } catch (error) { if (current() || expectedPayment) throw error; }
  }, [adapter, beginRequest, serverWash, authReady, identity, state.station?.id]);

  const refreshStationMetrics = useCallback(async (start: string, end: string): Promise<void> => {
    validatePeriod(start, end, 92);
    const stationId = scopeRef.current.stationId;
    if (!serverWash || !authReady || !identity || !stationId || !identity.permissions.includes('washes.view')) return;
    const current = beginRequest('stationMetrics');
    setStationMetrics(null);
    setStationMetricsError(null);
    try {
      const metrics = await adapter.listStationMetrics(stationId, start, end);
      if (current()) setStationMetrics(metrics);
    } catch (error) {
      if (current()) {
        setStationMetricsError(error instanceof Error ? error.message : 'Indicateurs indisponibles.');
        throw error;
      }
    }
  }, [adapter, beginRequest, serverWash, authReady, identity, state.station?.id]);

  const refreshStock = useCallback(async (): Promise<void> => {
    if (!serverStock) { setState((cur) => withStockDefaults(cur)); return; }
    const stationId = scopeRef.current.stationId;
    if (!authReady || !identity || !stationId || !identity.permissions.includes('inventory.view')) return;
    const current = beginRequest('stock');
    try {
      const board: StockSnapshot = await adapter.listStockBoard(stationId);
      if (current()) setState((cur) => current() ? withStockDefaults({ ...cur, ...board }) : cur);
    } catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverStock, authReady, identity, state.station?.id]);

  const refreshCrm = useCallback(async (): Promise<void> => {
    if (!serverCrm) {
      setState((cur) => {
        const board = crmBoardFromState(cur);
        return withCrmDefaults({
          ...cur,
          clients: board.clients, vehicles: board.vehicles,
          loyaltyPrograms: board.loyaltyPrograms,
          loyaltyCards: board.loyaltyCards,
          loyaltyTransactions: board.loyaltyTransactions,
          packagePlans: board.packagePlans,
          customerPackages: board.customerPackages,
          packageUsages: board.packageUsages,
          promotions: board.promotions,
          promotionUsages: board.promotionUsages,
          fleets: board.fleets,
          fleetContracts: board.fleetContracts,
          fleetVehicles: board.fleetVehicles,
          fleetReceivables: board.fleetReceivables,
          notificationOutbox: board.notificationOutbox,
          crmStats: board.stats, crmRules: board.rules,
        });
      });
      return;
    }
    const stationId = scopeRef.current.stationId;
    if (!authReady || !identity || !stationId || !identity.permissions.some((p) =>
      ['crm.view', 'customers.view', 'loyalty.view', 'packages.view', 'promotions.view', 'fleets.view'].includes(p))) return;
    const current = beginRequest('crm');
    try {
      const board: CrmSnapshot = await adapter.listCrmBoard(stationId);
      if (!current()) return;
      setState((cur) => current() ? withCrmDefaults({
      ...cur,
      clients: board.clients, vehicles: board.vehicles,
      loyaltyPrograms: board.loyaltyPrograms,
      loyaltyCards: board.loyaltyCards,
      loyaltyTransactions: board.loyaltyTransactions,
      packagePlans: board.packagePlans,
      customerPackages: board.customerPackages,
      packageUsages: board.packageUsages,
      promotions: board.promotions,
      promotionUsages: board.promotionUsages,
      fleets: board.fleets,
      fleetContracts: board.fleetContracts,
      fleetVehicles: board.fleetVehicles,
      fleetReceivables: board.fleetReceivables,
      notificationOutbox: board.notificationOutbox,
      crmStats: board.stats, crmRules: board.rules,
      }) : cur);
    } catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverCrm, authReady, identity, state.station?.id]);

  const refreshAnalytics = useCallback(async (
    start: string = monthStartISO(), end: string = todayISO(),
    compareStart: string | null = null, compareEnd: string | null = null,
  ): Promise<void> => {
    try {
      validatePeriod(start, end, 92);
      if ((compareStart === null) !== (compareEnd === null)) throw new Error('Période de comparaison incomplète.');
      if (compareStart && compareEnd) validatePeriod(compareStart, compareEnd, 92);
    } catch (error) {
      setAnalyticsError(error instanceof Error ? error.message : 'Période invalide.');
      throw error;
    }
    setAnalyticsError(null);
    if (!serverAnalytics) {
      setAnalyticsBoard(analyticsBoardFromState(stateRef.current, start, end, compareStart, compareEnd));
      setAnalyticsError(null); return;
    }
    if (!authReady || !identity || !identity.permissions.includes('analytics.view') || !identity.permissions.includes('reports.view')) return;
    const current = beginRequest('analytics');
    try {
      const board = await adapter.listAnalyticsBoard(start, end, compareStart, compareEnd);
      if (current()) { setAnalyticsBoard(board); setAnalyticsError(null); }
    } catch (error) {
      if (current()) {
        setAnalyticsError(error instanceof Error ? error.message : 'Lecture analytics impossible.');
        throw error;
      }
    }
  }, [adapter, beginRequest, serverAnalytics, authReady, identity, state.station?.id]);

  const refreshSubscriptionUsage = useCallback(async (periodStart: string = monthStartISO()): Promise<void> => {
    if (!serverAnalytics) {
      const usage = subscriptionUsageFromState(stateRef.current, periodStart);
      setSubscriptionUsage(usage); setPlatformBoard(platformBoardFromState(stateRef.current, getPlans())); return;
    }
    if (!authReady || !identity) return;
    const current = beginRequest('subscription');
    try { const usage = await adapter.listSubscriptionUsage(periodStart); if (current()) setSubscriptionUsage(usage); }
    catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverAnalytics, authReady, identity, state.station?.id]);

  const refreshPlatform = useCallback(async (): Promise<void> => {
    if (!serverAnalytics) { setPlatformBoard(platformBoardFromState(stateRef.current, getPlans())); setPlatformError(null); return; }
    if (!authReady || !identity?.isPlatformAdmin) return;
    const current = beginRequest('platform');
    try { const board = await adapter.listPlatformBoard(); if (current()) { setPlatformBoard(board); setPlatformError(null); } }
    catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverAnalytics, authReady, identity, state.station?.id]);

  const refreshUsageCounters = useCallback(async (periodStart: string = monthStartISO()): Promise<void> => {
    if (serverAnalytics && authReady && identity?.isPlatformAdmin && adapter.analyticsCommands) {
      await adapter.analyticsCommands.refreshSubscriptionUsage(periodStart);
    }
    await refreshSubscriptionUsage(periodStart);
    await refreshPlatform();
  }, [adapter, serverAnalytics, authReady, identity?.userId, identity?.isPlatformAdmin, refreshSubscriptionUsage, refreshPlatform]);

  const vehicleHistory = useCallback(async (plate: string): Promise<Wash[]> => {
    const key = plate.trim().toUpperCase();
    if (!key) return [];
    if (serverWash && adapter.washCommands) {
      const stationId = scopeRef.current.stationId;
      if (!stationId) return [];
      const epoch = scopeRef.current.epoch;
      const rows = await adapter.washCommands.vehicleHistory(key, stationId);
      return epoch === scopeRef.current.epoch ? rows : [];
    }
    return stateRef.current.washes
      .filter((w) => w.plate.trim().toUpperCase() === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [adapter, serverWash]);

  // Un seul chargement du board par session Supabase (pas de boucle de RPC).
  useEffect(() => {
    if (!serverWash || !authReady || !identity) return;
    void refreshWashes().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Lecture des lavages impossible.';
      notify('error', `File d’attente indisponible : ${message}`);
    });
  }, [serverWash, authReady, identity?.userId, refreshWashes, notify]);

  // P06 : lecture initiale de la caisse, des canaux et de la rentabilité. Une
  // session non vérifiée ne déclenche aucun RPC ; les erreurs sont notifiées.
  useEffect(() => {
    if (!serverFinance || !authReady || !identity) return;
    void refreshFinance().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Lecture finance impossible.';
      notify('error', `Finance indisponible : ${message}`);
    });
  }, [serverFinance, authReady, identity?.userId, refreshFinance, notify]);

  // P07 : lecture initiale du board stock. Aucun RPC sans session vérifiée.
  useEffect(() => {
    if (!serverStock || !authReady || !identity) return;
    void refreshStock().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Lecture du stock impossible.';
      notify('error', `Stock indisponible : ${message}`);
    });
  }, [serverStock, authReady, identity?.userId, refreshStock, notify]);

  // P08 : lecture initiale du board CRM. Aucun RPC sans session vérifiée.
  useEffect(() => {
    if (!serverCrm || !authReady || !identity) return;
    void refreshCrm().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Lecture du CRM impossible.';
      notify('error', `CRM indisponible : ${message}`);
    });
  }, [serverCrm, authReady, identity?.userId, refreshCrm, notify]);

  // La page Consolidation demande explicitement sa période : ne pas lancer
  // ici une lecture par défaut qui pourrait supplanter sa demande en vol.
  useEffect(() => {
    if (serverAnalytics && (!authReady || !identity?.isPlatformAdmin)) return;
    void refreshPlatform().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Lecture plateforme impossible.';
      setPlatformError(message);
      notify('error', `Back-office indisponible : ${message}`);
    });
  }, [serverAnalytics, authReady, identity?.userId, identity?.isPlatformAdmin, refreshPlatform, notify]);

  useEffect(() => {
    if (serverAnalytics && (!authReady || !identity)) return;
    void refreshSubscriptionUsage().catch((error: unknown) => {
      notify('error', `Quotas indisponibles : ${error instanceof Error ? error.message : 'erreur'}`);
    });
  }, [serverAnalytics, authReady, identity?.userId, refreshSubscriptionUsage, notify]);

  const rpc = useCallback(<T,>(action: (c: NonNullable<DataAdapter['washCommands']>) => Promise<T>): Promise<T> => {
    const commands = adapter.washCommands;
    if (!commands) return Promise.reject(new ApiError('server_unavailable', 'Commande serveur indisponible en mode local.'));
    const epoch = scopeRef.current.epoch;
    return action(commands).then(async (value) => {
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshWashes();
      if (scopeRef.current.epoch !== epoch) return value;
      if (serverFinance) {
        await refreshFinance().catch((error: unknown) => {
          notify('error', `Actualisation finance : ${error instanceof Error ? error.message : 'erreur'}`);
        });
      }
      return value;
    });
  }, [adapter, refreshWashes, refreshFinance, serverFinance, notify]);

  const financeRpc = useCallback(<T,>(
    action: (c: NonNullable<DataAdapter['financeCommands']>) => Promise<T>
  ): Promise<T> => {
    const commands = adapter.financeCommands;
    if (!commands) return Promise.reject(new ApiError('server_unavailable', 'Commande finance indisponible en mode local.'));
    const epoch = scopeRef.current.epoch;
    return action(commands).then(async (value) => {
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshWashes();
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshFinance().catch((error: unknown) => {
        notify('error', `Actualisation finance : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      return value;
    });
  }, [adapter, refreshWashes, refreshFinance, notify]);

  const stockRpc = useCallback(<T,>(
    action: (c: NonNullable<DataAdapter['stockCommands']>) => Promise<T>
  ): Promise<T> => {
    const commands = adapter.stockCommands;
    if (!commands) return Promise.reject(new ApiError('server_unavailable', 'Commande stock indisponible en mode local.'));
    const epoch = scopeRef.current.epoch;
    return action(commands).then(async (value) => {
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshStock().catch((error: unknown) => {
        notify('error', `Actualisation stock : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      if (scopeRef.current.epoch !== epoch) return value;
      if (serverFinance) {
        await refreshFinance().catch((error: unknown) => {
          notify('error', `Actualisation finance : ${error instanceof Error ? error.message : 'erreur'}`);
        });
      }
      return value;
    });
  }, [adapter, refreshStock, refreshFinance, serverFinance, notify]);

  const crmRpc = useCallback(<T,>(
    action: (c: NonNullable<DataAdapter['crmCommands']>) => Promise<T>
  ): Promise<T> => {
    const commands = adapter.crmCommands;
    if (!commands) return Promise.reject(new ApiError('server_unavailable', 'Commande CRM indisponible en mode local.'));
    const epoch = scopeRef.current.epoch;
    return action(commands).then(async (value) => {
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshCrm().catch((error: unknown) => {
        notify('error', `Actualisation CRM : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshWashes().catch((error: unknown) => {
        notify('error', `Actualisation lavages : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      return value;
    });
  }, [adapter, refreshCrm, refreshWashes, notify]);

  const analyticsRpc = useCallback(<T,>(
    action: (c: NonNullable<DataAdapter['analyticsCommands']>) => Promise<T>
  ): Promise<T> => {
    const commands = adapter.analyticsCommands;
    if (!commands) return Promise.reject(new ApiError('server_unavailable', 'Commande plateforme indisponible en mode local.'));
    const epoch = scopeRef.current.epoch;
    return action(commands).then(async (value) => {
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshPlatform().catch((error: unknown) => {
        notify('error', `Actualisation plateforme : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      if (scopeRef.current.epoch !== epoch) return value;
      await refreshSubscriptionUsage().catch((error: unknown) => {
        notify('error', `Actualisation quotas : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      return value;
    });
  }, [adapter, refreshPlatform, refreshSubscriptionUsage, notify]);

  const crmLocal = useCallback(<T,>(fn: (s: AppState) => CrmMutation<T>): T => {
    const result = fn(stateRef.current);
    // Une deuxième commande locale dans le même événement doit voir la première.
    stateRef.current = result.state;
    setState(result.state);
    return result.value;
  }, []);

  const assertSelectedStation = useCallback((stationId: string) => {
    if (!stationId || stationId !== stateRef.current.station?.id
      || (authPort.kind === 'supabase' && stationId !== scopeRef.current.stationId)) {
      throw new ApiError('station_changed', 'Cette opération ne concerne pas la station sélectionnée.');
    }
  }, [authPort.kind]);

  // ── Prompt 08 : 17 actions, sync locales ou RPC serveur ────────────────────
  const saveCustomerProfile = useCallback((p: CustomerProfilePayload) => {
    assertSelectedStation(p.stationId); validateCustomer(p);
    return serverCrm ? crmRpc((c) => c.saveCustomerProfile(p))
      : crmLocal((s) => saveCustomerProfileLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const saveCustomerVehicle = useCallback((p: CustomerVehiclePayload) => {
    assertSelectedStation(p.stationId); validatePlate(p.plate);
    return serverCrm ? crmRpc((c) => c.saveCustomerVehicle(p))
      : crmLocal((s) => saveCustomerVehicleLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const createLoyaltyProgram = useCallback((p: LoyaltyProgramPayload) => {
    assertSelectedStation(p.stationId); validateQuantity(p.pointsPer1000Minor); validateQuantity(p.redemptionThreshold);
    return serverCrm ? crmRpc((c) => c.createLoyaltyProgram(p))
      : crmLocal((s) => createLoyaltyProgramLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const enrollLoyaltyCustomer = useCallback((p: LoyaltyEnrollmentPayload) => {
    assertSelectedStation(p.stationId);
    return serverCrm ? crmRpc((c) => c.enrollLoyaltyCustomer(p))
      : crmLocal((s) => enrollLoyaltyCustomerLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const recordLoyaltyTransaction = useCallback((p: LoyaltyTransactionPayload) => {
    validateQuantity(Math.abs(p.pointsDelta));
    if ((p.kind === 'earn' && p.pointsDelta <= 0) || (p.kind === 'redeem' && p.pointsDelta >= 0)) throw new ApiError('invalid_points', 'Sens des points invalide.');
    return serverCrm ? crmRpc((c) => c.recordLoyaltyTransaction(p))
      : crmLocal((s) => recordLoyaltyTransactionLocal(s, p));
  }, [serverCrm, crmRpc, crmLocal]);
  const accrueLoyaltyForWash = useCallback((washId: string, key?: string | null) =>
    serverCrm ? crmRpc((c) => c.accrueLoyaltyForWash(washId, key))
      : crmLocal((s) => accrueLoyaltyForWashLocal(s, washId, key)), [serverCrm, crmRpc, crmLocal]);
  const savePackagePlan = useCallback((p: PackagePlanPayload) => {
    assertSelectedStation(p.stationId); validatePackage(p);
    return serverCrm ? crmRpc((c) => c.savePackagePlan(p))
      : crmLocal((s) => savePackagePlanLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const sellPackageToCustomer = useCallback((p: PackageSalePayload) => {
    assertSelectedStation(p.stationId); if (p.purchasedAt) validateDate(p.purchasedAt);
    return serverCrm ? crmRpc((c) => c.sellPackageToCustomer(p))
      : crmLocal((s) => sellPackageToCustomerLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const consumePackageForWash = useCallback((washId: string) =>
    serverCrm ? crmRpc((c) => c.consumePackageForWash(washId))
      : crmLocal((s) => consumePackageForWashLocal(s, washId)), [serverCrm, crmRpc, crmLocal]);
  const savePromotion = useCallback((p: PromotionPayload) => {
    assertSelectedStation(p.stationId); validatePromotion(p);
    return serverCrm ? crmRpc((c) => c.savePromotion(p))
      : crmLocal((s) => savePromotionLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const applyPromotionToWash = useCallback((p: PromotionApplicationPayload) =>
    serverCrm ? crmRpc((c) => c.applyPromotionToWash(p))
      : crmLocal((s) => applyPromotionToWashLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const saveFleet = useCallback((p: FleetPayload) => {
    assertSelectedStation(p.stationId); validateFleet(p);
    return serverCrm ? crmRpc((c) => c.saveFleet(p))
      : crmLocal((s) => saveFleetLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const saveFleetContract = useCallback((p: FleetContractPayload) => {
    assertSelectedStation(p.stationId); validateFleetContract(p);
    return serverCrm ? crmRpc((c) => c.saveFleetContract(p))
      : crmLocal((s) => saveFleetContractLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const attachFleetVehicle = useCallback((p: AttachFleetVehiclePayload) => {
    assertSelectedStation(p.stationId);
    return serverCrm ? crmRpc((c) => c.attachFleetVehicle(p))
      : crmLocal((s) => attachFleetVehicleLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const recordFleetReceivable = useCallback((p: FleetReceivablePayload) => {
    assertSelectedStation(p.stationId); validateFleetReceivable(p);
    return serverCrm ? crmRpc((c) => c.recordFleetReceivable(p))
      : crmLocal((s) => recordFleetReceivableLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const enqueueNotification = useCallback((p: NotificationPayload) => {
    assertSelectedStation(p.stationId);
    return serverCrm ? crmRpc((c) => c.enqueueNotification(p))
      : crmLocal((s) => enqueueNotificationLocal(s, p));
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal]);
  const cancelPendingNotification = useCallback((id: string) =>
    serverCrm ? crmRpc((c) => c.cancelPendingNotification(id))
      : crmLocal((s) => cancelPendingNotificationLocal(s, id)), [serverCrm, crmRpc, crmLocal]);

  // ── Auth : délégation au port, aucune session forgée ───────────────────────
  const signUp = useCallback(async (p: SignUpPayload): Promise<AuthResult> => {
    const result = await authPort.signUp(p);
    if (!result.confirmationRequired) notify('success', 'Votre espace est prêt. Bienvenue !');
    return result;
  }, [authPort, notify]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const result = await authPort.signIn(email, password);
    notify('success', `Bonjour ${result.identity?.fullName ?? ''} !`);
    return result;
  }, [authPort, notify]);

  const signOut = useCallback(async (): Promise<void> => {
    {
      authGenerationRef.current += 1;
      authKeyRef.current = 'signed-out';
      scopeRef.current = { epoch: scopeRef.current.epoch + 1, userId: null, companyId: null, stationId: null };
      setAuthReady(true);
      setState((s) => authPort.kind === 'supabase' ? emptyState() : { ...s, session: null });
      setAssignableUsers([]); setStationMetrics(null); setStationMetricsError(null);
      setAnalyticsBoard(emptyAnalyticsBoard()); setSubscriptionUsage(emptySubscriptionUsage()); setPlatformBoard(emptyPlatformBoard());
      setIdentity(null);
      setInvitations([]);
      setAuthRecovery(false);
      setAuthError(null);
      setToasts([]);
    }
    await authPort.signOut();
  }, [authPort]);

  const requestPasswordReset = useCallback((email: string) =>
    authPort.requestPasswordReset(email), [authPort]);

  const updatePassword = useCallback(async (password: string) => {
    await authPort.updatePassword(password);
    setAuthRecovery(false);
  }, [authPort]);

  const inviteUser = useCallback(async (p: InvitePayload) => {
    const result = await authPort.invite(p);
    await Promise.all([refreshUsers(), refreshInvitations()]);
    notify('success', result.message ?? 'Invitation envoyée.');
    return result;
  }, [authPort, refreshUsers, refreshInvitations, notify]);

  const revokeInvitation = useCallback(async (id: string) => {
    await authPort.revokeInvitation(id);
    await refreshInvitations();
    notify('info', 'Invitation révoquée.');
  }, [authPort, refreshInvitations, notify]);

  const updateUser = useCallback(async (p: UpdateUserPayload) => {
    await authPort.updateUser(p);
    await refreshUsers();
    notify('success', 'Compte mis à jour.');
  }, [authPort, refreshUsers, notify]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  // ── Données de base ────────────────────────────────────────────────────────
  const updateCompany = useCallback((patch: Partial<Company>) => {
    if (patch.phone !== undefined) validatePhone(patch.phone);
    return mutate((s) => {
    if (!s.company) return s;
    const company = { ...s.company, ...patch };
    return {
      ...s, company,
      platformCompanies: s.platformCompanies.map((c) => c.id === company.id ? {
        ...c, name: company.name, city: company.city, phone: company.phone,
      } : c),
      auditLogs: logAction(s, 'Entreprise modifiée', Object.keys(patch).join(', ')),
    };
    });
  }, [mutate]);

  const updateStation = useCallback((patch: Partial<Station>) => {
    if (patch.phone !== undefined) validatePhone(patch.phone);
    if (patch.maxCashierDiscount !== undefined) validateMoney(patch.maxCashierDiscount);
    if (patch.monthlyTarget !== undefined) validateMoney(patch.monthlyTarget);
    if (patch.commissionRate !== undefined) validatePercentage(patch.commissionRate);
    return mutate((s) => {
    if (!s.station) return s;
    return {
      ...s, station: { ...s.station, ...patch },
      auditLogs: logAction(s, 'Station modifiée', Object.keys(patch).join(', ')),
    };
    });
  }, [mutate]);

  // Une requête terminée après un changement de session ne doit pas modifier
  // la station d'un autre utilisateur.
  const setStationLogoPath = useCallback((stationId: string, userId: string, path: string | null) => mutate((s) => {
    if (!s.station || s.station.id !== stationId || s.session?.userId !== userId
      || s.session.stationId !== stationId || s.station.companyId !== s.session.companyId
      || (path !== null && (!isStationLogoPath(path) || !path.startsWith(`${s.station.companyId}/`)))) return s;
    return {
      ...s, station: { ...s.station, logoPath: path },
      auditLogs: logAction(s, 'Logo de la station modifié', 'logoPath'),
    };
  }), [mutate]);

  const setHours = useCallback((hours: DayHours[]) => mutate((s) =>
    s.station ? { ...s, station: { ...s.station, hours } } : s
  ), [mutate]);

  const addCategory = useCallback((name: string) => mutate((s) => {
    if (!s.station || !name.trim()) return s;
    const cat: VehicleCategory = { id: uid('cat'), stationId: s.station.id, name: name.trim(), active: true };
    return { ...s, vehicleCategories: [...s.vehicleCategories, cat] };
  }), [mutate]);

  const toggleCategory = useCallback((id: string) => mutate((s) => ({
    ...s, vehicleCategories: s.vehicleCategories.map((c) => c.id === id ? { ...c, active: !c.active } : c),
  })), [mutate]);

  const removeCategory = useCallback((id: string) => mutate((s) => ({
    ...s, vehicleCategories: s.vehicleCategories.filter((c) => c.id !== id),
  })), [mutate]);

  const addService = useCallback((name: string, description: string) => mutate((s) => {
    if (!s.station || !name.trim()) return s;
    const svc: Service = {
      id: uid('svc'), stationId: s.station.id, name: name.trim(),
      description: description.trim(), active: true, prices: {},
    };
    return { ...s, services: [...s.services, svc] };
  }), [mutate]);

  const updateService = useCallback((id: string, patch: Partial<Service>) => mutate((s) => ({
    ...s, services: s.services.map((v) => v.id === id ? { ...v, ...patch } : v),
  })), [mutate]);

  const setPrice = useCallback((serviceId: string, categoryId: string, price: number) => {
    validateMoney(price);
    mutate((s) => ({ ...s, services: s.services.map((v) => v.id === serviceId
      ? { ...v, prices: { ...v.prices, [categoryId]: price } } : v) }));
  }, [mutate]);

  const removeService = useCallback((id: string) => mutate((s) => ({
    ...s, services: s.services.filter((v) => v.id !== id),
  })), [mutate]);

  const updateEmployee = useCallback((id: string, patch: Partial<AppUser>) => mutate((s) => {
    const next = { ...s, users: s.users.map((u) => u.id === id ? { ...u, ...patch } : u) };
    return { ...next, auditLogs: logAction(next, 'Employé modifié', `${id} : ${Object.keys(patch).join(', ')}`) };
  }), [mutate]);

  const addClient = useCallback((p: { name: string; phone: string; plate: string; notes: string }) => mutate((s) => {
    if (!s.station || !p.name.trim()) return s;
    const c: Client = {
      id: uid('cli'), stationId: s.station.id, name: p.name.trim(),
      phone: p.phone.trim(), plate: p.plate.trim(), notes: p.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    return { ...s, clients: [c, ...s.clients] };
  }), [mutate]);

  const updateClient = useCallback((id: string, p: Partial<Client>) => mutate((s) => ({
    ...s, clients: s.clients.map((c) => c.id === id ? { ...c, ...p } : c),
  })), [mutate]);

  // ── Exploitation ───────────────────────────────────────────────────────────
  const assertCashRule = useCallback((method: PayMethod, amount: number) => {
    const s = stateRef.current;
    if (method === 'especes' && amount > 0 && s.station?.cashRequiresOpen && !s.cashSessions.some((c) => c.status === 'ouverte')) {
      throw new ApiError('cash_closed', 'Un encaissement en espèces exige une caisse ouverte (règle désactivable dans Paramètres).');
    }
  }, []);

  const submitPendingWash = useCallback(async (pending: PendingWashCreation, recovering: boolean): Promise<string> => {
    const commands = adapter.washCommands;
    if (!serverWash || !commands || identity?.userId !== pending.userId
      || stateRef.current.station?.id !== pending.stationId) {
      throw new ApiError('server_unavailable', 'Cette tentative exige la même session et la même station connectées.');
    }
    const lock = `${pending.userId}:${pending.stationId}`;
    const epoch = scopeRef.current.epoch;
    const current = () => scopeRef.current.epoch === epoch;
    if (washCreationInFlight.current.has(lock)) {
      throw new ApiError('wash_in_flight', 'Une création de fiche est déjà en cours.');
    }
    washCreationInFlight.current.add(lock);
    try {
      let id: string;
      try {
        id = await commands.createWash(pending.payload);
      } catch (error) {
        // Un refus explicite au premier appel prouve le rollback. Après une
        // réponse incertaine, même un refus ultérieur peut venir d'une perte de
        // permission : conserver la clé jusqu'à une confirmation positive.
        if (!recovering && error instanceof WashCreationError && error.outcome === 'rejected') {
          try {
            clearPendingWash(pending);
            if (current()) setPendingWashState(null);
          } catch {
            if (current()) setPendingWashState(pending);
            if (current()) notify('error', 'La tentative n’a pas pu être effacée de cet onglet ; vérifiez-la avant de continuer.');
          }
        } else {
          if (current()) setPendingWashState(pending);
        }
        throw error;
      }
      try {
        clearPendingWash(pending);
        if (current()) {
          setPendingWashState((previous) => previous?.payload.idempotencyKey === pending.payload.idempotencyKey ? null : previous);
          setPendingWashError(null);
        }
      } catch {
        // La réponse est un succès ; garder la clé si son effacement échoue.
        if (current()) setPendingWashState(pending);
        if (current()) notify('error', 'Fiche confirmée, mais la tentative reste conservée dans cet onglet.');
      }
      // Un échec de relecture ne transforme pas une écriture confirmée en
      // échec de création et ne doit pas inviter à créer une seconde fiche.
      if (!current()) return id;
      await refreshWashes().catch((error: unknown) => {
        if (current()) notify('error', `Fiche enregistrée, mais actualisation des lavages impossible : ${error instanceof Error ? error.message : 'erreur'}. Utilisez Actualiser.`);
      });
      if (current() && serverFinance) {
        await refreshFinance().catch((error: unknown) => {
          if (current()) notify('error', `Fiche enregistrée, mais actualisation finance impossible : ${error instanceof Error ? error.message : 'erreur'}.`);
        });
      }
      if (current()) notify('success', `Fiche ${id.slice(0, 8)} enregistrée par le serveur.`);
      return id;
    } finally {
      washCreationInFlight.current.delete(lock);
    }
  }, [adapter, identity?.userId, notify, refreshFinance, refreshWashes, serverFinance, serverWash]);

  const retryPendingWash = useCallback(async (): Promise<void> => {
    const stationId = stateRef.current.station?.id;
    if (!serverWash || !identity?.userId || !stationId) {
      throw new ApiError('server_unavailable', 'Reconnectez-vous avec le même compte et la même station pour vérifier la tentative.');
    }
    const pending = readPendingWash(identity.userId, stationId);
    if (!pending) throw new ApiError('not_found', 'Aucune tentative conservée dans cet onglet. Vérifiez les fiches avant de continuer.');
    await submitPendingWash(pending, true);
  }, [identity?.userId, serverWash, submitPendingWash]);

  const createWash = useCallback((p: WashPayload): Wash | Promise<Wash> => {
    assertActivated();
    const s = stateRef.current;
    const st = s.station!;
    const cats = s.vehicleCategories.filter((c) => c.active);
    const cat = cats.find((c) => c.id === p.categoryId);
    if (!cat) throw new ApiError('invalid_category', 'Choisissez une catégorie de véhicule.');
    const employeeIds = Array.from(new Set(
      (p.employeeIds?.length ? p.employeeIds : [p.employeeId]).filter((id) => Boolean(id))
    ));
    if (p.items.length === 0) throw new ApiError('empty_items', 'Ajoutez au moins une prestation.');
    if (p.items.some((item) => !Number.isSafeInteger(item.qty) || item.qty < 1)) {
      throw new ApiError('invalid_quantity', 'Les quantités doivent être des nombres entiers positifs.');
    }
    if (!Number.isSafeInteger(p.discount) || p.discount < 0) {
      throw new ApiError('invalid_discount', 'La remise doit être un montant entier positif ou nul.');
    }
    if (p.payment && (!Number.isSafeInteger(p.payment.amount) || p.payment.amount < 0
      || !Object.prototype.hasOwnProperty.call(PAY_METHOD_DB_KEY, p.payment.method))) {
      throw new ApiError('invalid_payment', 'Le montant ou le moyen de paiement est invalide.');
    }
    const gross = p.items.reduce((sum, item) => {
      const service = s.services.find((v) => v.id === item.serviceId && v.active && v.stationId === st.id);
      if (!service) throw new ApiError('invalid_service', 'Une prestation sélectionnée n’est plus disponible.');
      const price = service.prices[cat.id] ?? 0;
      if (!Number.isSafeInteger(price) || price <= 0) throw new ApiError('missing_price', `Aucun prix défini pour « ${service.name} » / ${cat.name}.`);
      return sum + price * item.qty;
    }, 0);
    validateWash(p, gross);
    const discount = p.discount;
    if (s.session?.role === 'caissier' && discount > st.maxCashierDiscount) {
      throw new ApiError('discount_exceeded', `Remise maximale autorisée pour un caissier : ${st.maxCashierDiscount} FCFA.`);
    }

    // Mode Supabase : une transaction serveur relit les prix, crée la fiche et
    // encaisse éventuellement. La commande exacte est conservée AVANT l'envoi.
    if (serverWash) {
      if (!identity?.userId) throw new ApiError('server_unavailable', 'Session connectée requise pour créer une fiche.');
      if (washCreationInFlight.current.has(`${identity.userId}:${st.id}`)) throw new ApiError('wash_in_flight', 'Une création de fiche est déjà en cours.');
      const previous = readPendingWash(identity.userId, st.id);
      if (previous) {
        setPendingWashState(previous);
        throw new ApiError('wash_pending', 'Une tentative précédente doit être vérifiée avant une nouvelle fiche.');
      }
      const payload = {
        stationId: st.id, categoryId: cat.id, plate: p.plate.trim(),
        clientId: p.clientId || null, clientName: p.clientName.trim(),
        items: p.items.map((it) => ({ serviceId: it.serviceId, qty: it.qty })),
        discount, employeeIds, postId: p.postId ?? null, idempotencyKey: idempotencyKey('ui'),
        payment: p.payment && p.payment.amount > 0 ? { ...p.payment } : null,
      };
      const pending: PendingWashCreation = {
        version: 1, userId: identity.userId, stationId: st.id,
        startedAt: new Date().toISOString(), payload,
      };
      savePendingWash(pending);
      return submitPendingWash(pending, false).then((id) => ({
        id, stationId: st.id, number: '—', clientId: payload.clientId,
        clientName: payload.clientName || null, vehicleCategoryId: cat.id,
        vehicleLabel: cat.name, plate: payload.plate, employeeId: employeeIds[0],
        assignedUserIds: employeeIds, postId: payload.postId,
        items: [], discount, total: 0, paid: payload.payment?.amount ?? 0,
        status: employeeIds.length ? 'assigned' : 'pending',
        createdAt: new Date().toISOString(), finishedAt: null, deliveredAt: null,
        cancelledReason: null, payments: [], history: [], qualityResult: null, qualityNotes: null,
      } as Wash));
    }
    if (authPort.kind === 'supabase') {
      throw new ApiError('server_unavailable', 'Création serveur indisponible : aucune fiche locale n’a été enregistrée.');
    }

    // Mode local : le prix reste figé ici ; modifier la grille ne change JAMAIS
    // les lavages déjà enregistrés (test « prix inchangé après modification »).
    const items: WashItem[] = p.items.map((it) => {
      const svc = s.services.find((v) => v.id === it.serviceId && v.active);
      if (!svc) throw new ApiError('invalid_service', 'Une prestation sélectionnée n’est plus disponible.');
      const unitPrice = svc.prices[cat.id] ?? 0;
      if (unitPrice <= 0) throw new ApiError('missing_price', `Aucun prix défini pour « ${svc.name} » / ${cat.name}.`);
      return { serviceId: svc.id, serviceName: svc.name, unitPrice, qty: it.qty };
    });
    const total = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0) - discount;
    const payment = p.payment && p.payment.amount > 0 ? p.payment : null;
    if (payment) {
      assertCashRule(payment.method, payment.amount);
      if (payment.amount > total) throw new ApiError('overpayment', 'L’encaissement dépasse le montant de la fiche.');
    }
    const counter = s.washCounter + 1;
    const now = new Date().toISOString();
    const initialStatus: WashStatus = employeeIds.length ? 'assigned' : 'pending';
    const history: Wash['history'] = [
      washEvent(null, 'pending', 'Création de la fiche', now, s.session?.userId ?? null, uid('hist')),
    ];
    if (initialStatus === 'assigned') {
      history.push(washEvent('pending', 'assigned', 'Affectation initiale', now, s.session?.userId ?? null, uid('hist')));
    }
    const wash: Wash = {
      id: uid('wash'), stationId: st.id, number: `L-${String(counter).padStart(4, '0')}`,
      clientId: p.clientId || null,
      clientName: p.clientId
        ? s.clients.find((c) => c.id === p.clientId)?.name ?? null
        : p.clientName.trim() || null,
      vehicleCategoryId: cat.id, vehicleLabel: cat.name, plate: p.plate.trim(),
      employeeId: employeeIds[0], assignedUserIds: employeeIds, postId: p.postId ?? null,
      items, discount, total, paid: payment?.amount ?? 0,
      status: initialStatus, createdAt: now, finishedAt: null, deliveredAt: null,
      cancelledReason: null, history, qualityResult: null, qualityNotes: null,
      payments: payment ? [{
        id: uid('pay'), amount: payment.amount, method: payment.method, at: now,
        byUserId: s.session?.userId ?? 'inconnu',
      }] : [],
    };
    setState((cur0) => {
      const cur = withFinanceDefaults(cur0);
      const initial = wash.payments[0];
      // Le paiement saisi à la création doit alimenter le même journal que les
      // encaissements ultérieurs, sinon le théorique devient faux dès qu'un
      // autre mouvement existe pour cette caisse. Les autres canaux restent
      // hors caisse et aucune écriture n'est créée sans session ouverte.
      const cash = initial
        ? cashPaymentMovement(cur, wash.id, initial.id, initial.amount, initial.method, null, now)
        : null;
      return {
        ...cur, washes: [wash, ...cur.washes], washCounter: counter,
        cashMovements: cash ? [...cur.cashMovements, cash] : cur.cashMovements,
      };
    });
    notify('success', `Fiche ${wash.number} enregistrée — ${formatFCFA(total)}.`);
    return wash;
  }, [assertActivated, assertCashRule, authPort.kind, identity?.userId, notify, serverWash, submitPendingWash]);

  const setWashStatus = useCallback((id: string, status: WashStatus, reason?: string): void | Promise<void> => {
    assertActivated();
    const current = stateRef.current.washes.find((w) => w.id === id);
    if (!current) throw new ApiError('not_found', 'Fiche introuvable.');
    if (current.status === 'cancelled') throw new ApiError('wash_cancelled', 'Une fiche annulée ne peut plus changer de statut.');
    if (status === 'cancelled' && !(reason ?? '').trim()) {
      throw new ApiError('reason_required', 'Le motif d’annulation est obligatoire.');
    }
    if (serverWash) return rpc((c) => c.transitionStatus(id, status, reason ?? ''));
    if (!canTransitionWash(current.status, status)) {
      throw new ApiError('invalid_transition', `Transition ${current.status} → ${status} non autorisée par le cycle de lavage.`);
    }
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      washes: s.washes.map((w) => w.id === id ? {
        ...w, status,
        finishedAt: status === 'ready' ? now : w.finishedAt,
        deliveredAt: status === 'delivered' ? now : w.deliveredAt,
        cancelledReason: status === 'cancelled' ? (reason ?? 'Motif non précisé') : null,
        history: [...w.history, washEvent(w.status, status, reason ?? null, now, s.session?.userId ?? null, uid('hist'))],
      } : w),
    }));
  }, [assertActivated, adapter, serverWash, rpc]);

  const assignWash = useCallback((id: string, userIds: string[], postId: string | null = null): void | Promise<void> => {
    assertActivated();
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) throw new ApiError('invalid_employee', 'Choisissez au moins un employé.');
    const current = stateRef.current.washes.find((w) => w.id === id);
    if (!current) throw new ApiError('not_found', 'Fiche introuvable.');
    if (['ready', 'delivered', 'cancelled'].includes(current.status)) {
      throw new ApiError('invalid_transition', 'Affectation impossible sur une fiche terminée, livrée ou annulée.');
    }
    if (serverWash) return rpc((c) => c.assign(id, unique, postId));
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      washes: s.washes.map((w) => w.id === id ? {
        ...w, assignedUserIds: unique, employeeId: unique[0], postId,
        status: w.status === 'pending' ? 'assigned' : w.status,
        history: [...w.history, washEvent(
          w.status, w.status === 'pending' ? 'assigned' : w.status,
          'Affectation / réaffectation', now, s.session?.userId ?? null, uid('hist'),
        )],
      } : w),
    }));
    notify('success', `${unique.length} employé(s) affecté(s) à la fiche.`);
  }, [assertActivated, adapter, serverWash, rpc, notify]);

  const recordQualityCheck = useCallback((id: string, result: WashQualityResult, notes: string): void | Promise<void> => {
    assertActivated();
    const current = stateRef.current.washes.find((w) => w.id === id);
    if (!current) throw new ApiError('not_found', 'Fiche introuvable.');
    if (current.status !== 'quality_check') {
      throw new ApiError('invalid_transition', 'Le contrôle qualité n’est disponible qu’au statut « Contrôle qualité ».');
    }
    if (result === 'rejected' && !notes.trim()) {
      throw new ApiError('invalid_transition', 'Motif de reprise requis.');
    }
    if (serverWash) return rpc((c) => c.qualityCheck(id, result, notes.trim()));
    // UNIQUE exception à canTransitionWash() : quality_check → ready est
    // interdit dans WASH_STATUS_FLOW et dans transition_wash_status (023),
    // mais autorisé ici après une approbation explicite. Refus = reprise.
    const to: WashStatus = result === 'approved' ? 'ready' : 'in_progress';
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      washes: s.washes.map((w) => w.id === id ? {
        ...w, status: to, qualityResult: result, qualityNotes: notes.trim() || null,
        finishedAt: to === 'ready' ? now : w.finishedAt,
        history: [...w.history, washEvent(
          w.status, to,
          result === 'approved' ? 'Contrôle qualité validé' : `Contrôle qualité refusé : ${notes.trim() || 'reprise demandée'}`,
          now, s.session?.userId ?? null, uid('hist'),
        )],
      } : w),
    }));
    notify(result === 'approved' ? 'success' : 'info',
      result === 'approved' ? 'Contrôle qualité validé : fiche prête, pas encore livrée.' : 'Contrôle refusé : reprise en cours.');
  }, [assertActivated, adapter, serverWash, rpc, notify]);

  const createWashPost = useCallback((
    name: string, capacity = 1, stationId?: string | null
  ): void | Promise<void> => {
    assertActivated();
    const clean = name.trim();
    if (clean.length < 2) throw new ApiError('invalid_post', 'Nom de poste invalide.');
    validateQuantity(capacity);
    if (stationId) assertSelectedStation(stationId);
    if (serverWash) {
      return rpc((c) => c.createPost(
        clean, capacity, stationId ?? stateRef.current.station?.id ?? null
      ));
    }
    setState((s) => ({
      ...s,
      washPosts: [...s.washPosts, {
        id: uid('post'), stationId: s.station?.id ?? '',
        name: clean, capacity, active: true,
      }],
    }));
    notify('success', `Poste « ${clean} » créé.`);
  }, [assertActivated, assertSelectedStation, adapter, serverWash, rpc, notify]);

  const addPayment = useCallback((washId: string, amount: number, method: PayMethod, idempotencyKey?: string): void | Promise<void> => {
    assertActivated();
    const s = stateRef.current;
    const wash = s.washes.find((w) => w.id === washId);
    if (!wash) throw new ApiError('not_found', 'Fiche introuvable.');
    const amt = validateMoney(amount, true);
    if (!Object.prototype.hasOwnProperty.call(PAY_METHOD_DB_KEY, method)) throw new ApiError('invalid_payment', 'Moyen de paiement invalide.');
    const key = idempotencyKey ?? `pay-${uid('idem')}`;
    if (serverWash) {
      const commands = adapter.washCommands;
      const userId = identity?.userId;
      const stationId = s.station?.id;
      if (!commands || !userId || !stationId || wash.stationId !== stationId) {
        throw new ApiError('station_changed', 'Station ou session invalide.');
      }
      const lock = `${userId}:${stationId}:${washId}`;
      if (paymentsInFlight.current.has(lock)) throw new ApiError('payment_in_flight', 'Un encaissement est déjà en cours.');
      const previous = readPendingPayment(userId, stationId, washId);
      if (previous && (previous.amount !== amt || previous.method !== method || previous.key !== key)) {
        throw new ApiError('payment_pending', 'Vérifiez d’abord la tentative de paiement précédente avec son montant et sa clé d’origine.');
      }
      if (!previous) {
        if (wash.status === 'cancelled') throw new ApiError('wash_cancelled', 'Cette fiche est annulée : aucun encaissement possible.');
        if (amt > wash.total - wash.paid) throw new ApiError('overpayment', 'Le montant dépasse le reste à payer.');
        assertCashRule(method, amt);
      }
      const pending: PendingPayment = previous ?? { version: 1, userId, stationId, washId, amount: amt, method, key };
      if (!previous) savePendingPayment(pending); // avant tout envoi
      paymentsInFlight.current.add(lock);
      const epoch = scopeRef.current.epoch;
      const current = () => scopeRef.current.epoch === epoch;
      return (async () => {
        let accepted = false;
        try {
          await commands.addPayment(washId, amt, method, key);
          accepted = true;
          // Tant que la nouvelle lecture n'est pas confirmée, conserver la clé :
          // on peut alors vérifier à nouveau sans risquer un double paiement.
          if (!current()) return;
          try { await refreshWashes({ washId, key }); }
          catch { throw new Error('Paiement confirmé, mais lecture impossible. Réessayez la vérification avec la même clé.'); }
          if (!current()) return;
          if (serverFinance) await refreshFinance().catch((error: unknown) => {
            if (current()) notify('error', `Actualisation finance : ${error instanceof Error ? error.message : 'erreur'}`);
          });
          if (!current()) return;
          clearPendingPayment(pending);
        } catch (error) {
          if (!accepted && !previous && error instanceof PaymentCommandError && error.outcome === 'rejected') {
            clearPendingPayment(pending);
          }
          throw error;
        } finally { paymentsInFlight.current.delete(lock); }
      })();
    }
    if (wash.status === 'cancelled') throw new ApiError('wash_cancelled', 'Cette fiche est annulée : aucun encaissement possible.');
    if (amt > wash.total - wash.paid) throw new ApiError('overpayment', 'Le montant dépasse le reste à payer.');
    assertCashRule(method, amt);
    // Idempotence locale : un double clic avec la même clé ne duplique pas le mouvement.
    if (s.washes.some((w) => w.payments?.some((p) => p.idempotencyKey === key))) return;
    const now = new Date().toISOString();
    const paymentId = uid('pay');
    setState((cur0) => {
      const cur = withFinanceDefaults(cur0);
      const cash = cashPaymentMovement(cur, washId, paymentId, amt, method, key, now);
      return {
        ...cur,
        cashMovements: cash ? [...cur.cashMovements, cash] : cur.cashMovements,
        washes: cur.washes.map((w) => {
          if (w.id !== washId) return w;
          const paid = w.paid + amt;
          // Un encaissement intégral fait avancer la file : affectée → en cours.
          const advance = paid >= w.total && w.status === 'assigned';
          return {
            ...w, paid,
            payments: [...w.payments, {
              id: paymentId, amount: amt, method, at: now,
              byUserId: cur.session?.userId ?? 'inconnu',
              idempotencyKey: key, cancelledAt: null, cancelReason: null,
            }],
            status: advance ? 'in_progress' : w.status,
            history: advance
              ? [...w.history, washEvent(w.status, 'in_progress', 'Fiche soldée : lancement du lavage', now, cur.session?.userId ?? null, uid('hist'))]
              : w.history,
          };
        }),
      };
    });
    notify('success', 'Encaissement enregistré.');
  }, [assertActivated, assertCashRule, notify, adapter, serverWash, serverFinance, identity?.userId, refreshWashes, refreshFinance]);

  const openCash = useCallback((openingFloat: number): void | Promise<void> => {
    assertActivated();
    validateMoney(openingFloat);
    const s = stateRef.current;
    if (s.cashSessions.some((c) => c.status === 'ouverte')) throw new ApiError('cash_open', 'Une caisse est déjà ouverte.');
    if (serverFinance) {
      return financeRpc((c) => c.openCash(s.station!.id, openingFloat)).then(() => {});
    }
    const session: CashSession = {
      id: uid('cash'), stationId: s.station!.id, openedBy: s.session?.name ?? '—',
      openedAt: new Date().toISOString(), openingFloat: openingFloat,
      closedAt: null, countedAmount: null, closedBy: null, status: 'ouverte',
      reopenReason: null, reopenedAt: null,
    };
    const next = { ...s, cashSessions: [session, ...s.cashSessions] };
    setState({ ...next, auditLogs: logAction(next, 'Caisse ouverte', `Fond de caisse : ${session.openingFloat} FCFA`) });
    notify('success', 'Caisse ouverte.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const closeCash = useCallback((counted: number): void | Promise<void> => {
    assertActivated();
    const s = stateRef.current;
    const open = s.cashSessions.find((c) => c.status === 'ouverte');
    if (!open) throw new ApiError('cash_closed', 'Aucune caisse ouverte.');
    const value = validateMoney(counted);
    if (serverFinance) return financeRpc((c) => c.closeCash(open.id, value));
    const at = new Date().toISOString();
    const theoretical = theoreticalCash(s, open.id);
    const next = closeCashWithLedger(withFinanceDefaults(s), open.id, value, theoretical, at);
    setState({ ...next, auditLogs: logAction(next, 'Caisse clôturée', `Comptage : ${value} FCFA · théorique ${theoretical} FCFA`) });
    notify('success', 'Caisse clôturée : relevé immuable conservé.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const reopenCash = useCallback((sessionId: string, reason: string): void | Promise<void> => {
    assertActivated();
    if (reason.trim().length < 3) throw new ApiError('invalid_reason', 'La réouverture doit être motivée (3 caractères minimum).');
    const next0 = stateRef.current;
    if (next0.cashSessions.some((c) => c.status === 'ouverte')) throw new ApiError('cash_open', 'Une caisse est déjà ouverte.');
    const target = next0.cashSessions.find((c) => c.id === sessionId);
    if (!target) throw new ApiError('not_found', 'Session de caisse introuvable.');
    if (target.status !== 'cloturee') throw new ApiError('cash_open', 'Cette caisse est déjà ouverte.');
    if (serverFinance) return financeRpc((c) => c.reopenCash(sessionId, reason.trim()));
    const next = {
      ...next0,
      cashSessions: next0.cashSessions.map((c) => c.id === sessionId ? {
        ...c, status: 'ouverte' as const, reopenReason: reason.trim(),
        // Dernier comptage = nouveau fond ; les mouvements antérieurs sont
        // exclus du théorique et le premier relevé reste immuable.
        openingFloat: c.countedAmount ?? c.openingFloat,
        reopenedAt: new Date().toISOString(), closedAt: null,
      } : c),
    };
    setState({ ...next, auditLogs: logAction(next, 'Caisse réouverte', reason.trim()) });
    notify('info', 'Caisse réouverte (motif enregistré).');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const addExpense = useCallback((p: Omit<Expense, 'id' | 'stationId' | 'status' | 'cancelReason' | 'createdBy' | 'createdAt' | 'cashSessionId'>): void | Promise<void> => {
    assertActivated();
    const s = stateRef.current;
    validateExpense(p);
    assertCashRule(p.method, p.amount);
    const key = p.idempotencyKey ?? `expense-${uid('idem')}`;
    if ((s.expenses ?? []).some((e) => e.idempotencyKey === key)) return;
    if (serverFinance) {
      return financeRpc((c) => c.addExpense({
        stationId: s.station!.id, amount: p.amount,
        category: p.category, reason: p.reason.trim(), supplier: p.supplier,
        date: p.date, method: p.method, idempotencyKey: key,
      })).then(() => {});
    }
    const open = s.cashSessions.find((c) => c.status === 'ouverte');
    const at = new Date().toISOString();
    const expenseId = uid('exp');
    const expense: Expense = {
      ...p, id: expenseId, stationId: s.station!.id, status: 'enregistree',
      cancelReason: null, createdBy: s.session?.name ?? '—',
      createdAt: at, cashSessionId: open?.id ?? null,
      amount: p.amount, idempotencyKey: key,
    };
    setState((cur0) => {
      const cur = withFinanceDefaults(cur0);
      const cash = p.method === 'especes' && open
        ? { ...cashPaymentMovement(cur, expenseId, '', -expense.amount, p.method, key, at)!,
            kind: 'expense_out' as const, paymentId: null, expenseId,
            reference: p.category, idempotencyKey: `expense:${key}` }
        : null;
      return {
        ...cur,
        expenses: [expense, ...cur.expenses],
        cashMovements: cash ? [...cur.cashMovements, cash] : cur.cashMovements,
      };
    });
    notify('success', 'Dépense enregistrée.');
  }, [assertActivated, assertCashRule, notify, serverFinance, financeRpc]);

  const cancelExpense = useCallback((id: string, reason: string): void | Promise<void> => {
    assertActivated();
    const expense = stateRef.current.expenses.find((e) => e.id === id);
    if (!expense) throw new ApiError('not_found', 'Dépense introuvable.');
    if (expense.status === 'annulee') throw new ApiError('already_cancelled', 'Cette dépense est déjà annulée.');
    if (reason.trim().length < 3) throw new ApiError('invalid_reason', 'L’annulation doit être motivée.');
    if (serverFinance) return financeRpc((c) => c.cancelExpense(id, reason.trim()));
    const at = new Date().toISOString();
    // Validation synchrone : aucun faux succès si la caisse liée est clôturée.
    cancelExpenseWithLedger(withFinanceDefaults(stateRef.current), id, reason.trim(), at);
    setState((cur0) => {
      const cur = withFinanceDefaults(cur0);
      const next = cancelExpenseWithLedger(cur, id, reason.trim(), at);
      return { ...next, auditLogs: logAction(next, 'Dépense annulée', `${id} — ${reason.trim()}`) };
    });
    notify('info', 'Dépense annulée (tracée, jamais supprimée).');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  // ── P06 : annulations d'encaissement, canaux et relevés de commission ──────
  const cancelPayment = useCallback((paymentId: string, reason: string): void | Promise<void> => {
    assertActivated();
    if (reason.trim().length < 3) throw new ApiError('invalid_reason', 'Le remboursement doit être motivé.');
    if (serverFinance) return financeRpc((c) => c.cancelPayment(paymentId, reason.trim()));
    const at = new Date().toISOString();
    cancelPaymentWithLedger(withFinanceDefaults(stateRef.current), paymentId, reason.trim(), at);
    setState((cur) => cancelPaymentWithLedger(withFinanceDefaults(cur), paymentId, reason.trim(), at));
    notify('info', 'Encaissement annulé : paiement conservé, créance recalculée.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const reconcileChannel = useCallback((methodId: string, start: string, end: string, counted: number): void | Promise<void> => {
    assertActivated();
    validatePeriod(start, end);
    validateMoney(counted);
    const value = counted;
    if (serverFinance) return financeRpc((c) => c.reconcileChannel(methodId, start, end, value));
    const at = new Date().toISOString();
    reconcileChannelLocal(withFinanceDefaults(stateRef.current), methodId, start, end, value, at);
    setState((cur) => reconcileChannelLocal(withFinanceDefaults(cur), methodId, start, end, value, at));
    notify('success', 'Canal rapproché et figé.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const createCommissionPeriod = useCallback((stationId: string, start: string, end: string): string | Promise<string> => {
    assertActivated();
    assertSelectedStation(stationId);
    validatePeriod(start, end);
    if (serverFinance) return financeRpc((c) => c.createCommissionPeriod(stationId, start, end));
    const result = createCommissionPeriodLocal(withFinanceDefaults(stateRef.current), stationId, start, end);
    setState(result.state);
    notify('success', 'Période de commission créée en brouillon.');
    return result.id;
  }, [assertActivated, assertSelectedStation, notify, serverFinance, financeRpc]);

  const validateCommissionPeriod = useCallback((periodId: string): void | Promise<void> => {
    assertActivated();
    if (serverFinance) return financeRpc((c) => c.validateCommissionPeriod(periodId));
    const at = new Date().toISOString();
    validateCommissionPeriodLocal(withFinanceDefaults(stateRef.current), periodId, at);
    setState((cur) => validateCommissionPeriodLocal(withFinanceDefaults(cur), periodId, at));
    notify('success', 'Relevé de commission validé et figé.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const recordCommissionPayout = useCallback((periodId: string, userId: string, amount: number, reference: string): void | Promise<void> => {
    assertActivated();
    validateMoney(amount);
    if (serverFinance) return financeRpc((c) => c.recordCommissionPayout(periodId, userId, amount, reference));
    const at = new Date().toISOString();
    recordCommissionPayoutLocal(withFinanceDefaults(stateRef.current), periodId, userId, amount, reference, at);
    setState((cur) => recordCommissionPayoutLocal(withFinanceDefaults(cur), periodId, userId, amount, reference, at));
    notify('success', 'Paie de commission enregistrée.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  // ── Prompt 07 : commandes stock, local pur ou RPC SECURITY DEFINER ──────────
  // En configuration mixte ou si le port RPC manque, ne jamais présenter un
  // repli navigateur comme une réception ou un inventaire enregistré.
  const assertStockWriteMode = useCallback(() => {
    if (!isLocalStockDemo && !serverStock) {
      throw new ApiError('stock_server_unavailable', 'Stock serveur indisponible : aucune opération n’a été enregistrée.');
    }
  }, [isLocalStockDemo, serverStock]);

  const saveSupplier = useCallback((p: SupplierPayload): string | Promise<string> => {
    assertActivated();
    assertStockWriteMode();
    validateSupplier(p); assertSelectedStation(p.stationId);
    if (serverStock) return stockRpc((c) => c.saveSupplier(p));
    const result = saveSupplierLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Fournisseur enregistré.');
    return result.id;
  }, [assertActivated, assertSelectedStation, assertStockWriteMode, serverStock, stockRpc, notify]);

  const saveProduct = useCallback((p: ProductPayload): string | Promise<string> => {
    assertActivated();
    assertStockWriteMode();
    validateProduct(p); assertSelectedStation(p.stationId);
    if (serverStock) return stockRpc((c) => c.saveProduct(p));
    const result = saveProductLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Produit enregistré.');
    return result.id;
  }, [assertActivated, assertSelectedStation, assertStockWriteMode, serverStock, stockRpc, notify]);

  const createPurchaseOrder = useCallback((p: CreatePurchaseOrderPayload): string | Promise<string> => {
    assertActivated();
    assertStockWriteMode();
    validateOrder(p); assertSelectedStation(p.stationId);
    if (serverStock) return stockRpc((c) => c.createPurchaseOrder(p));
    const result = createPurchaseOrderLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Commande créée sans incrémenter le stock.');
    return result.id;
  }, [assertActivated, assertSelectedStation, assertStockWriteMode, serverStock, stockRpc, notify]);

  const receivePurchaseLines = useCallback((p: ReceivePurchasePayload): void | Promise<void> => {
    assertActivated();
    assertStockWriteMode();
    validateReceipt(p);
    if (serverStock) return stockRpc((c) => c.receivePurchaseLines(p));
    setState(receivePurchaseLinesLocal(withStockDefaults(stateRef.current), p));
    notify('success', 'Réception valorisée enregistrée.');
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc, notify]);

  const startInventory = useCallback((stationId: string): string | Promise<string> => {
    assertActivated();
    assertStockWriteMode();
    assertSelectedStation(stationId);
    if (serverStock) return stockRpc((c) => c.startInventory(stationId));
    const result = startInventoryLocal(withStockDefaults(stateRef.current), stationId);
    setState(result.state);
    notify('success', 'Inventaire ouvert.');
    return result.id;
  }, [assertActivated, assertSelectedStation, assertStockWriteMode, serverStock, stockRpc, notify]);

  const recordInventoryCount = useCallback((p: InventoryCountPayload): void | Promise<void> => {
    assertActivated();
    assertStockWriteMode();
    validateInventory(p);
    if (serverStock) return stockRpc((c) => c.recordInventoryCount(p));
    setState(recordInventoryCountLocal(withStockDefaults(stateRef.current), p));
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc]);

  const closeInventory = useCallback((sessionId: string): void | Promise<void> => {
    assertActivated();
    assertStockWriteMode();
    if (serverStock) return stockRpc((c) => c.closeInventory(sessionId));
    setState(closeInventoryLocal(withStockDefaults(stateRef.current), sessionId));
    notify('success', 'Inventaire clôturé ; les écarts sont tracés.');
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc, notify]);

  const saveServiceConsumption = useCallback((p: ServiceConsumptionPayload): string | Promise<string> => {
    assertActivated();
    assertStockWriteMode();
    validateConsumption(p);
    if (serverStock) return stockRpc((c) => c.saveServiceConsumption(p));
    const result = saveServiceConsumptionLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Norme de consommation enregistrée.');
    return result.id;
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc, notify]);

  const consumeWash = useCallback((washId: string): void | Promise<void> => {
    assertActivated();
    assertStockWriteMode();
    if (serverStock) return stockRpc((c) => c.consumeWash(washId));
    setState(consumeWashLocal(withStockDefaults(stateRef.current), washId));
    notify('success', 'Consommation théorique valorisée.');
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc, notify]);

  const linkExpenseToOrder = useCallback((expenseId: string, orderId: string): void | Promise<void> => {
    assertActivated();
    assertStockWriteMode();
    if (serverStock) {
      // La projection de station contient purchaseOrderId. Ne rien modifier
      // avant confirmation : un refus RPC ne doit pas simuler un rattachement.
      return stockRpc((c) => c.linkExpenseToOrder(expenseId, orderId));
    }
    setState(linkExpenseToOrderLocal(withStockDefaults(stateRef.current), expenseId, orderId));
    notify('success', 'Dépense rattachée : aucun double comptage.');
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc, notify]);

  const certifyCosts = useCallback((p: CostCertificationPayload): void | Promise<void> => {
    assertActivated();
    assertStockWriteMode();
    validateCertification(p);
    if (serverStock) return stockRpc((c) => c.certifyCosts(p));
    setState(certifyCostsLocal(withStockDefaults(stateRef.current), p));
    notify('success', 'Coûts certifiés : résultat net publié.');
  }, [assertActivated, assertStockWriteMode, serverStock, stockRpc, notify]);

  const updateStockThreshold = useCallback((productId: string, reorderLevel: number) => {
    validateQuantity(reorderLevel, true);
    if (!isLocalStockDemo) {
      throw new ApiError('local_demo_only', 'La modification locale des seuils est réservée au mode démo local.');
    }
    setState((cur) => updateProductThresholdLocal(cur, productId, reorderLevel));
    notify('success', 'Seuil critique mis à jour dans la démonstration locale.');
  }, [isLocalStockDemo, notify]);

  const adjustProductStock = useCallback((productId: string, qtyOnHand: number) => {
    validateQuantity(qtyOnHand, true);
    if (!isLocalStockDemo) {
      throw new ApiError('local_demo_only', 'La simulation de stock est réservée au mode démo local.');
    }
    setState((cur) => adjustProductStockQtyLocal(cur, productId, qtyOnHand));
    notify('info', 'Simulation locale : niveau de stock ajusté dans ce navigateur.');
  }, [isLocalStockDemo, notify]);

  // ── P09 : formules, limites, abonnements, suspension ─────────────────────
  const savePlan = useCallback(async (p: PlanPayload): Promise<string> => {
    if (serverAnalytics) return analyticsRpc((c) => c.savePlan(p));
    const existing = getPlans().find((plan) => plan.id === p.planId);
    const updatedPlan: Plan = {
      id: p.planId, name: p.name.trim(), priceMonthly: Math.round(p.priceMinor),
      trial: p.trialDays > 0,
      limits: existing?.limits ?? { stations: 1, employees: 3, washesPerMonth: 100 },
      features: p.features.length > 0 ? p.features : existing?.features ?? [],
    };
    const updated = existing
      ? getPlans().map((plan) => plan.id === p.planId ? updatedPlan : plan)
      : [...getPlans(), updatedPlan].sort((a, b) => a.priceMonthly - b.priceMonthly);
    setPlansCache(updated);
    setPlans(updated);
    const next = { ...stateRef.current, auditLogs: logAction(stateRef.current, 'Formule enregistrée', updatedPlan.name) };
    setState(next);
    setPlatformBoard(platformBoardFromState(next, updated));
    notify('success', `Formule « ${updatedPlan.name} » enregistrée.`);
    return p.planId;
  }, [serverAnalytics, analyticsRpc, notify]);

  const setPlanLimit = useCallback(async (p: PlanLimitPayload): Promise<void> => {
    if (serverAnalytics) return analyticsRpc((c) => c.setPlanLimit(p));
    const key = p.key === 'washes_per_month' ? 'washesPerMonth' : p.key;
    const updated = getPlans().map((plan) => plan.id === p.planId
      ? { ...plan, limits: { ...plan.limits, [key]: Math.max(0, Math.round(p.valueInt)) } }
      : plan);
    setPlansCache(updated);
    setPlans(updated);
    const next = { ...stateRef.current, auditLogs: logAction(stateRef.current, 'Quota de formule', `${p.planId} · ${p.key} = ${p.valueInt}`) };
    setState(next);
    setPlatformBoard(platformBoardFromState(next, updated));
    notify('success', 'Limite de formule mise à jour.');
  }, [serverAnalytics, analyticsRpc, notify]);

  const setCompanySubscription = useCallback(async (p: CompanySubscriptionPayload): Promise<void> => {
    if (serverAnalytics) return analyticsRpc((c) => c.setCompanySubscription(p));
    const plan = getPlans().find((item) => item.id === p.planId);
    const status: 'active' | 'essai' | 'suspendue' = p.status === 'trial' ? 'essai'
      : p.status === 'suspended' ? 'suspendue' : 'active';
    const next: AppState = {
      ...stateRef.current,
      platformCompanies: stateRef.current.platformCompanies.map((c) => c.id === p.companyId
        ? { ...c, planId: p.planId, planName: plan?.name ?? c.planName, status }
        : c),
      subscription: stateRef.current.subscription && stateRef.current.company?.id === p.companyId
        ? { ...stateRef.current.subscription, planId: p.planId, status }
        : stateRef.current.subscription,
    };
    next.auditLogs = logAction(next, 'Abonnement entreprise', `${plan?.name ?? p.planId} · ${p.status}`);
    setState(next);
    setPlatformBoard(platformBoardFromState(next, getPlans()));
    notify('success', 'Abonnement entreprise mis à jour.');
  }, [serverAnalytics, analyticsRpc, notify]);

  const setCompanySuspended = useCallback(async (p: CompanySuspensionPayload): Promise<void> => {
    if (serverAnalytics) return analyticsRpc((c) => c.setCompanySuspended(p));
    const status = p.suspended ? 'suspendue' as const : 'active' as const;
    const next: AppState = {
      ...stateRef.current,
      platformCompanies: stateRef.current.platformCompanies.map((c) => c.id === p.companyId
        ? { ...c, status } : c),
      company: stateRef.current.company?.id === p.companyId
        ? { ...stateRef.current.company, suspended: p.suspended } : stateRef.current.company,
    };
    next.auditLogs = logAction(next, p.suspended ? 'Entreprise suspendue' : 'Entreprise réactivée', p.companyId);
    setState(next);
    setPlatformBoard(platformBoardFromState(next, getPlans()));
    notify('success', p.suspended ? 'Entreprise suspendue.' : 'Entreprise réactivée.');
  }, [serverAnalytics, analyticsRpc, notify]);

  // ── Abonnement / plateforme / activation ──────────────────────────────────
  const requestPlanChange = useCallback((planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    const current = stateRef.current;
    if (!plan || !current.subscription || current.subscription.companyId !== current.company?.id) {
      notify('error', 'Aucun abonnement local correspondant : aucune note n’a été enregistrée.');
      return;
    }
    setState((s) => {
      if (!s.subscription || s.subscription.companyId !== s.company?.id) return s;
      const next = { ...s, subscription: { ...s.subscription, pendingPlanId: planId } };
      return { ...next, auditLogs: logAction(next, 'Demande locale de changement de formule', plan.name) };
    });
    notify('success', `Note de passage à « ${plan.name} » enregistrée dans ce navigateur uniquement, sans envoi au serveur.`);
  }, [notify, plans]);

  const toggleCompanySuspension = useCallback((companyId: string) => {
    setState((s) => {
      const company = s.platformCompanies.find((c) => c.id === companyId);
      if (!company) return s;
      const suspended = company.status !== 'suspendue';
      const next = {
        ...s,
        platformCompanies: s.platformCompanies.map((c) => c.id === companyId
          ? { ...c, status: suspended ? 'suspendue' as const : 'active' as const } : c),
        company: s.company?.id === companyId ? { ...s.company, suspended } : s.company,
      };
      return { ...next, auditLogs: logAction(next, suspended ? 'Entreprise suspendue' : 'Entreprise réactivée', company.name) };
    });
  }, []);

  const activateStation = useCallback(() => {
    const s = stateRef.current;
    const missingNow = missingRequired(s);
    if (missingNow.length > 0) {
      throw new ApiError('onboarding_incomplete', 'La station ne peut pas ouvrir : des étapes obligatoires manquent.', missingNow);
    }
    setState((cur) => {
      const next = {
        ...cur,
        station: cur.station ? { ...cur.station, activated: true, activatedAt: new Date().toISOString() } : null,
      };
      return { ...next, auditLogs: logAction(next, 'Station activée', 'Ouverture de l’exploitation') };
    });
    notify('success', 'Station activée : l’exploitation est ouverte.');
  }, [notify]);

  const resetAll = useCallback(async () => {
    clearDemoPasswords();
    (authPort as LocalAuthAdapter).clearAll?.();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignoré */ }
    authGenerationRef.current += 1;
    authKeyRef.current = 'signed-out';
    scopeRef.current = { epoch: scopeRef.current.epoch + 1, userId: null, companyId: null, stationId: null };
    setAssignableUsers([]); setStationMetrics(null); setStationMetricsError(null);
    setAuthReady(true);
    setState(emptyState());
    setIdentity(null);
    setInvitations([]);
    setAuthRecovery(false);
    setAuthError(null);
    if (authPort.kind === 'supabase') await authPort.signOut();
    notify('info', 'Données locales de démonstration effacées.');
  }, [authPort, notify]);

  const viewEpoch = scopeRef.current.epoch;
  const scoped = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    if (authPort.kind === 'supabase' && viewEpoch !== scopeRef.current.epoch) {
      throw new ApiError('station_changed', 'La station ou la session a changé : vérifiez l’opération initiale avant de poursuivre.');
    }
    return fn(...args);
  };

  const value: Ctx = {
    state, toasts, notify: (kind, message) => { if (authPort.kind !== 'supabase' || viewEpoch === scopeRef.current.epoch) notify(kind, message); }, dismissToast, theme, toggleTheme, plans, dataSource, isLocalStockDemo, isServerStock: serverStock, plansError,
    onboarding, missing,
    authReady, authError, authRecovery, authKind: authPort.kind, identity, selectStation, invitations, clearAuthError,
    assignableUsers: serverWash ? assignableUsers : state.users.filter((u) => u.active &&
      (u.stationIds?.length ? u.stationIds.includes(state.station?.id ?? '') : !u.stationId || u.stationId === state.station?.id)),
    stationMetrics, stationMetricsError, refreshStationMetrics,
    signUp, signIn, signOut, requestPasswordReset, updatePassword,
    inviteUser, revokeInvitation, updateUser, refreshUsers, refreshInvitations,
    updateCompany: scoped(updateCompany), updateStation: scoped(updateStation), setStationLogoPath: scoped(setStationLogoPath), setHours: scoped(setHours), addCategory: scoped(addCategory), toggleCategory: scoped(toggleCategory), removeCategory: scoped(removeCategory),
    addService: scoped(addService), updateService: scoped(updateService), setPrice: scoped(setPrice), removeService: scoped(removeService),
    updateEmployee: scoped(updateEmployee), addClient: scoped(addClient), updateClient: scoped(updateClient),
    createWash: scoped(createWash), pendingWash, pendingWashError, retryPendingWash: scoped(retryPendingWash),
    setWashStatus: scoped(setWashStatus), addPayment: scoped(addPayment), assignWash: scoped(assignWash), recordQualityCheck: scoped(recordQualityCheck), createWashPost: scoped(createWashPost),
    refreshWashes, vehicleHistory,
    openCash: scoped(openCash), closeCash: scoped(closeCash), reopenCash: scoped(reopenCash), addExpense: scoped(addExpense), cancelExpense: scoped(cancelExpense),
    cancelPayment: scoped(cancelPayment), reconcileChannel: scoped(reconcileChannel), createCommissionPeriod: scoped(createCommissionPeriod), validateCommissionPeriod: scoped(validateCommissionPeriod),
    recordCommissionPayout: scoped(recordCommissionPayout), refreshFinance,
    refreshStock, saveSupplier: scoped(saveSupplier), saveProduct: scoped(saveProduct), createPurchaseOrder: scoped(createPurchaseOrder), receivePurchaseLines: scoped(receivePurchaseLines),
    startInventory: scoped(startInventory), recordInventoryCount: scoped(recordInventoryCount), closeInventory: scoped(closeInventory), saveServiceConsumption: scoped(saveServiceConsumption),
    consumeWash: scoped(consumeWash), linkExpenseToOrder: scoped(linkExpenseToOrder), certifyCosts: scoped(certifyCosts),
    updateStockThreshold: scoped(updateStockThreshold), adjustProductStock: scoped(adjustProductStock),
    refreshCrm, saveCustomerProfile: scoped(saveCustomerProfile), saveCustomerVehicle: scoped(saveCustomerVehicle), createLoyaltyProgram: scoped(createLoyaltyProgram),
    enrollLoyaltyCustomer: scoped(enrollLoyaltyCustomer), recordLoyaltyTransaction: scoped(recordLoyaltyTransaction), accrueLoyaltyForWash: scoped(accrueLoyaltyForWash),
    savePackagePlan: scoped(savePackagePlan), sellPackageToCustomer: scoped(sellPackageToCustomer), consumePackageForWash: scoped(consumePackageForWash),
    savePromotion: scoped(savePromotion), applyPromotionToWash: scoped(applyPromotionToWash), saveFleet: scoped(saveFleet), saveFleetContract: scoped(saveFleetContract),
    attachFleetVehicle: scoped(attachFleetVehicle), recordFleetReceivable: scoped(recordFleetReceivable), enqueueNotification: scoped(enqueueNotification),
    cancelPendingNotification: scoped(cancelPendingNotification),
    analyticsBoard, subscriptionUsage, platformBoard, analyticsError, platformError,
    refreshAnalytics, refreshSubscriptionUsage, refreshUsageCounters, refreshPlatform,
    savePlan, setPlanLimit, setCompanySubscription, setCompanySuspended,
    requestPlanChange, toggleCompanySuspension, activateStation: scoped(activateStation), resetAll,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore doit être utilisé dans StoreProvider');
  return ctx;
}

export { ApiError, todayISO };
