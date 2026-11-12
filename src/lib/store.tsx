import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AppState, AppUser, CashSession, Client, Company, DayHours, Expense, PayMethod,
  Plan, Role, Service, Session, Station, Subscription, VehicleCategory, Wash,
  WashItem, WashPost, WashQualityResult, WashStatus,
} from '../types';
import { ApiError } from '../types';
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
  emptyStockCollections, withStockDefaults,
  type CostCertificationPayload, type CreatePurchaseOrderPayload,
  type InventoryCountPayload, type ProductPayload, type ReceivePurchasePayload,
  type ServiceConsumptionPayload, type SupplierPayload, type StockSnapshot,
} from './stock';
import {
  certifyCostsLocal, closeInventoryLocal, consumeWashLocal,
  createPurchaseOrderLocal, linkExpenseToOrderLocal, receivePurchaseLinesLocal,
  recordInventoryCountLocal, saveProductLocal, saveServiceConsumptionLocal,
  saveSupplierLocal, startInventoryLocal,
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
      description: 'Apparaît sur les fiches et les rapports.',
      done: Boolean(st?.logoUrl),
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRecovery, setAuthRecovery] = useState(false);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('washguard.theme') === 'light' ? 'light' : 'dark'
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const authKeyRef = useRef('');
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
  const [platformBoard, setPlatformBoard] = useState<PlatformSnapshot>(() => emptyPlatformBoard(getPlans()));
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);

  useEffect(() => { persist(state); }, [state]);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = uid('toast');
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const sessionFromIdentity = useCallback((value: AuthIdentity): Session => ({
    userId: value.userId,
    email: value.email,
    name: value.fullName,
    role: value.role,
    companyId: value.companyId,
    stationId: value.stationIds[0] ?? null,
  }), []);

  const reasonMessage = useCallback((reason: AuthChange['reason']): string | null => {
    if (reason === 'account_disabled') return 'Ce compte est désactivé. Contactez le propriétaire de la station.';
    if (reason === 'email_unconfirmed') return 'Confirmez votre adresse e-mail avec le lien reçu avant de vous connecter.';
    if (reason === 'session_expired') return 'Votre session a expiré. Reconnectez-vous.';
    if (reason === 'no_profile') return 'Votre profil n’est pas encore rattaché à une entreprise.';
    return null;
  }, []);

  const refreshInvitations = useCallback(async (): Promise<Invitation[]> => {
    const list = await authPort.listInvitations();
    setInvitations(list);
    return list;
  }, [authPort]);

  const refreshUsers = useCallback(async (): Promise<AppUser[]> => {
    const users = await authPort.refreshUsers();
    setState((s) => ({ ...s, users }));
    return users;
  }, [authPort]);

  const applyAuthChange = useCallback((change: AuthChange) => {
    const value = change.identity;
    if (change.type === 'PASSWORD_RECOVERY') setAuthRecovery(true);

    if (!value || !value.active || !value.emailConfirmed) {
      authKeyRef.current = 'signed-out';
      setState((s) => ({ ...s, session: null }));
      setIdentity(null);
      setInvitations([]);
      setAuthError(value && !value.active
        ? 'Ce compte est désactivé. Contactez le propriétaire de la station.'
        : value && !value.emailConfirmed
          ? 'Confirmez votre adresse e-mail avec le lien reçu.'
          : reasonMessage(change.reason));
      setAuthReady(true);
      return;
    }
    const key = `${value.userId}:${value.roleKey}:${value.permissions.join(',')}:${value.active}`;
    // INITIAL_SESSION, SIGNED_IN et TOKEN_REFRESHED peuvent se succéder pour
    // le même JWT : on n'applique qu'une fois, sans nouvelle rafale de RPC.
    if (key === authKeyRef.current && change.type === 'TOKEN_REFRESHED') {
      setAuthReady(true);
      return;
    }
    authKeyRef.current = key;
    const nextSession = sessionFromIdentity(value);
    setIdentity(value);
    setAuthError(null);
    setState((s) => {
      if (authPort.kind === 'local') return { ...s, session: nextSession };
      // En mode connecté, la projection company/station/users vient du
      // serveur : aucun identifiant de tenant n'est fourni par le navigateur.
      return { ...s, session: nextSession, demoMode: false };
    });

    void (async () => {
      try {
        const { users } = await authPort.listUsers();
        if (authPort.kind === 'supabase') {
          const projected = mapIdentityToAppState(value, users);
          setState((s) => ({
            ...s,
            company: projected.company ?? s.company,
            station: projected.station ?? s.station,
            users: projected.users.length ? projected.users : s.users,
          }));
        }
        await refreshInvitations();
      } catch {
        // Une erreur de lecture ne doit jamais fabriquer une session locale.
        setAuthError('Lecture du profil ou des permissions impossible.');
      } finally {
        setAuthReady(true);
      }
    })();
  }, [authPort, refreshInvitations, sessionFromIdentity, reasonMessage]);

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
    const start = from ?? `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
    const endStr = to ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!serverFinance) {
      setState((cur) => withFinanceDefaults({
        ...cur, profitability: localProfitability(cur, start, endStr),
      }));
      return;
    }
    // Aucun chargement automatique sans session Supabase vérifiée : les tests
    // JSDOM et les visiteurs anonymes ne provoquent jamais d'appel RPC.
    if (!authReady || !identity) return;
    const [board, report] = await Promise.all([
      adapter.listFinanceBoard(),
      adapter.listProfitability(start, endStr),
    ]);
    setState((cur) => {
      const linked = new Map(cur.expenses.map((e) => [e.id, e.purchaseOrderId ?? null]));
      const expenses = board.expenses.map((e) => ({ ...e, purchaseOrderId: linked.get(e.id) ?? null }));
      return withStockDefaults(withFinanceDefaults({
        ...cur, ...board, expenses, profitability: report,
      }));
    });
  }, [adapter, serverFinance, authReady, identity?.userId]);

  const refreshWashes = useCallback(async (): Promise<void> => {
    // En mode branché, catalogue et clients viennent aussi du serveur : les
    // identifiants locaux (uid('cat'), uid('cli')) ne sont jamais envoyés aux
    // RPC qui attendent des UUID. Aucun tarif/client local n'est fabriqué.
    const [board, catalog, clients] = await Promise.all([
      adapter.listWashBoard(),
      serverWash ? adapter.listCatalog() : Promise.resolve(null),
      serverWash ? adapter.listClients() : Promise.resolve(null),
    ]);
    const projected = catalog ? mapCatalogToState(catalog) : null;
    setState((cur) => ({
      ...cur,
      washes: board.washes,
      washPosts: board.posts,
      ...(projected ? {
        vehicleCategories: projected.vehicleCategories,
        services: projected.services,
      } : {}),
      // P08 : en mode branché, `my_crm_board()` fournit les fiches enrichies ;
      // `my_company_clients()` ne doit pas les écraser avec l'ancienne fiche.
      ...(clients && !serverCrm ? { clients } : {}),
    }));
  }, [adapter, serverWash, serverCrm]);

  const refreshStock = useCallback(async (): Promise<void> => {
    if (!serverStock) {
      setState((cur) => withStockDefaults(cur));
      return;
    }
    if (!authReady || !identity) return;
    const board: StockSnapshot = await adapter.listStockBoard();
    setState((cur) => withStockDefaults({ ...cur, ...board }));
  }, [adapter, serverStock, authReady, identity?.userId]);

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
    if (!authReady || !identity) return;
    const board: CrmSnapshot = await adapter.listCrmBoard();
    setState((cur) => withCrmDefaults({
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
    }));
  }, [adapter, serverCrm, authReady, identity?.userId]);

  const refreshAnalytics = useCallback(async (
    start: string = monthStartISO(), end: string = todayISO(),
    compareStart: string | null = null, compareEnd: string | null = null,
  ): Promise<void> => {
    if (!serverAnalytics) {
      setAnalyticsBoard(analyticsBoardFromState(stateRef.current, start, end, compareStart, compareEnd));
      setAnalyticsError(null);
      return;
    }
    if (!authReady || !identity) return;
    const board = await adapter.listAnalyticsBoard(start, end, compareStart, compareEnd);
    setAnalyticsBoard(board);
    setAnalyticsError(null);
  }, [adapter, serverAnalytics, authReady, identity?.userId]);

  const refreshSubscriptionUsage = useCallback(async (periodStart: string = monthStartISO()): Promise<void> => {
    if (!serverAnalytics) {
      const usage = subscriptionUsageFromState(stateRef.current, periodStart);
      setSubscriptionUsage(usage);
      setPlatformBoard(platformBoardFromState(stateRef.current, getPlans()));
      return;
    }
    if (!authReady || !identity) return;
    setSubscriptionUsage(await adapter.listSubscriptionUsage(periodStart));
  }, [adapter, serverAnalytics, authReady, identity?.userId]);

  const refreshPlatform = useCallback(async (): Promise<void> => {
    if (!serverAnalytics) {
      setPlatformBoard(platformBoardFromState(stateRef.current, getPlans()));
      setPlatformError(null);
      return;
    }
    if (!authReady || !identity?.isPlatformAdmin) return;
    setPlatformBoard(await adapter.listPlatformBoard());
    setPlatformError(null);
  }, [adapter, serverAnalytics, authReady, identity?.userId, identity?.isPlatformAdmin]);

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
    if (serverWash && adapter.washCommands) return adapter.washCommands.vehicleHistory(key);
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

  // P09 : boards initiaux. Le mode local calcule immédiatement ; le mode
  // serveur n'appelle aucune RPC sans session vérifiée.
  useEffect(() => {
    if (serverAnalytics && (!authReady || !identity)) return;
    void refreshAnalytics().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Lecture analytics impossible.';
      setAnalyticsError(message);
      notify('error', `Analytics indisponibles : ${message}`);
    });
  }, [serverAnalytics, authReady, identity?.userId, refreshAnalytics, notify]);

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
    return action(commands).then(async (value) => {
      await refreshWashes();
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
    return action(commands).then(async (value) => {
      await refreshWashes();
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
    return action(commands).then(async (value) => {
      await refreshStock().catch((error: unknown) => {
        notify('error', `Actualisation stock : ${error instanceof Error ? error.message : 'erreur'}`);
      });
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
    return action(commands).then(async (value) => {
      await refreshCrm().catch((error: unknown) => {
        notify('error', `Actualisation CRM : ${error instanceof Error ? error.message : 'erreur'}`);
      });
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
    return action(commands).then(async (value) => {
      await refreshPlatform().catch((error: unknown) => {
        notify('error', `Actualisation plateforme : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      await refreshSubscriptionUsage().catch((error: unknown) => {
        notify('error', `Actualisation quotas : ${error instanceof Error ? error.message : 'erreur'}`);
      });
      return value;
    });
  }, [adapter, refreshPlatform, refreshSubscriptionUsage, notify]);

  const crmLocal = useCallback(<T,>(fn: (s: AppState) => CrmMutation<T>): T => {
    const result = fn(stateRef.current);
    setState(result.state);
    return result.value;
  }, []);

  // ── Prompt 08 : 17 actions, sync locales ou RPC serveur ────────────────────
  const saveCustomerProfile = useCallback((p: CustomerProfilePayload) =>
    serverCrm ? crmRpc((c) => c.saveCustomerProfile(p))
      : crmLocal((s) => saveCustomerProfileLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const saveCustomerVehicle = useCallback((p: CustomerVehiclePayload) =>
    serverCrm ? crmRpc((c) => c.saveCustomerVehicle(p))
      : crmLocal((s) => saveCustomerVehicleLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const createLoyaltyProgram = useCallback((p: LoyaltyProgramPayload) =>
    serverCrm ? crmRpc((c) => c.createLoyaltyProgram(p))
      : crmLocal((s) => createLoyaltyProgramLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const enrollLoyaltyCustomer = useCallback((p: LoyaltyEnrollmentPayload) =>
    serverCrm ? crmRpc((c) => c.enrollLoyaltyCustomer(p))
      : crmLocal((s) => enrollLoyaltyCustomerLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const recordLoyaltyTransaction = useCallback((p: LoyaltyTransactionPayload) =>
    serverCrm ? crmRpc((c) => c.recordLoyaltyTransaction(p))
      : crmLocal((s) => recordLoyaltyTransactionLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const accrueLoyaltyForWash = useCallback((washId: string, key?: string | null) =>
    serverCrm ? crmRpc((c) => c.accrueLoyaltyForWash(washId, key))
      : crmLocal((s) => accrueLoyaltyForWashLocal(s, washId, key)), [serverCrm, crmRpc, crmLocal]);
  const savePackagePlan = useCallback((p: PackagePlanPayload) =>
    serverCrm ? crmRpc((c) => c.savePackagePlan(p))
      : crmLocal((s) => savePackagePlanLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const sellPackageToCustomer = useCallback((p: PackageSalePayload) =>
    serverCrm ? crmRpc((c) => c.sellPackageToCustomer(p))
      : crmLocal((s) => sellPackageToCustomerLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const consumePackageForWash = useCallback((washId: string) =>
    serverCrm ? crmRpc((c) => c.consumePackageForWash(washId))
      : crmLocal((s) => consumePackageForWashLocal(s, washId)), [serverCrm, crmRpc, crmLocal]);
  const savePromotion = useCallback((p: PromotionPayload) =>
    serverCrm ? crmRpc((c) => c.savePromotion(p))
      : crmLocal((s) => savePromotionLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const applyPromotionToWash = useCallback((p: PromotionApplicationPayload) =>
    serverCrm ? crmRpc((c) => c.applyPromotionToWash(p))
      : crmLocal((s) => applyPromotionToWashLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const saveFleet = useCallback((p: FleetPayload) =>
    serverCrm ? crmRpc((c) => c.saveFleet(p))
      : crmLocal((s) => saveFleetLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const saveFleetContract = useCallback((p: FleetContractPayload) =>
    serverCrm ? crmRpc((c) => c.saveFleetContract(p))
      : crmLocal((s) => saveFleetContractLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const attachFleetVehicle = useCallback((p: AttachFleetVehiclePayload) =>
    serverCrm ? crmRpc((c) => c.attachFleetVehicle(p))
      : crmLocal((s) => attachFleetVehicleLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const recordFleetReceivable = useCallback((p: FleetReceivablePayload) =>
    serverCrm ? crmRpc((c) => c.recordFleetReceivable(p))
      : crmLocal((s) => recordFleetReceivableLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
  const enqueueNotification = useCallback((p: NotificationPayload) =>
    serverCrm ? crmRpc((c) => c.enqueueNotification(p))
      : crmLocal((s) => enqueueNotificationLocal(s, p)), [serverCrm, crmRpc, crmLocal]);
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
    try {
      await authPort.signOut();
    } finally {
      authKeyRef.current = 'signed-out';
      setState((s) => ({ ...s, session: null }));
      setIdentity(null);
      setInvitations([]);
      setAuthRecovery(false);
      setAuthError(null);
    }
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
  const updateCompany = useCallback((patch: Partial<Company>) => mutate((s) => {
    if (!s.company) return s;
    const company = { ...s.company, ...patch };
    return {
      ...s, company,
      platformCompanies: s.platformCompanies.map((c) => c.id === company.id ? {
        ...c, name: company.name, city: company.city, phone: company.phone,
      } : c),
      auditLogs: logAction(s, 'Entreprise modifiée', Object.keys(patch).join(', ')),
    };
  }), [mutate]);

  const updateStation = useCallback((patch: Partial<Station>) => mutate((s) => {
    if (!s.station) return s;
    return {
      ...s, station: { ...s.station, ...patch },
      auditLogs: logAction(s, 'Station modifiée', Object.keys(patch).join(', ')),
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

  const setPrice = useCallback((serviceId: string, categoryId: string, price: number) => mutate((s) => ({
    ...s,
    services: s.services.map((v) => v.id === serviceId
      ? { ...v, prices: { ...v.prices, [categoryId]: Math.max(0, Math.round(price)) } }
      : v),
  })), [mutate]);

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
    if (employeeIds.length === 0) throw new ApiError('invalid_employee', 'Choisissez au moins un employé.');
    if (p.items.length === 0) throw new ApiError('empty_items', 'Ajoutez au moins une prestation.');
    const discount = Math.max(0, Math.round(p.discount));
    if (s.session?.role === 'caissier' && discount > st.maxCashierDiscount) {
      throw new ApiError('discount_exceeded', `Remise maximale autorisée pour un caissier : ${st.maxCashierDiscount} FCFA.`);
    }

    // Mode Supabase : le serveur relit la grille tarifaire, fige les prix,
    // vérifie la station, les affectations et l'idempotence. Aucun prix local.
    if (serverWash) {
      const idempotencyKey = `ui-${uid('idem')}`;
      const payload = {
        stationId: st.id, categoryId: cat.id, plate: p.plate.trim(),
        clientId: p.clientId || null, clientName: p.clientName.trim(),
        items: p.items.map((it) => ({ serviceId: it.serviceId, qty: Math.max(1, it.qty) })),
        discount, employeeIds, postId: p.postId ?? null, idempotencyKey,
        payment: p.payment && p.payment.amount > 0 ? p.payment : null,
      };
      return rpc((c) => c.createWash(payload)).then((id) => {
        notify('success', `Fiche ${id.slice(0, 8)} enregistrée par le serveur.`);
        return {
          id, stationId: st.id, number: '—', clientId: payload.clientId,
          clientName: payload.clientName || null, vehicleCategoryId: cat.id,
          vehicleLabel: cat.name, plate: payload.plate, employeeId: employeeIds[0],
          assignedUserIds: employeeIds, postId: payload.postId,
          items: [], discount, total: 0, paid: payload.payment?.amount ?? 0,
          status: employeeIds.length ? 'assigned' : 'pending',
          createdAt: new Date().toISOString(), finishedAt: null, deliveredAt: null,
          cancelledReason: null, payments: [], history: [], qualityResult: null, qualityNotes: null,
        } as Wash;
      });
    }

    // Mode local : le prix reste figé ici ; modifier la grille ne change JAMAIS
    // les lavages déjà enregistrés (test « prix inchangé après modification »).
    const items: WashItem[] = p.items.map((it) => {
      const svc = s.services.find((v) => v.id === it.serviceId && v.active);
      if (!svc) throw new ApiError('invalid_service', 'Une prestation sélectionnée n’est plus disponible.');
      const unitPrice = svc.prices[cat.id] ?? 0;
      if (unitPrice <= 0) throw new ApiError('missing_price', `Aucun prix défini pour « ${svc.name} » / ${cat.name}.`);
      return { serviceId: svc.id, serviceName: svc.name, unitPrice, qty: Math.max(1, it.qty) };
    });
    const total = Math.max(0, items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0) - discount);
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
    setState((cur) => ({ ...cur, washes: [wash, ...cur.washes], washCounter: counter }));
    notify('success', `Fiche ${wash.number} enregistrée — ${formatFCFA(total)}.`);
    return wash;
  }, [assertActivated, assertCashRule, notify, adapter, serverWash, rpc]);

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
    if (clean.length < 2 || capacity < 1) throw new ApiError('invalid_post', 'Nom ou capacité de poste invalide.');
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
  }, [assertActivated, adapter, serverWash, rpc, notify]);

  const addPayment = useCallback((washId: string, amount: number, method: PayMethod, idempotencyKey?: string): void | Promise<void> => {
    assertActivated();
    const s = stateRef.current;
    const wash = s.washes.find((w) => w.id === washId);
    if (!wash) throw new ApiError('not_found', 'Fiche introuvable.');
    if (wash.status === 'cancelled') throw new ApiError('wash_cancelled', 'Cette fiche est annulée : aucun encaissement possible.');
    const amt = Math.round(amount);
    if (amt <= 0) throw new ApiError('invalid_amount', 'Le montant doit être supérieur à zéro.');
    if (amt > wash.total - wash.paid) throw new ApiError('overpayment', 'Le montant dépasse le reste à payer.');
    assertCashRule(method, amt);
    const key = idempotencyKey ?? `pay-${uid('idem')}`;
    // Idempotence locale : un double clic avec la même clé ne duplique JAMAIS
    // le paiement ni son mouvement de caisse (miroir de `record_payment`).
    if (s.washes.some((w) => w.payments?.some((p) => p.idempotencyKey === key))) return;
    if (serverWash) {
      return rpc((c) => c.addPayment(washId, amt, method, key));
    }
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
  }, [assertActivated, assertCashRule, notify, adapter, serverWash, rpc]);

  const openCash = useCallback((openingFloat: number): void | Promise<void> => {
    assertActivated();
    const s = stateRef.current;
    if (s.cashSessions.some((c) => c.status === 'ouverte')) throw new ApiError('cash_open', 'Une caisse est déjà ouverte.');
    if (serverFinance) {
      return financeRpc((c) => c.openCash(s.station!.id, Math.max(0, Math.round(openingFloat)))).then(() => {});
    }
    const session: CashSession = {
      id: uid('cash'), stationId: s.station!.id, openedBy: s.session?.name ?? '—',
      openedAt: new Date().toISOString(), openingFloat: Math.max(0, Math.round(openingFloat)),
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
    const value = Math.max(0, Math.round(counted));
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
    if (p.amount <= 0) throw new ApiError('invalid_amount', 'Le montant doit être supérieur à zéro.');
    if (!p.reason.trim()) throw new ApiError('invalid_reason', 'Le motif est obligatoire.');
    assertCashRule(p.method, p.amount);
    const key = p.idempotencyKey ?? `expense-${uid('idem')}`;
    if ((s.expenses ?? []).some((e) => e.idempotencyKey === key)) return;
    if (serverFinance) {
      return financeRpc((c) => c.addExpense({
        stationId: s.station!.id, amount: Math.round(p.amount),
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
      amount: Math.round(p.amount), idempotencyKey: key,
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
    if (!start || !end || end < start || counted < 0) {
      throw new ApiError('invalid_reconciliation', 'Période ou comptage invalide.');
    }
    const value = Math.round(counted);
    if (serverFinance) return financeRpc((c) => c.reconcileChannel(methodId, start, end, value));
    const at = new Date().toISOString();
    reconcileChannelLocal(withFinanceDefaults(stateRef.current), methodId, start, end, value, at);
    setState((cur) => reconcileChannelLocal(withFinanceDefaults(cur), methodId, start, end, value, at));
    notify('success', 'Canal rapproché et figé.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  const createCommissionPeriod = useCallback((stationId: string, start: string, end: string): string | Promise<string> => {
    assertActivated();
    if (!stationId || !start || !end || end < start) {
      throw new ApiError('invalid_period', 'Période de commission invalide.');
    }
    if (serverFinance) return financeRpc((c) => c.createCommissionPeriod(stationId, start, end));
    const result = createCommissionPeriodLocal(withFinanceDefaults(stateRef.current), stationId, start, end);
    setState(result.state);
    notify('success', 'Période de commission créée en brouillon.');
    return result.id;
  }, [assertActivated, notify, serverFinance, financeRpc]);

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
    if (amount < 0) throw new ApiError('invalid_amount', 'Montant de paie invalide.');
    if (serverFinance) return financeRpc((c) => c.recordCommissionPayout(periodId, userId, Math.round(amount), reference));
    const at = new Date().toISOString();
    recordCommissionPayoutLocal(withFinanceDefaults(stateRef.current), periodId, userId, Math.round(amount), reference, at);
    setState((cur) => recordCommissionPayoutLocal(withFinanceDefaults(cur), periodId, userId, Math.round(amount), reference, at));
    notify('success', 'Paie de commission enregistrée.');
  }, [assertActivated, notify, serverFinance, financeRpc]);

  // ── Prompt 07 : commandes stock, local pur ou RPC SECURITY DEFINER ──────────
  const saveSupplier = useCallback((p: SupplierPayload): string | Promise<string> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.saveSupplier(p));
    const result = saveSupplierLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Fournisseur enregistré.');
    return result.id;
  }, [assertActivated, serverStock, stockRpc, notify]);

  const saveProduct = useCallback((p: ProductPayload): string | Promise<string> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.saveProduct(p));
    const result = saveProductLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Produit enregistré.');
    return result.id;
  }, [assertActivated, serverStock, stockRpc, notify]);

  const createPurchaseOrder = useCallback((p: CreatePurchaseOrderPayload): string | Promise<string> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.createPurchaseOrder(p));
    const result = createPurchaseOrderLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Commande créée sans incrémenter le stock.');
    return result.id;
  }, [assertActivated, serverStock, stockRpc, notify]);

  const receivePurchaseLines = useCallback((p: ReceivePurchasePayload): void | Promise<void> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.receivePurchaseLines(p));
    setState(receivePurchaseLinesLocal(withStockDefaults(stateRef.current), p));
    notify('success', 'Réception valorisée enregistrée.');
  }, [assertActivated, serverStock, stockRpc, notify]);

  const startInventory = useCallback((stationId: string): string | Promise<string> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.startInventory(stationId));
    const result = startInventoryLocal(withStockDefaults(stateRef.current), stationId);
    setState(result.state);
    notify('success', 'Inventaire ouvert.');
    return result.id;
  }, [assertActivated, serverStock, stockRpc, notify]);

  const recordInventoryCount = useCallback((p: InventoryCountPayload): void | Promise<void> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.recordInventoryCount(p));
    setState(recordInventoryCountLocal(withStockDefaults(stateRef.current), p));
  }, [assertActivated, serverStock, stockRpc]);

  const closeInventory = useCallback((sessionId: string): void | Promise<void> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.closeInventory(sessionId));
    setState(closeInventoryLocal(withStockDefaults(stateRef.current), sessionId));
    notify('success', 'Inventaire clôturé ; les écarts sont tracés.');
  }, [assertActivated, serverStock, stockRpc, notify]);

  const saveServiceConsumption = useCallback((p: ServiceConsumptionPayload): string | Promise<string> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.saveServiceConsumption(p));
    const result = saveServiceConsumptionLocal(withStockDefaults(stateRef.current), p);
    setState(result.state);
    notify('success', 'Norme de consommation enregistrée.');
    return result.id;
  }, [assertActivated, serverStock, stockRpc, notify]);

  const consumeWash = useCallback((washId: string): void | Promise<void> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.consumeWash(washId));
    setState(consumeWashLocal(withStockDefaults(stateRef.current), washId));
    notify('success', 'Consommation théorique valorisée.');
  }, [assertActivated, serverStock, stockRpc, notify]);

  const linkExpenseToOrder = useCallback((expenseId: string, orderId: string): void | Promise<void> => {
    assertActivated();
    if (serverStock) {
      // Le lien est conservé dans la projection locale : `my_finance_board()`
      // n'expose pas encore cette colonne, mais la RPC serveur l'a écrite.
      setState((cur) => ({
        ...cur,
        expenses: cur.expenses.map((e) => e.id === expenseId ? { ...e, purchaseOrderId: orderId } : e),
      }));
      return stockRpc((c) => c.linkExpenseToOrder(expenseId, orderId));
    }
    setState(linkExpenseToOrderLocal(withStockDefaults(stateRef.current), expenseId, orderId));
    notify('success', 'Dépense rattachée : aucun double comptage.');
  }, [assertActivated, serverStock, stockRpc, notify]);

  const certifyCosts = useCallback((p: CostCertificationPayload): void | Promise<void> => {
    assertActivated();
    if (serverStock) return stockRpc((c) => c.certifyCosts(p));
    setState(certifyCostsLocal(withStockDefaults(stateRef.current), p));
    notify('success', 'Coûts certifiés : résultat net publié.');
  }, [assertActivated, serverStock, stockRpc, notify]);

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
    const plan = getPlans().find((p) => p.id === planId);
    if (!plan) return;
    setState((s) => {
      if (!s.subscription) return s;
      const next = { ...s, subscription: { ...s.subscription, pendingPlanId: planId } };
      return { ...next, auditLogs: logAction(next, 'Demande de changement de formule', plan.name) };
    });
    notify('success', `Demande de passage à « ${plan.name} » enregistrée.`);
  }, [notify]);

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
    authKeyRef.current = 'signed-out';
    setState(emptyState());
    setIdentity(null);
    setInvitations([]);
    setAuthRecovery(false);
    setAuthError(null);
    if (authPort.kind === 'supabase') await authPort.signOut();
    notify('info', 'Données locales de démonstration effacées.');
  }, [authPort, notify]);

  const value: Ctx = {
    state, toasts, notify, dismissToast, theme, toggleTheme, plans, dataSource, plansError,
    onboarding, missing,
    authReady, authError, authRecovery, authKind: authPort.kind, identity, invitations, clearAuthError,
    signUp, signIn, signOut, requestPasswordReset, updatePassword,
    inviteUser, revokeInvitation, updateUser, refreshUsers, refreshInvitations,
    updateCompany, updateStation, setHours, addCategory, toggleCategory, removeCategory,
    addService, updateService, setPrice, removeService,
    updateEmployee, addClient, updateClient,
    createWash, setWashStatus, addPayment, assignWash, recordQualityCheck, createWashPost,
    refreshWashes, vehicleHistory,
    openCash, closeCash, reopenCash, addExpense, cancelExpense,
    cancelPayment, reconcileChannel, createCommissionPeriod, validateCommissionPeriod,
    recordCommissionPayout, refreshFinance,
    refreshStock, saveSupplier, saveProduct, createPurchaseOrder, receivePurchaseLines,
    startInventory, recordInventoryCount, closeInventory, saveServiceConsumption,
    consumeWash, linkExpenseToOrder, certifyCosts,
    refreshCrm, saveCustomerProfile, saveCustomerVehicle, createLoyaltyProgram,
    enrollLoyaltyCustomer, recordLoyaltyTransaction, accrueLoyaltyForWash,
    savePackagePlan, sellPackageToCustomer, consumePackageForWash,
    savePromotion, applyPromotionToWash, saveFleet, saveFleetContract,
    attachFleetVehicle, recordFleetReceivable, enqueueNotification,
    cancelPendingNotification,
    analyticsBoard, subscriptionUsage, platformBoard, analyticsError, platformError,
    refreshAnalytics, refreshSubscriptionUsage, refreshUsageCounters, refreshPlatform,
    savePlan, setPlanLimit, setCompanySubscription, setCompanySuspended,
    requestPlanChange, toggleCompanySuspension, activateStation, resetAll,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore doit être utilisé dans StoreProvider');
  return ctx;
}

export { ApiError, todayISO };
