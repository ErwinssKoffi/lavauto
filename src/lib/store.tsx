import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  AppState, AppUser, CashSession, Client, Company, DayHours, Expense, PayMethod,
  Plan, PlanFeature, Role, Service, Session, Station, Subscription, VehicleCategory, Wash,
  WashItem, WashPost, WashQualityResult, WashStatus,
} from '../types';
import { ApiError, PAY_METHOD_DB_KEY } from '../types';
import { canTransitionWash, normalizeWashes, washEvent } from './washLifecycle';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, DEFAULT_THEME, THEME_PREFERENCE_VERSION, isKnownTheme, themeScheme } from './themes';
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
import { clearOfflineApiCache } from './pwa';
import {
  clearPendingWash, readPendingWash, savePendingWash, WashCreationError,
  type PendingWashCreation,
} from './washCreation';
import { getPlans, setPlansCache } from './plans';
import { accessCanWrite, localSubscriptionAccess, type SubscriptionAccess, type SubscriptionRequest } from './subscription';
import {
  analyticsBoardFromState, emptyAnalyticsBoard, emptyPlatformBoard,
  emptySubscriptionUsage, monthStartISO, platformBoardFromState,
  quotaMonthStartISO, redactStockAnalytics, subscriptionUsageFromState,
  type AnalyticsSnapshot, type PlatformSnapshot, type SubscriptionUsageSnapshot,
} from './analytics';
import {
  getDataSource, getDataAdapter,
  type CompanySubscriptionPayload, type CompanySuspensionPayload,
  type DataAdapter, type DataSource, type PlanLimitPayload, type PlanPayload, type StationSetupSnapshot,
} from '../services/adapters/DataAdapter';
import { getAuthPort } from '../services/auth/getAuthPort';
import type {
  AuthActivityEntry, AuthPort, AuthResult, AuthChange, ResetTokenInspection, SecuritySession,
} from '../services/auth/AuthPort';
import {
  mapIdentityToAppState, type AuthIdentity, type Invitation, type InvitePayload,
  type SignUpPayload, type UpdateUserPayload,
} from '../services/auth/authTypes';
import { DEMO_PASSWORDS_KEY, DEMO_STATE_KEY, protectDemoState, readDemoState, serializeDemoState, withDemoStorageLock, writeDemoState } from './demoStorage';
import { isStationLogoPath } from './image';
import type { StationMetrics } from './stationMetrics';
import { clearPendingPayment, readPendingPayment, savePendingPayment, PaymentCommandError, type PendingPayment } from './paymentAttempt';
import { assertPendingExpense, clearPendingExpense, readPendingExpense, savePendingExpense, ExpenseCommandError, type PendingExpense } from './expenseAttempt';
import { clearPendingRevocation, readPendingRevocation, savePendingRevocation, type PendingRevocation } from './revocationAttempt';
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
export function load(stored = readDemoState()): AppState {
  try {
    const { session: _ignored, ...persisted } = stored.status === 'ok' ? stored.value : {};
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
    // Mapping idempotent des anciens statuts, sans réécrire l'entrée brute
    // si la normalisation de l'ancien état échoue.
    state.washes = normalizeWashes(persisted.washes as unknown[] | undefined);
    state.washPosts = Array.isArray(persisted.washPosts) ? persisted.washPosts : [];
    if (TEST_AUTH && typeof window !== 'undefined' && stored.status !== 'unreadable') {
      const injected = (window as unknown as TestBridge).__WG_TEST_SESSION__?.session;
      if (injected) state.session = injected;
    }
    return state;
  } catch {
    if (stored.raw !== null) protectDemoState(stored.raw);
    return emptyState();
  }
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
  /** Schéma de couleurs du thème actif, conservé pour la bascule rapide. */
  theme: 'dark' | 'light';
  /** Bascule rapide entre les deux thèmes WashGuard. */
  toggleTheme: () => void;
  /** Thème DaisyUI actif (`data-theme`), parmi les 37 thèmes disponibles. */
  themeName: string;
  /** Applique et persiste un thème DaisyUI ; les noms inconnus sont ignorés. */
  setTheme: (name: string) => void;
  /** Formules affichées : cache du repli local ou lignes lues dans `plans`. */
  plans: Plan[];
  /** Source active (diagnostic) : `local` par défaut, `supabase` en lecture seule. */
  dataSource: DataSource;
  /** Les simulations de stock sont réservées à une source ET une Auth locales. */
  isLocalStockDemo: boolean;
  /** Avertissement persistant en cas de conflit inter-onglets ou d'échec d'écriture. */
  demoStorageIssue: string | null;
  /** L'état de démonstration affiché n'a pas encore été confirmé dans le stockage. */
  demoStoragePending: boolean;
  /** Les commandes stock sont reliées au port RPC Supabase. */
  isServerStock: boolean;
  /** Erreur de chargement des tarifs : aucun prix local n'est affiché en repli. */
  plansError: string | null;
  subscriptionAccess: SubscriptionAccess | null;
  subscriptionStatus: 'loading' | 'ready' | 'error';
  subscriptionError: string | null;
  canWriteSubscription: boolean;
  refreshSubscriptionAccess: () => Promise<SubscriptionAccess | null>;
  subscriptionRequests: SubscriptionRequest[];
  subscriptionRequestsError: string | null;
  refreshSubscriptionRequests: () => Promise<void>;
  decideSubscriptionRequest: (requestId: string, approve: boolean) => Promise<void>;
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
  requestPasswordReset: (email: string) => Promise<{ resetUrl?: string; demoMode?: boolean } | void>;
  updatePassword: (password: string, token?: string) => Promise<void>;
  verifyResetToken: (token: string) => Promise<ResetTokenInspection>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ revoked: number }>;
  listSessions: () => Promise<SecuritySession[]>;
  revokeSession: (sessionId: string) => Promise<{ signedOut: boolean }>;
  revokeOtherSessions: () => Promise<number>;
  listAuthActivity: (limit?: number) => Promise<AuthActivityEntry[]>;
  confirmEmail: (token: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<{ confirmUrl?: string; linkExposed?: boolean }>;
  inviteUser: (p: InvitePayload) => Promise<{ id: string; message?: string; inviteUrl?: string }>;
  revokeInvitation: (id: string) => Promise<void>;
  updateUser: (p: UpdateUserPayload) => Promise<void>;
  refreshUsers: () => Promise<AppUser[]>;
  refreshInvitations: () => Promise<Invitation[]>;
  /** Les listes peuvent être périmées jusqu'à une relecture explicite réussie. */
  employeeReadWarning: string | null;
  /** Ces incertitudes sont gardées pendant la navigation, pas au rechargement. */
  unconfirmedInvitation: { email: string; message: string } | null;
  unconfirmedAccountUpdate: { userId: string; message: string } | null;
  /** Tentative conservée dans cet onglet pour le même compte et la même entreprise. */
  unconfirmedRevocation: { id: string; message: string } | null;
  revocationRecoveryLoading: boolean;
  revocationRecoveryError: string | null;
  refreshEmployeeData: () => Promise<void>;
  // données de base / paramètres
  setupStatus: 'loading' | 'ready' | 'error';
  setupError: string | null;
  refreshSetup: () => Promise<void>;
  updateCompany: (patch: Partial<Company>) => void | Promise<void>;
  updateStation: (patch: Partial<Station>) => void | Promise<void>;
  setStationLogoPath: (stationId: string, userId: string, path: string | null) => void;
  setHours: (hours: DayHours[]) => void | Promise<void>;
  addCategory: (name: string) => void | Promise<void>;
  toggleCategory: (id: string) => void | Promise<void>;
  removeCategory: (id: string) => void | Promise<void>;
  addService: (name: string, description: string) => void | Promise<void>;
  updateService: (id: string, patch: Partial<Service>) => void | Promise<void>;
  setPrice: (serviceId: string, categoryId: string, price: number) => void | Promise<void>;
  removeService: (id: string) => void | Promise<void>;
  updateEmployee: (id: string, patch: Partial<AppUser>) => void | Promise<void>;
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
  pendingExpense: PendingExpense | null;
  pendingExpenseError: string | null;
  retryPendingExpense: () => Promise<void>;
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
  updateStockThreshold: (productId: string, reorderLevel: number) => void | Promise<void>;
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
  requestPlanChange: (planId: string) => Promise<void>;
  toggleCompanySuspension: (companyId: string) => void;
  activateStation: () => void | Promise<void>;
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

function setupPatchMatches(value: object, patch: object): boolean {
  const record = value as Record<string, unknown>;
  return Object.entries(patch).every(([key, expected]) => {
    const actual = record[key];
    if (typeof expected === 'string') return actual === expected.trim();
    if (key === 'paymentMethods' && Array.isArray(expected) && Array.isArray(actual)) {
      return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
    }
    if (key === 'hours' && Array.isArray(expected) && Array.isArray(actual)) {
      return expected.length === actual.length && expected.every((h, i) =>
        h.day === actual[i]?.day && h.open === actual[i]?.open && h.close === actual[i]?.close && h.closed === actual[i]?.closed);
    }
    return actual === expected;
  });
}

function hasDemoStateToPersist(state: AppState, baseline: string | null): boolean {
  return baseline !== null || Boolean(state.company || state.station || state.subscription || state.profitability || state.washCounter)
    || Object.values(state).some((value) => Array.isArray(value) && value.length > 0);
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
  const [initialDemoRead] = useState(() => readDemoState());
  const [state, setState] = useState<AppState>(() => getDataSource() !== 'local' && !TEST_AUTH ? emptyState() : load(initialDemoRead));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRecovery, setAuthRecovery] = useState(false);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  // L'avertissement de relecture est en mémoire ; la tentative de révocation
  // est conservée séparément dans l'onglet et ne contient aucun jeton Auth.
  const [employeeReadWarning, setEmployeeReadWarning] = useState<string | null>(null);
  const [unconfirmedInvitation, setUnconfirmedInvitation] = useState<{ email: string; message: string } | null>(null);
  const unconfirmedInvitationRef = useRef<{ userId: string; companyId: string } | null>(null);
  const [unconfirmedAccountUpdate, setUnconfirmedAccountUpdate] = useState<{ userId: string; message: string } | null>(null);
  const unconfirmedAccountUpdateRef = useRef<{ userId: string; companyId: string } | null>(null);
  const invitationsInFlight = useRef(new Set<string>());
  const accountUpdatesInFlight = useRef(new Set<string>());
  const [revocationRecovery, setRevocationRecovery] = useState<{
    userId: string; companyId: string; pending: PendingRevocation | null; error: string | null;
  } | null>(null);
  const revocationsInFlight = useRef(new Set<string>());
  const [pendingWashState, setPendingWashState] = useState<PendingWashCreation | null>(null);
  const [pendingWashError, setPendingWashError] = useState<string | null>(null);
  const [pendingExpenseState, setPendingExpenseState] = useState<PendingExpense | null>(null);
  const [pendingExpenseError, setPendingExpenseError] = useState<string | null>(null);
  const expensesInFlight = useRef(new Set<string>());
  const washCreationInFlight = useRef(new Set<string>());
  const paymentsInFlight = useRef(new Set<string>());
  const setupInFlight = useRef(false);
  const localWashReservations = useRef(new Set<string>());
  const localAccountReservations = useRef(new Set<string>());
  const [setupLoad, setSetupLoad] = useState<{ epoch: number; status: 'loading' | 'ready' | 'error'; error: string | null }>({ epoch: -1, status: 'loading', error: null });
  // Thème DaisyUI actif : `washguard.theme.name` fait foi. L'ancienne clé
  // `washguard.theme` (dark|light) reste lue et maintenue pour compatibilité
  // (script inline de index.html, préférences déjà enregistrées).
  const [themeName, setThemeName] = useState<string>(() => {
    try {
      const savedName = localStorage.getItem('washguard.theme.name');
      // Une préférence enregistrée par une génération antérieure (avant la
      // Signature Edition) est ignorée une seule fois.
      const versioned = localStorage.getItem('washguard.theme.v') === THEME_PREFERENCE_VERSION;
      return versioned && isKnownTheme(savedName) ? savedName : DEFAULT_THEME;
    } catch { return DEFAULT_THEME; }
  });
  const theme = themeScheme(themeName);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    localWashReservations.current.clear();
    localAccountReservations.current.clear();
  }, [state.company?.id]);
  useEffect(() => {
    for (const wash of state.washes) localWashReservations.current.delete(wash.id);
    for (const user of state.users.filter((u) => u.active)) {
      localAccountReservations.current.delete(`id:${user.id}`);
      localAccountReservations.current.delete(`email:${user.email.toLowerCase()}`);
    }
  }, [state.washes, state.users]);
  const demoBaseline = useRef<string | null>(initialDemoRead.raw);
  // L'interface ne confond pas l'état React affiché et sa dernière écriture
  // confirmée : le verrou inter-onglets peut retarder la sauvegarde.
  const [demoSavedRaw, setDemoSavedRaw] = useState<string | null>(initialDemoRead.raw);
  const demoWriteGeneration = useRef(0);
  const demoIssueRef = useRef<string | null>(null);
  const [demoStorageIssue, setDemoStorageIssue] = useState<string | null>(null);
  const demoSuccessQueue = useRef<{ id: string; message: string }[]>([]);
  const [demoSuccessVersion, setDemoSuccessVersion] = useState(0);
  const markDemoIssue = useCallback((message: string) => {
    demoIssueRef.current = message;
    setDemoStorageIssue(message);
  }, []);
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
    onStateCommitted: (raw) => { demoBaseline.current = raw; setDemoSavedRaw(raw); },
  }), []);
  const isRemoteAuth = authPort.kind === 'supabase' || authPort.kind === 'api';
  const recoveryScope = isRemoteAuth && identity?.companyId
    ? { userId: identity.userId, companyId: identity.companyId } : null;
  const currentRevocation = recoveryScope && revocationRecovery?.userId === recoveryScope.userId
    && revocationRecovery.companyId === recoveryScope.companyId ? revocationRecovery : null;
  const revocationRecoveryLoading = Boolean(recoveryScope && !currentRevocation);
  const revocationRecoveryError = currentRevocation?.error ?? null;
  const unconfirmedRevocation = currentRevocation?.pending ? {
    id: currentRevocation.pending.invitationId,
    message: `Révocation non confirmée : elle a peut-être été enregistrée. Reprenez uniquement cette même révocation ou vérifiez avec le support ; un refus ultérieur ne prouverait pas que la première tentative a échoué. Invitation : ${currentRevocation.pending.invitationId}. Ce rappel est conservé pour ce compte dans cet onglet ; il peut disparaître si l’onglet ou son stockage est supprimé, ou sur un autre appareil.`,
  } : null;
  useEffect(() => {
    if (!isRemoteAuth || !identity?.userId || !identity.companyId) {
      setRevocationRecovery(null); return;
    }
    const userId = identity.userId;
    const companyId = identity.companyId;
    try {
      setRevocationRecovery({ userId, companyId, pending: readPendingRevocation(userId, companyId), error: null });
    } catch (error) {
      setRevocationRecovery({ userId, companyId, pending: null,
        error: error instanceof Error ? error.message : 'Stockage de session inaccessible : vérifiez les comptes avec le support.' });
    }
  }, [authPort.kind, identity?.userId, identity?.companyId]);
  const demoRaw = useMemo(() => authPort.kind === 'local' ? serializeDemoState(state) : null, [authPort.kind, state]);
  const demoStoragePending = authPort.kind === 'local' && !demoStorageIssue
    && hasDemoStateToPersist(state, demoSavedRaw) && demoRaw !== demoSavedRaw;
  const showToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = uid('toast');
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  const notify = useCallback((kind: Toast['kind'], message: string) => {
    if (kind === 'success' && authPort.kind === 'local') {
      // Les transformations React précèdent l'écriture en localStorage : ne
      // montrer leur succès qu'après écriture et relecture sous le même verrou.
      if (demoIssueRef.current) return;
      demoSuccessQueue.current.push({ id: uid('notice'), message });
      setDemoSuccessVersion((v) => v + 1);
      return;
    }
    showToast(kind, message);
  }, [authPort.kind, showToast]);

  // ── Adaptateur de lecture (Prompt 03) ──────────────────────────────────────
  // Le mode local conserve ses tarifs immédiatement. Le mode Supabase part
  // SANS prix : si la base ne répond pas, aucun tarif local n'est présenté
  // comme un tarif de la base ; une erreur explicite est affichée à la place.
  const dataSource = getDataSource();
  const adapter = useMemo(() => getDataAdapter(() => stateRef.current), []);
  const isConnectedMode = (dataSource === 'supabase' && authPort.kind === 'supabase')
    || (dataSource === 'api' && authPort.kind === 'api');
  const isLocalStockDemo = dataSource === 'local' && authPort.kind === 'local';
  const localSetup = authPort.kind === 'local' && (dataSource === 'local' || TEST_AUTH);
  const serverSetup = isConnectedMode && Boolean(adapter.setupCommands);
  const setupStatus: 'loading' | 'ready' | 'error' = localSetup ? 'ready'
    : !serverSetup ? 'error' : setupLoad.epoch === scopeRef.current.epoch ? setupLoad.status : 'loading';
  const setupError = localSetup ? null : !serverSetup ? 'Configuration mixte : les réglages ne peuvent pas être enregistrés.'
    : setupLoad.epoch === scopeRef.current.epoch ? setupLoad.error : null;
  const serverWash = isConnectedMode && Boolean(adapter.washCommands);
  const serverFinance = isConnectedMode && Boolean(adapter.financeCommands);
  const serverStock = isConnectedMode && Boolean(adapter.stockCommands);
  const serverCrm = isConnectedMode && Boolean(adapter.crmCommands);
  const serverAnalytics = isConnectedMode && Boolean(adapter.analyticsCommands);
  const [plans, setPlans] = useState<Plan[]>(() => dataSource === 'local' ? getPlans() : []);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [subscriptionLoad, setSubscriptionLoad] = useState<{
    epoch: number; userId: string; companyId: string; status: 'loading' | 'ready' | 'error';
    access: SubscriptionAccess | null; error: string | null;
  } | null>(null);
  const [subscriptionRequests, setSubscriptionRequests] = useState<SubscriptionRequest[]>([]);
  const [subscriptionRequestsError, setSubscriptionRequestsError] = useState<string | null>(null);
  const subscriptionRequestInFlight = useRef(false);
  const [, setSubscriptionClock] = useState(0);
  const serverSubscription = isConnectedMode && Boolean(adapter.subscriptionCommands);
  const localSubscription = authPort.kind === 'local' ? localSubscriptionAccess(state, plans) : null;
  const currentSubscriptionLoad = subscriptionLoad?.epoch === scopeRef.current.epoch
    && subscriptionLoad.userId === identity?.userId && subscriptionLoad.companyId === identity?.companyId ? subscriptionLoad : null;
  const subscriptionAccess = serverSubscription ? currentSubscriptionLoad?.access ?? null : localSubscription;
  const subscriptionStatus: 'loading' | 'ready' | 'error' = serverSubscription
    ? currentSubscriptionLoad?.status ?? 'loading' : subscriptionAccess ? 'ready' : 'error';
  const subscriptionError = serverSubscription ? currentSubscriptionLoad?.error ?? null
    : subscriptionAccess ? null : 'Aucun abonnement local correspondant.';
  const canWriteSubscription = Boolean(identity?.isPlatformAdmin) || accessCanWrite(subscriptionAccess);
  const [analyticsBoard, setAnalyticsBoard] = useState<AnalyticsSnapshot>(() => emptyAnalyticsBoard());
  const canReadAnalytics = Boolean(identity?.isPlatformAdmin || subscriptionAccess?.features.consolidation);
  const canReadStockAnalytics = Boolean(identity?.isPlatformAdmin || subscriptionAccess?.features.stock);
  const analyticsRights = useRef({ canRead: canReadAnalytics, canReadStock: canReadStockAnalytics, version: 0 });
  if (analyticsRights.current.canRead !== canReadAnalytics || analyticsRights.current.canReadStock !== canReadStockAnalytics) {
    analyticsRights.current = { canRead: canReadAnalytics, canReadStock: canReadStockAnalytics, version: analyticsRights.current.version + 1 };
  }
  // Filtrer dès le rendu, puis effacer la projection devenue sensible sans
  // toucher aux données métier. Une réponse en vol vérifie aussi ces droits.
  const visibleAnalyticsBoard = useMemo(() => !canReadAnalytics
    ? emptyAnalyticsBoard(analyticsBoard.periodStart, analyticsBoard.periodEnd, analyticsBoard.compareStart, analyticsBoard.compareEnd)
    : canReadStockAnalytics ? analyticsBoard : redactStockAnalytics(analyticsBoard),
  [analyticsBoard, canReadAnalytics, canReadStockAnalytics]);
  useEffect(() => {
    if (!canReadAnalytics) setAnalyticsBoard((board) => emptyAnalyticsBoard(board.periodStart, board.periodEnd, board.compareStart, board.compareEnd));
    else if (!canReadStockAnalytics) setAnalyticsBoard((board) => redactStockAnalytics(board));
  }, [canReadAnalytics, canReadStockAnalytics]);
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

  const pendingExpense = serverFinance && pendingExpenseState?.userId === identity?.userId
    && pendingExpenseState?.stationId === state.station?.id ? pendingExpenseState : null;
  useEffect(() => {
    if (!serverFinance || !authReady || !identity?.userId || !state.station?.id) {
      setPendingExpenseState(null); setPendingExpenseError(null); return;
    }
    try {
      setPendingExpenseState(readPendingExpense(identity.userId, state.station.id));
      setPendingExpenseError(null);
    } catch (error) {
      setPendingExpenseState(null);
      setPendingExpenseError(error instanceof Error ? error.message : 'Tentative de dépense inaccessible.');
    }
  }, [serverFinance, authReady, identity?.userId, state.station?.id]);

  useEffect(() => {
    if (authPort.kind !== 'local' || demoIssueRef.current) return;
    // Ne pas créer un état vide au premier rendu : un autre onglet pourrait
    // être en train d'inscrire son propriétaire.
    const pendingNotices = new Set(demoSuccessQueue.current.map((item) => item.id));
    if (pendingNotices.size === 0 && !hasDemoStateToPersist(state, demoBaseline.current)) return;
    const generation = demoWriteGeneration.current;
    void withDemoStorageLock(() => {
      if (demoIssueRef.current || generation !== demoWriteGeneration.current || stateRef.current !== state) return;
      const stored = readDemoState();
      if (stored.status === 'unreadable' || stored.status === 'unavailable') {
        throw new Error('Stockage local illisible ou inaccessible. Les modifications récentes ne sont pas conservées.');
      }
      if (stored.raw !== demoBaseline.current) {
        throw new Error('Les données ont changé dans un autre onglet. Les modifications de cet onglet ne sont pas conservées ; sauvegardez les données, puis rechargez.');
      }
      // Une écriture périmée programmée juste avant notre propre inscription
      // ne peut pas remplacer l'entreprise qui vient d'être créée.
      if (stored.status === 'ok' && stored.value.company && state.company?.id !== stored.value.company.id) return;
      const raw = serializeDemoState(state);
      if (raw !== stored.raw) {
        try { writeDemoState(raw); }
        catch { throw new Error('Écriture locale impossible (stockage inaccessible ou plein). Les modifications récentes ne sont pas conservées.'); }
        demoBaseline.current = raw;
      }
      setDemoSavedRaw(raw);
      const confirmed = demoSuccessQueue.current.filter((item) => pendingNotices.has(item.id));
      demoSuccessQueue.current = demoSuccessQueue.current.filter((item) => !pendingNotices.has(item.id));
      confirmed.forEach((item) => showToast('success', item.message));
    }).catch((error: unknown) => {
      demoSuccessQueue.current = [];
      markDemoIssue(error instanceof Error ? error.message : 'Écriture locale impossible.');
    });
  }, [state, authPort.kind, markDemoIssue, showToast, demoSuccessVersion]);

  useEffect(() => {
    if (authPort.kind !== 'local') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const current = stateRef.current;
      if (!hasDemoStateToPersist(current, demoBaseline.current)) return;
      // Une alerte native est une protection supplémentaire, pas une garantie :
      // certains navigateurs l'ignorent ou l'exigent après une interaction.
      if (serializeDemoState(current) !== demoBaseline.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [authPort.kind]);

  useEffect(() => {
    if (authPort.kind !== 'local') return;
    const onStorage = (event: StorageEvent) => {
      if ((event.key === DEMO_STATE_KEY || event.key === null) && event.newValue !== demoBaseline.current) {
        markDemoIssue('Les données ont changé dans un autre onglet. Les modifications de cet onglet ne sont pas conservées ; sauvegardez les données, puis rechargez.');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [authPort.kind, markDemoIssue]);

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
    const current = beginRequest('employeeInvitations');
    const list = await authPort.listInvitations();
    if (generation !== authGenerationRef.current || !current()) {
      throw new ApiError('employee_read_superseded', 'La lecture des invitations a été remplacée : actualisez les comptes.');
    }
    setInvitations((previous) => generation === authGenerationRef.current && current() ? list : previous);
    return list;
  }, [authPort, beginRequest]);

  const refreshUsers = useCallback(async (): Promise<AppUser[]> => {
    const generation = authGenerationRef.current;
    const current = beginRequest('employeeUsers');
    const users = await authPort.refreshUsers();
    if (generation !== authGenerationRef.current || !current()) {
      throw new ApiError('employee_read_superseded', 'La lecture des comptes a été remplacée : actualisez-les.');
    }
    setState((s) => generation === authGenerationRef.current && current() ? { ...s, users } : s);
    return users;
  }, [authPort, beginRequest]);

  const applyAuthChange = useCallback((change: AuthChange) => {
    const value = change.identity;
    if (change.type === 'PASSWORD_RECOVERY') setAuthRecovery(true);

    if (!value || !value.active || !value.emailConfirmed) {
      authGenerationRef.current += 1;
      authKeyRef.current = 'signed-out';
      scopeRef.current = { epoch: scopeRef.current.epoch + 1, userId: null, companyId: null, stationId: null };
      setState((s) => isRemoteAuth ? emptyState() : { ...s, session: null });
      setIdentity(null);
      setInvitations([]);
      setEmployeeReadWarning(null);
      setUnconfirmedInvitation(null);
      unconfirmedInvitationRef.current = null;
      setUnconfirmedAccountUpdate(null);
      unconfirmedAccountUpdateRef.current = null;
      setRevocationRecovery(null);
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
    if (!sameUser) {
      setEmployeeReadWarning(null); setUnconfirmedInvitation(null);
      unconfirmedInvitationRef.current = null; setUnconfirmedAccountUpdate(null);
      unconfirmedAccountUpdateRef.current = null; setRevocationRecovery(null);
    }
    const previousStation = stateRef.current.station;
    const available = new Set(value.stations.map((s) => s.id));
    const selected = [sameUser ? previousScope.stationId : null,
      rememberedStation(value.userId, value.companyId), value.stations[0]?.id ?? null]
      .find((id): id is string => Boolean(id && available.has(id))) ?? null;
    const changedScope = !sameUser || previousScope.stationId !== selected;
    // Des permissions peuvent être retirées sans changer de station. Ne pas
    // conserver une projection chargée sous les anciennes autorisations.
    const invalidate = changedScope || (isRemoteAuth && sameUser && key !== authKeyRef.current);
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
    if (isRemoteAuth && !sameUser) setAuthReady(false);
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
      // Ces lectures initiales partagent les mêmes versions que les relectures
      // après mutation : une réponse tardive ne doit pas restaurer un ancien état.
      const usersCurrent = beginRequest('employeeUsers');
      let current = usersCurrent;
      try {
        const { users } = await authPort.listUsers();
        if (authGenerationRef.current !== generation) return;
        if (isRemoteAuth && usersCurrent()) {
          // Une sélection effectuée pendant la lecture est conservée.
          const projected = mapIdentityToAppState(value, users, scopeRef.current.stationId);
          setState((s) => authGenerationRef.current === generation && usersCurrent() && s.session?.userId === value.userId
            ? { ...s, users: projected.users } : s);
        }
        current = beginRequest('employeeInvitations');
        const invitationsCurrent = current;
        const nextInvitations = await authPort.listInvitations();
        if (authGenerationRef.current === generation && invitationsCurrent()) {
          setInvitations((previous) => authGenerationRef.current === generation && invitationsCurrent() ? nextInvitations : previous);
        }
      } catch {
        if (authGenerationRef.current === generation && current()) {
          setAuthError('Lecture du profil ou des permissions impossible.');
          if (isRemoteAuth) {
            setEmployeeReadWarning((warning) => warning ?? 'Les comptes ou les invitations n’ont pas pu être relus. Actualisez-les avant toute action.');
          }
        }
      } finally {
        if (authGenerationRef.current === generation) setAuthReady(true);
      }
    })();
  }, [authPort, isRemoteAuth, beginRequest, sessionFromIdentity, reasonMessage]);

  const selectStation = useCallback((stationId: string) => {
    if (!isRemoteAuth || !authReady || !identity
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

  const refreshSubscriptionAccess = useCallback(async (): Promise<SubscriptionAccess | null> => {
    if (authPort.kind === 'local') return localSubscriptionAccess(stateRef.current, plans);
    const scope = { ...scopeRef.current };
    const commands = adapter.subscriptionCommands;
    if (!serverSubscription || !commands || !authReady || !identity || identity.isPlatformAdmin
      || !scope.userId || !scope.companyId || scope.userId !== identity.userId) {
      throw new ApiError('subscription_unavailable', 'Abonnement serveur indisponible pour cette session.');
    }
    const current = beginRequest('subscriptionAccess');
    setSubscriptionLoad({ epoch: scope.epoch, userId: scope.userId, companyId: scope.companyId,
      status: 'loading', access: null, error: null });
    try {
      const access = await commands.read(scope.companyId);
      if (!current()) throw new ApiError('station_changed', 'Session ou station changée pendant la lecture de l’abonnement.');
      setSubscriptionLoad({ epoch: scope.epoch, userId: scope.userId, companyId: scope.companyId,
        status: 'ready', access, error: null });
      setState((s) => current() && s.session?.userId === scope.userId ? {
        ...s, subscription: { id: access.id, companyId: access.companyId, planId: access.planId,
          status: access.status === 'trial' ? 'essai' : access.status === 'active' ? 'active' : 'suspendue',
          startedAt: access.startedAt, trialEndsAt: access.trialEndsAt, pendingPlanId: access.pendingPlanId },
      } : s);
      return access;
    } catch (error) {
      if (current()) setSubscriptionLoad({ epoch: scope.epoch, userId: scope.userId, companyId: scope.companyId,
        status: 'error', access: null, error: error instanceof Error ? error.message : 'Lecture impossible.' });
      throw error;
    }
  }, [adapter, authPort.kind, serverSubscription, authReady, identity, beginRequest, plans]);

  useEffect(() => {
    if (!serverSubscription || !authReady || !identity?.companyId || identity.isPlatformAdmin) return;
    const read = () => { void refreshSubscriptionAccess().catch(() => { /* état d’erreur visible et écriture bloquée */ }); };
    read();
    const interval = window.setInterval(read, 60_000);
    window.addEventListener('focus', read);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', read); };
  }, [serverSubscription, authReady, identity?.userId, identity?.companyId, identity?.isPlatformAdmin,
    scopeRef.current.epoch, refreshSubscriptionAccess]);

  // Réafficher la lecture seule à l'échéance de l'essai OU de la période
  // payante. L'heure estimée vient du serveur, qui reste toujours l'autorité.
  useEffect(() => {
    const deadline = subscriptionAccess?.clientWriteDeadline;
    if (deadline === null || deadline === undefined || !subscriptionAccess?.canWrite) return;
    let timer: number | undefined;
    const schedule = () => {
      const wait = deadline - Date.now();
      if (wait <= 0) { setSubscriptionClock((n) => n + 1); return; }
      // Une période mensuelle peut dépasser la limite d'un setTimeout.
      timer = window.setTimeout(schedule, Math.min(wait + 50, 2_147_000_000));
    };
    schedule();
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [subscriptionAccess?.clientWriteDeadline, subscriptionAccess?.canWrite]);

  const refreshSubscriptionRequests = useCallback(async (): Promise<void> => {
    if (!serverSubscription || !authReady || !identity?.isPlatformAdmin || !adapter.subscriptionCommands) {
      setSubscriptionRequests([]); return;
    }
    const current = beginRequest('subscriptionRequests');
    try {
      const requests = await adapter.subscriptionCommands.listRequests();
      if (current()) { setSubscriptionRequests(requests); setSubscriptionRequestsError(null); }
    } catch (error) {
      if (current()) { setSubscriptionRequests([]); setSubscriptionRequestsError(error instanceof Error ? error.message : 'Demandes indisponibles.'); }
      throw error;
    }
  }, [adapter, serverSubscription, authReady, identity?.isPlatformAdmin, beginRequest]);

  // Paire clair/sombre mémorisée : la bascule rapide alterne entre les derniers
  // thèmes clair et sombre choisis (washguard / washguard-dark par défaut).
  const themePair = useRef<{ light: string; dark: string }>({
    light: DEFAULT_LIGHT_THEME,
    dark: DEFAULT_DARK_THEME,
  });

  const rememberTheme = useCallback((name: string) => {
    if (!isKnownTheme(name)) return;
    const scheme = themeScheme(name);
    themePair.current = { ...themePair.current, [scheme]: name };
    try {
      localStorage.setItem(`washguard.theme.${scheme}`, name);
    } catch { /* préférence facultative */ }
  }, []);

  // Amorce la paire clair/sombre depuis le stockage, et enregistre le thème
  // courant : la bascule est correcte dès le premier clic, même après
  // rechargement (le thème initial est déjà lu dans `useState`).
  useEffect(() => {
    const stored = (key: string, fallback: string, scheme: 'light' | 'dark') => {
      try {
        const value = localStorage.getItem(key);
        return isKnownTheme(value) && themeScheme(value) === scheme ? value : fallback;
      } catch { return fallback; }
    };
    themePair.current = {
      light: stored('washguard.theme.light', DEFAULT_LIGHT_THEME, 'light'),
      dark: stored('washguard.theme.dark', DEFAULT_DARK_THEME, 'dark'),
    };
    rememberTheme(themeName);
  }, [rememberTheme, themeName]);

  const setTheme = useCallback((name: string) => {
    if (!isKnownTheme(name)) return;
    rememberTheme(name);
    setThemeName(name);
  }, [rememberTheme]);

  // Bascule rapide clair/sombre : elle revient au dernier thème clair (ou
  // sombre) utilisé, avec washguard / washguard-dark comme valeurs par défaut.
  const toggleTheme = useCallback(() => {
    setThemeName((current) => {
      const target = themeScheme(current) === 'dark' ? themePair.current.light : themePair.current.dark;
      return isKnownTheme(target) ? target : DEFAULT_THEME;
    });
  }, []);

  // Persistance + application au document. `data-theme` est la source de vérité
  // de DaisyUI ; la classe `dark` est conservée pour compatibilité.
  useEffect(() => {
    const scheme = themeScheme(themeName);
    const root = document.documentElement;
    root.classList.toggle('dark', scheme === 'dark');
    root.setAttribute('data-theme', themeName);
    try {
      localStorage.setItem('washguard.theme.name', themeName);
      localStorage.setItem('washguard.theme', scheme);
      localStorage.setItem('washguard.theme.v', THEME_PREFERENCE_VERSION);
    } catch { /* préférence facultative */ }
    // La barre du navigateur mobile (et l'écran de démarrage PWA) suivent le
    // thème actif : on recopie `base-100` dans la balise `theme-color`.
    try {
      const meta = document.querySelector('meta[name="theme-color"]');
      const base = getComputedStyle(root).getPropertyValue('--color-base-100').trim();
      if (meta && base) meta.setAttribute('content', base);
    } catch { /* balise absente ou CSS non calculable */ }
  }, [themeName]);

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

  // La projection complète est relue pour une station et une session vérifiées.
  // Une réponse tardive ne traverse jamais un changement de compte ou station.
  const readSetup = useCallback(async (background = false): Promise<StationSetupSnapshot> => {
    const commands = adapter.setupCommands;
    const scope = { ...scopeRef.current };
    if (!serverSetup || !commands || !authReady || !identity || !scope.stationId || !scope.companyId) {
      throw new ApiError('server_unavailable', 'Lecture du paramétrage serveur indisponible.');
    }
    const current = beginRequest('setup');
    if (!background) setSetupLoad({ epoch: scope.epoch, status: 'loading', error: null });
    try {
      const snapshot = await commands.read(scope.stationId);
      if (!current() || snapshot.company.id !== scope.companyId || snapshot.station.id !== scope.stationId) {
        throw new ApiError('station_changed', 'La station ou la session a changé : rechargez avant de poursuivre.');
      }
      const catalog = mapCatalogToState(snapshot.catalog);
      setState((cur) => current() && cur.session?.userId === scope.userId && cur.station?.id === scope.stationId
        ? { ...cur, company: snapshot.company, station: snapshot.station, ...catalog } : cur);
      setSetupLoad({ epoch: scope.epoch, status: 'ready', error: null });
      return snapshot;
    } catch (error) {
      if (current()) setSetupLoad({ epoch: scope.epoch, status: 'error',
        error: error instanceof Error ? error.message : 'Lecture du paramétrage impossible.' });
      throw error;
    }
  }, [adapter, serverSetup, authReady, identity, beginRequest]);

  const refreshSetup = useCallback(async (): Promise<void> => { await readSetup(); }, [readSetup]);
  useEffect(() => {
    if (!serverSetup || !authReady || !identity || !state.station?.id) return;
    void readSetup().catch(() => { /* l'écran affiche l'erreur et propose une relecture */ });
  }, [serverSetup, authReady, identity?.userId, state.station?.id, scopeRef.current.epoch, readSetup]);

  const setupRpc = useCallback(async <T,>(
    action: (commands: NonNullable<DataAdapter['setupCommands']>, stationId: string) => Promise<T>,
    verified: (snapshot: StationSetupSnapshot, value: T) => boolean,
  ): Promise<void> => {
    const commands = adapter.setupCommands;
    const scope = { ...scopeRef.current };
    if (!serverSetup || !commands || !scope.stationId || setupLoad.epoch !== scope.epoch || setupLoad.status !== 'ready') {
      throw new ApiError('server_unavailable', 'Relisez la station avant de modifier ses réglages.');
    }
    if (setupInFlight.current) throw new ApiError('operation_pending', 'Un enregistrement est déjà en cours. Patientez.');
    setupInFlight.current = true;
    try {
      let result: T;
      try { result = await action(commands, scope.stationId); }
      catch (error) {
        if (scope.epoch === scopeRef.current.epoch) setSetupLoad({ epoch: scope.epoch, status: 'error',
          error: 'Écriture non confirmée. Relisez et vérifiez les données avant de réessayer.' });
        throw error;
      }
      if (scope.epoch !== scopeRef.current.epoch) throw new ApiError('station_changed', 'Station changée : vérifiez l’opération dans sa station d’origine.');
      let snapshot: StationSetupSnapshot;
      try { snapshot = await readSetup(true); }
      catch { throw new Error('Écriture envoyée, mais relecture impossible : vérifiez les données avant de réessayer.'); }
      if (scope.epoch !== scopeRef.current.epoch) throw new ApiError('station_changed', 'Station changée : vérifiez l’opération dans sa station d’origine.');
      if (!verified(snapshot, result)) {
        setSetupLoad({ epoch: scope.epoch, status: 'error', error: 'La relecture ne confirme pas cette modification. Vérifiez les données avant de réessayer.' });
        throw new Error('La relecture ne confirme pas cette modification. Vérifiez les données avant de réessayer.');
      }
    } finally { setupInFlight.current = false; }
  }, [adapter, serverSetup, setupLoad, readSetup]);

  // ── Prompt 05 + 06 : boards serveur et commandes RPC ───────────────────────
  const refreshFinance = useCallback(async (from?: string, to?: string, expected?: { id: string; pending: PendingExpense }, requireCurrent = false): Promise<void> => {
    const mustRead = Boolean(expected || requireCurrent);
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const start = from ?? financePeriod.current?.start ?? `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
    const endStr = to ?? financePeriod.current?.end ?? todayISO();
    validatePeriod(start, endStr, 366);
    if (from !== undefined || to !== undefined) financePeriod.current = { start, end: endStr };
    if (!serverFinance) {
      if (mustRead) throw new Error('Lecture finance serveur indisponible.');
      setState((cur) => withFinanceDefaults({ ...cur, profitability: localProfitability(cur, start, endStr) }));
      return;
    }
    const stationId = scopeRef.current.stationId;
    if (!authReady || !identity || !stationId || !identity.permissions.some((p) =>
      ['reports.view', 'cash.open', 'cash.close', 'cash.reopen', 'expenses.create', 'expenses.cancel', 'commissions.view'].includes(p))) {
      if (mustRead) throw new Error('Lecture finance non autorisée ou indisponible.');
      return;
    }
    if (expected && (stationId !== expected.pending.stationId || identity.userId !== expected.pending.userId)) {
      throw new Error('La session ou la station ne correspond pas à la dépense.');
    }
    const current = beginRequest('finance');
    try {
      const [board, report] = await Promise.all([
        adapter.listFinanceBoard(stationId),
        identity.permissions.includes('reports.view') ? adapter.listProfitability(start, endStr, stationId) : Promise.resolve(null),
      ]);
      if (!current()) {
        if (mustRead) throw new Error('Lecture finance dépassée par une autre actualisation.');
        return;
      }
      if (expected) {
        const p = expected.pending.payload;
        const found = board.expenses.find((expense) => expense.id === expected.id
          && expense.stationId === stationId && expense.idempotencyKey === p.idempotencyKey
          && expense.amount === p.amount && expense.category.toLowerCase() === p.category.toLowerCase()
          && expense.reason === p.reason && expense.supplier === p.supplier && expense.date === p.date
          && expense.method === p.method && expense.status === 'enregistree');
        if (!found) throw new Error('La dépense n’a pas été confirmée par la relecture.');
      }
      setState((cur) => {
        if (!current()) return cur;
        return withStockDefaults(withFinanceDefaults({ ...cur, ...board, profitability: report }));
      });
    } catch (error) { if (current() || mustRead) throw error; }
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
      const [board, clients, assignable] = await Promise.all([
        adapter.listWashBoard(stationId), adapter.listClients(stationId),
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
      setAssignableUsers(assignable);
      setState((cur) => {
        if (!current()) return cur;
        return { ...cur, washes: board.washes, washPosts: board.posts,
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
    if (!authReady || !identity || !stationId || !identity.permissions.includes('inventory.view')
      || (!identity.isPlatformAdmin && !subscriptionAccess?.features.stock)) return;
    const current = beginRequest('stock');
    try {
      const board: StockSnapshot = await adapter.listStockBoard(stationId);
      if (current()) setState((cur) => current() ? withStockDefaults({ ...cur, ...board }) : cur);
    } catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverStock, authReady, identity, state.station?.id, subscriptionAccess?.features.stock]);

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
    if (!canReadAnalytics) return;
    if (!serverAnalytics) {
      const board = analyticsBoardFromState(stateRef.current, start, end, compareStart, compareEnd);
      setAnalyticsBoard(canReadStockAnalytics ? board : redactStockAnalytics(board));
      return;
    }
    if (!authReady || !identity || !identity.permissions.includes('analytics.view') || !identity.permissions.includes('reports.view')) return;
    const rightsVersion = analyticsRights.current.version;
    const requestCurrent = beginRequest('analytics');
    const current = () => requestCurrent() && analyticsRights.current.version === rightsVersion;
    try {
      const board = await adapter.listAnalyticsBoard(start, end, compareStart, compareEnd);
      if (current() && analyticsRights.current.canRead) {
        setAnalyticsBoard((previous) => !current() || !analyticsRights.current.canRead ? previous
          : analyticsRights.current.canReadStock ? board : redactStockAnalytics(board));
        setAnalyticsError(null);
      }
    } catch (error) {
      if (current()) {
        setAnalyticsError(error instanceof Error ? error.message : 'Lecture analytics impossible.');
        throw error;
      }
    }
  }, [adapter, beginRequest, serverAnalytics, authReady, identity, state.station?.id, canReadAnalytics, canReadStockAnalytics]);

  const canReadSubscriptionUsage = Boolean(identity && (identity.isPlatformAdmin || identity.permissions.includes('subscription.manage')
    || (identity.permissions.includes('analytics.view') && subscriptionAccess?.features.consolidation)));
  const refreshSubscriptionUsage = useCallback(async (periodStart: string = quotaMonthStartISO(), requireCurrent = false): Promise<void> => {
    if (!serverAnalytics) {
      const usage = subscriptionUsageFromState(stateRef.current, periodStart);
      setSubscriptionUsage(usage); setPlatformBoard(platformBoardFromState(stateRef.current, getPlans())); return;
    }
    if (!authReady || !canReadSubscriptionUsage) {
      // Une lecture explicitement requise ne peut pas être confirmée par un
      // retour silencieux. Les appels facultatifs, eux, restent sans requête
      // lorsque le rôle ou la formule ne donnent pas accès aux quotas.
      if (requireCurrent) throw new ApiError('subscription_usage_unavailable', 'Relecture des quotas indisponible pour cette session.');
      return;
    }
    const current = beginRequest('subscription');
    // Ne pas présenter un ancien relevé comme frais pendant ou après une
    // relecture échouée. Les limites serveur restent l'autorité pour les quotas.
    setSubscriptionUsage(emptySubscriptionUsage(periodStart));
    try {
      const usage = await adapter.listSubscriptionUsage(periodStart);
      if (!current()) {
        if (requireCurrent) throw new ApiError('subscription_read_superseded', 'Relecture des quotas remplacée : actualisez-les.');
        return;
      }
      setSubscriptionUsage((previous) => current() ? usage : previous);
    } catch (error) {
      if (current()) {
        setSubscriptionUsage((previous) => current() ? emptySubscriptionUsage(periodStart) : previous);
        throw error;
      }
      if (requireCurrent) throw new ApiError('subscription_read_superseded', 'Relecture des quotas remplacée : actualisez-les.');
    }
  }, [adapter, beginRequest, serverAnalytics, authReady, identity?.userId, state.station?.id, canReadSubscriptionUsage]);

  const refreshPlatform = useCallback(async (): Promise<void> => {
    if (!serverAnalytics) { setPlatformBoard(platformBoardFromState(stateRef.current, getPlans())); setPlatformError(null); return; }
    if (!authReady || !identity?.isPlatformAdmin) return;
    const current = beginRequest('platform');
    try { const board = await adapter.listPlatformBoard(); if (current()) { setPlatformBoard(board); setPlatformError(null); } }
    catch (error) { if (current()) throw error; }
  }, [adapter, beginRequest, serverAnalytics, authReady, identity, state.station?.id]);

  const refreshUsageCounters = useCallback(async (periodStart: string = quotaMonthStartISO()): Promise<void> => {
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
      try {
        if (scopeRef.current.epoch !== epoch) throw new Error('station changée');
        await refreshWashes();
        if (scopeRef.current.epoch !== epoch) throw new Error('station changée');
        await refreshFinance(undefined, undefined, undefined, true);
        if (scopeRef.current.epoch !== epoch) throw new Error('station changée');
      } catch {
        // La commande a pu être validée. Ne pas la répéter aveuglément : la
        // lecture peut avoir échoué ou avoir été supplantée par une autre.
        throw new ApiError('finance_unconfirmed', 'Commande envoyée, mais relecture finance non confirmée. Vérifiez la station et l’historique avant de répéter.');
      }
      return value;
    });
  }, [adapter, refreshWashes, refreshFinance]);

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
      || (isRemoteAuth && stationId !== scopeRef.current.stationId)) {
      throw new ApiError('station_changed', 'Cette opération ne concerne pas la station sélectionnée.');
    }
  }, [isRemoteAuth]);

  // ── Prompt 08 : 17 actions, sync locales ou RPC serveur ────────────────────
  const saveCustomerProfile = useCallback((p: CustomerProfilePayload) => {
    assertSelectedStation(p.stationId); validateCustomer(p);
    return serverCrm ? crmRpc((c) => c.saveCustomerProfile(p))
      : crmLocal((s) => {
        const access = localSubscriptionAccess(s, plans);
        const existing = s.clients.find((client) => client.id === p.customerId);
        return saveCustomerProfileLocal(s, { ...p,
          loyaltyOptIn: access?.features.loyalty ? p.loyaltyOptIn : existing?.loyaltyOptIn ?? false,
          fleetId: access?.features.fleets ? p.fleetId : existing?.fleetId ?? null });
      });
  }, [assertSelectedStation, serverCrm, crmRpc, crmLocal, plans]);
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
    if (authPort.kind === 'local' && demoIssueRef.current) throw new ApiError('demo_storage_unavailable', demoIssueRef.current);
    const result = await authPort.signUp(p);
    if (!result.confirmationRequired) notify('success', 'Votre espace est prêt. Bienvenue !');
    return result;
  }, [authPort, notify]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (authPort.kind === 'local' && demoIssueRef.current) throw new ApiError('demo_storage_unavailable', demoIssueRef.current);
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
      setState((s) => isRemoteAuth ? emptyState() : { ...s, session: null });
      setAssignableUsers([]); setStationMetrics(null); setStationMetricsError(null);
      setAnalyticsBoard(emptyAnalyticsBoard()); setSubscriptionUsage(emptySubscriptionUsage()); setPlatformBoard(emptyPlatformBoard());
      setIdentity(null);
      setInvitations([]);
      setEmployeeReadWarning(null);
      setUnconfirmedInvitation(null);
      unconfirmedInvitationRef.current = null;
      setUnconfirmedAccountUpdate(null);
      unconfirmedAccountUpdateRef.current = null;
      setRevocationRecovery(null);
      setAuthRecovery(false);
      setAuthError(null);
      setToasts([]);
    }
    await authPort.signOut();
    await clearOfflineApiCache();
  }, [authPort, isRemoteAuth]);

  const requestPasswordReset = useCallback((email: string) =>
    authPort.requestPasswordReset(email), [authPort]);

  const updatePassword = useCallback(async (password: string, token?: string) => {
    await authPort.updatePassword(password, token);
    setAuthRecovery(false);
  }, [authPort]);

  const verifyResetToken = useCallback((token: string) => authPort.verifyResetToken(token), [authPort]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await authPort.changePassword(currentPassword, newPassword);
    notify('success', result.revoked > 0
      ? `Mot de passe mis à jour. ${result.revoked} autre(s) session(s) fermée(s).`
      : 'Mot de passe mis à jour.');
    return result;
  }, [authPort, notify]);

  const listSessions = useCallback(() => authPort.listSessions(), [authPort]);
  const revokeSession = useCallback((sessionId: string) => authPort.revokeSession(sessionId), [authPort]);
  const revokeOtherSessions = useCallback(() => authPort.revokeOtherSessions(), [authPort]);
  const listAuthActivity = useCallback((limit?: number) => authPort.listAuthActivity(limit), [authPort]);
  const confirmEmail = useCallback((token: string) => authPort.confirmEmail(token), [authPort]);
  const resendConfirmation = useCallback((email: string) => authPort.resendConfirmation(email), [authPort]);

  const refreshEmployeeData = useCallback(async (): Promise<void> => {
    const generation = authGenerationRef.current;
    // Certains rôles (par exemple un gérant en Standard) ne peuvent pas lire
    // les quotas : ne pas prétendre les relire ni bloquer la gestion courante
    // uniquement pour cette permission absente. Si la lecture était autorisée,
    // elle est obligatoire et doit rester la plus récente.
    const results = await Promise.allSettled(isRemoteAuth
      ? [refreshUsers(), refreshInvitations(), refreshSubscriptionAccess(),
        ...(canReadSubscriptionUsage ? [refreshSubscriptionUsage(quotaMonthStartISO(), true)] : [])]
      : [refreshInvitations()]);
    if (generation !== authGenerationRef.current) {
      throw new ApiError('session_changed', 'Session modifiée pendant la relecture des comptes.');
    }
    if (results.some((result) => result.status === 'rejected')) {
      throw new ApiError('employee_read_failed', 'Actualisation incomplète : réessayez avant toute action.');
    }
    setEmployeeReadWarning(null);
  }, [isRemoteAuth, refreshUsers, refreshInvitations, refreshSubscriptionAccess, refreshSubscriptionUsage, canReadSubscriptionUsage]);

  const assertNoUnconfirmedAccountOperation = useCallback(() => {
    const pendingInvite = unconfirmedInvitationRef.current;
    if (pendingInvite && pendingInvite.userId === identity?.userId && pendingInvite.companyId === identity.companyId) {
      throw new ApiError('invite_pending', 'Vérifiez l’invitation non confirmée avec le support avant toute autre action sur les comptes.');
    }
    const pendingUpdate = unconfirmedAccountUpdateRef.current;
    if (pendingUpdate && pendingUpdate.userId === identity?.userId && pendingUpdate.companyId === identity.companyId) {
      throw new ApiError('update_pending', 'Vérifiez la modification non confirmée avec le support avant toute autre action sur les comptes.');
    }
    if (identity?.userId && identity.companyId) {
      const key = `${identity.userId}:${identity.companyId}`;
      if (invitationsInFlight.current.has(key)) throw new ApiError('invite_in_flight', 'Une invitation est déjà en cours.');
      if (accountUpdatesInFlight.current.has(key)) throw new ApiError('update_in_flight', 'Une modification de compte est déjà en cours.');
    }
  }, [identity?.userId, identity?.companyId]);

  const assertNoPendingRevocation = useCallback(() => {
    assertNoUnconfirmedAccountOperation();
    if (!isRemoteAuth || !identity?.userId || !identity.companyId) return;
    const userId = identity.userId;
    const companyId = identity.companyId;
    let pending: PendingRevocation | null;
    try { pending = readPendingRevocation(userId, companyId); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Stockage de session inaccessible : vérifiez avec le support.';
      setRevocationRecovery({ userId, companyId, pending: null, error: message });
      throw new ApiError('revoke_storage', message);
    }
    if (pending) {
      setRevocationRecovery({ userId, companyId, pending, error: null });
      throw new ApiError('revoke_pending', 'Vérifiez la révocation précédente avant toute autre action sur les comptes.');
    }
  }, [isRemoteAuth, identity?.userId, identity?.companyId, assertNoUnconfirmedAccountOperation]);

  const inviteUser = useCallback(async (p: InvitePayload) => {
    assertNoPendingRevocation();
    const generation = authGenerationRef.current;
    const userId = identity?.userId;
    const companyId = identity?.companyId;
    const lockKey = isRemoteAuth && userId && companyId ? `${userId}:${companyId}` : null;
    if (lockKey) invitationsInFlight.current.add(lockKey);
    try {
      let result: { id: string; message?: string; inviteUrl?: string };
      try { result = await authPort.invite(p); }
      catch (error) {
        if (userId && companyId && scopeRef.current.userId === userId && scopeRef.current.companyId === companyId
          && isRemoteAuth && error instanceof ApiError
          && ['invite_unconfirmed', 'reservation_unconfirmed'].includes(error.code)) {
          const email = p.email.trim().toLowerCase();
          unconfirmedInvitationRef.current = { userId, companyId };
          setUnconfirmedInvitation({ email, message: `Invitation ou réservation non confirmée pour ${email} : un compte ou un e-mail peut déjà exister. Ne renvoyez pas avant vérification par le support. Ce rappel disparaît au rechargement ou à la déconnexion : notez l’adresse et faites vérifier son état.` });
        }
        throw error;
      }
      if (generation !== authGenerationRef.current) return result;
      try { await refreshEmployeeData(); }
      catch {
        if (generation === authGenerationRef.current) {
          const warning = 'Invitation enregistrée, mais données non relues. Actualisez-les avant toute autre action.';
          setEmployeeReadWarning(warning);
          notify('info', warning);
        }
        return result;
      }
      if (generation === authGenerationRef.current) notify('success', result.message ?? 'Invitation envoyée.');
      return result;
    } finally {
      if (lockKey) invitationsInFlight.current.delete(lockKey);
    }
  }, [authPort, isRemoteAuth, identity?.userId, identity?.companyId, assertNoPendingRevocation, refreshEmployeeData, notify]);

  const revokeInvitation = useCallback(async (id: string) => {
    assertNoUnconfirmedAccountOperation();
    const generation = authGenerationRef.current;
    let attempt: PendingRevocation | null = null;
    let wasPending = false;
    let lockKey: string | null = null;
    const showRecovery = (pending: PendingRevocation | null, error: string | null, userId: string, companyId: string) => {
      if (scopeRef.current.userId === userId && scopeRef.current.companyId === companyId) {
        setRevocationRecovery({ userId, companyId, pending, error });
      }
    };
    if (isRemoteAuth) {
      const userId = identity?.userId;
      const companyId = identity?.companyId;
      if (!userId || !companyId) throw new ApiError('revoke_scope', 'Compte et entreprise vérifiés requis pour révoquer une invitation.');
      lockKey = `${userId}:${companyId}`;
      if (revocationsInFlight.current.has(lockKey)) throw new ApiError('revoke_in_flight', 'Une révocation est déjà en cours.');
      revocationsInFlight.current.add(lockKey);
      try {
        const previous = readPendingRevocation(userId, companyId);
        if (previous && previous.invitationId !== id) {
          showRecovery(previous, null, userId, companyId);
          throw new ApiError('revoke_pending', 'Vérifiez la révocation précédente avant toute autre révocation.');
        }
        wasPending = Boolean(previous);
        attempt = previous ?? { version: 1, userId, companyId, invitationId: id, startedAt: new Date().toISOString() };
        if (!previous) savePendingRevocation(attempt);
        showRecovery(attempt, null, userId, companyId);
      } catch (error) {
        revocationsInFlight.current.delete(lockKey);
        if (!(error instanceof ApiError)) {
          showRecovery(null, error instanceof Error ? error.message : 'Stockage de session inaccessible : vérifiez avec le support.', userId, companyId);
        }
        throw error;
      }
    }
    try {
      try { await authPort.revokeInvitation(id); }
      catch (error) {
        if (attempt && !wasPending && error instanceof ApiError && error.code !== 'revoke_unconfirmed') {
          try {
            clearPendingRevocation(attempt);
            showRecovery(null, null, attempt.userId, attempt.companyId);
          } catch (storageError) {
            showRecovery(null, storageError instanceof Error ? storageError.message : 'Effacement non confirmé : vérifiez avec le support.', attempt.userId, attempt.companyId);
          }
        }
        throw error;
      }
      if (attempt) {
        try {
          clearPendingRevocation(attempt);
          showRecovery(null, null, attempt.userId, attempt.companyId);
        } catch {
          const warning = 'Révocation enregistrée, mais effacement du rappel non confirmé. Vérifiez les comptes et invitations avec le support avant toute autre action.';
          showRecovery(null, warning, attempt.userId, attempt.companyId);
          if (generation === authGenerationRef.current) notify('info', warning);
          return;
        }
      }
      if (generation !== authGenerationRef.current) return;
      try { await refreshEmployeeData(); }
      catch {
        if (generation === authGenerationRef.current) {
          const warning = 'Révocation enregistrée, mais données non relues. Actualisez-les avant toute autre action.';
          setEmployeeReadWarning(warning);
          notify('info', warning);
        }
        return;
      }
      if (generation === authGenerationRef.current) notify('success', 'Invitation révoquée et accès du compte désactivé.');
    } finally {
      if (lockKey) revocationsInFlight.current.delete(lockKey);
    }
  }, [authPort, isRemoteAuth, identity?.userId, identity?.companyId, assertNoUnconfirmedAccountOperation, refreshEmployeeData, notify]);

  const updateUser = useCallback(async (p: UpdateUserPayload) => {
    assertNoPendingRevocation();
    const generation = authGenerationRef.current;
    const userId = identity?.userId;
    const companyId = identity?.companyId;
    const lockKey = isRemoteAuth && userId && companyId ? `${userId}:${companyId}` : null;
    if (lockKey) accountUpdatesInFlight.current.add(lockKey);
    try {
      await authPort.updateUser(p);
    } catch (error) {
      if (userId && companyId && scopeRef.current.userId === userId && scopeRef.current.companyId === companyId
        && isRemoteAuth && (!(error instanceof ApiError) || error.code === 'update_unconfirmed')) {
        unconfirmedAccountUpdateRef.current = { userId, companyId };
        setUnconfirmedAccountUpdate({ userId: p.userId,
          message: `Modification de compte non confirmée : elle a peut-être été enregistrée. Les états affichés peuvent être périmés. Ne répétez pas l’action et faites vérifier le compte ${p.userId} avec le support. Ce rappel disparaît au rechargement ou à la déconnexion : notez l’identifiant et les changements demandés.` });
      }
      throw error;
    } finally {
      if (lockKey) accountUpdatesInFlight.current.delete(lockKey);
    }
    if (generation !== authGenerationRef.current) return;
    try { await refreshEmployeeData(); }
    catch {
      if (generation === authGenerationRef.current) {
        const warning = 'Compte mis à jour, mais données non relues. Actualisez-les avant toute autre action.';
        setEmployeeReadWarning(warning);
        notify('info', warning);
      }
      return;
    }
    if (generation === authGenerationRef.current) notify('success', 'Compte mis à jour.');
  }, [authPort, identity?.userId, identity?.companyId, assertNoPendingRevocation, refreshEmployeeData, notify]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  // ── Données de base ────────────────────────────────────────────────────────
  const updateCompany = useCallback((patch: Partial<Company>) => {
    if (patch.phone !== undefined) validatePhone(patch.phone);
    if (serverSetup) {
      if (Object.keys(patch).some((key) => !['name', 'city', 'phone'].includes(key))) throw new ApiError('invalid_field', 'Champ entreprise non modifiable ici.');
      return setupRpc((c, station) => c.saveCompany(station, patch), (snapshot) => setupPatchMatches(snapshot.company, patch));
    }
    if (!localSetup) throw new ApiError('server_unavailable', 'Modification indisponible dans cette configuration.');
    return mutate((s) => {
      if (!s.company) return s;
      const company = { ...s.company, ...patch };
      return { ...s, company, platformCompanies: s.platformCompanies.map((c) => c.id === company.id
        ? { ...c, name: company.name, city: company.city, phone: company.phone } : c),
        auditLogs: logAction(s, 'Entreprise modifiée', Object.keys(patch).join(', ')) };
    });
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const updateStation = useCallback((patch: Partial<Station>) => {
    if (patch.phone !== undefined) validatePhone(patch.phone);
    if (patch.maxCashierDiscount !== undefined) validateMoney(patch.maxCashierDiscount);
    if (patch.monthlyTarget !== undefined) validateMoney(patch.monthlyTarget);
    if (patch.commissionRate !== undefined) validatePercentage(patch.commissionRate);
    if (serverSetup) {
      const allowedKeys = dataSource === 'api'
        ? ['name', 'address', 'city', 'phone', 'hours', 'paymentMethods', 'commissionRate', 'monthlyTarget', 'cashRequiresOpen', 'maxCashierDiscount']
        : ['name', 'address', 'city', 'phone', 'hours', 'paymentMethods', 'commissionRate', 'monthlyTarget'];
      if (Object.keys(patch).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError('invalid_field', 'Ce réglage n’est pas disponible sur le serveur.');
      }
      return setupRpc((c, station) => c.saveStation(station, patch), (snapshot) => setupPatchMatches(snapshot.station, patch));
    }
    if (!localSetup) throw new ApiError('server_unavailable', 'Modification indisponible dans cette configuration.');
    return mutate((s) => {
      if (!s.station) return s;
      return { ...s, station: { ...s.station, ...patch }, auditLogs: logAction(s, 'Station modifiée', Object.keys(patch).join(', ')) };
    });
  }, [mutate, serverSetup, localSetup, setupRpc]);

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

  const setHours = useCallback((hours: DayHours[]) => updateStation({ hours }), [updateStation]);

  const addCategory = useCallback((name: string) => {
    if (!name.trim()) return;
    if (serverSetup) return setupRpc((c, station) => c.saveCategory(station, null, name, true),
      (snapshot, id) => snapshot.catalog.categories.some((item) => item.id === id && item.name === name.trim() && item.active));
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => {
      if (!s.station) return s;
      const cat: VehicleCategory = { id: uid('cat'), stationId: s.station.id, name: name.trim(), active: true };
      return { ...s, vehicleCategories: [...s.vehicleCategories, cat] };
    });
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const toggleCategory = useCallback((id: string) => {
    if (serverSetup) {
      const category = stateRef.current.vehicleCategories.find((item) => item.id === id);
      if (!category) throw new ApiError('not_found', 'Catégorie introuvable.');
      return setupRpc((c, station) => c.saveCategory(station, id, category.name, !category.active),
        (snapshot) => snapshot.catalog.categories.some((item) => item.id === id && item.active === !category.active));
    }
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => ({ ...s, vehicleCategories: s.vehicleCategories.map((c) => c.id === id ? { ...c, active: !c.active } : c) }));
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const removeCategory = useCallback((id: string) => {
    if (serverSetup) {
      const category = stateRef.current.vehicleCategories.find((item) => item.id === id);
      if (!category) throw new ApiError('not_found', 'Catégorie introuvable.');
      return setupRpc((c, station) => c.saveCategory(station, id, category.name, category.active, true),
        (snapshot) => !snapshot.catalog.categories.some((item) => item.id === id));
    }
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => ({ ...s, vehicleCategories: s.vehicleCategories.filter((c) => c.id !== id) }));
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const addService = useCallback((name: string, description: string) => {
    if (!name.trim()) return;
    if (serverSetup) return setupRpc((c, station) => c.saveService(station, null, name, description, true),
      (snapshot, id) => snapshot.catalog.services.some((item) => item.id === id && item.name === name.trim() && item.description === description.trim() && item.active));
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => {
      if (!s.station) return s;
      const svc: Service = { id: uid('svc'), stationId: s.station.id, name: name.trim(), description: description.trim(), active: true, prices: {} };
      return { ...s, services: [...s.services, svc] };
    });
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const updateService = useCallback((id: string, patch: Partial<Service>) => {
    if (serverSetup) {
      if (Object.keys(patch).some((key) => !['name', 'description', 'active'].includes(key))) throw new ApiError('invalid_field', 'Champ prestation non modifiable ici.');
      const service = stateRef.current.services.find((item) => item.id === id);
      if (!service) throw new ApiError('not_found', 'Prestation introuvable.');
      const next = { ...service, ...patch };
      return setupRpc((c, station) => c.saveService(station, id, next.name, next.description, next.active),
        (snapshot) => snapshot.catalog.services.some((item) => item.id === id && setupPatchMatches(item, { name: next.name, description: next.description, active: next.active })));
    }
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => ({ ...s, services: s.services.map((v) => v.id === id ? { ...v, ...patch } : v) }));
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const setPrice = useCallback((serviceId: string, categoryId: string, price: number) => {
    validateMoney(price);
    if (serverSetup) return setupRpc((c, station) => c.savePrice(station, serviceId, categoryId, price),
      (snapshot) => snapshot.catalog.prices.some((item) => item.serviceId === serviceId && item.vehicleCategoryId === categoryId && item.priceMinor === price));
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => ({ ...s, services: s.services.map((v) => v.id === serviceId
      ? { ...v, prices: { ...v.prices, [categoryId]: price } } : v) }));
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const removeService = useCallback((id: string) => {
    if (serverSetup) {
      const service = stateRef.current.services.find((item) => item.id === id);
      if (!service) throw new ApiError('not_found', 'Prestation introuvable.');
      return setupRpc((c, station) => c.saveService(station, id, service.name, service.description, service.active, true),
        (snapshot) => !snapshot.catalog.services.some((item) => item.id === id));
    }
    if (!localSetup) throw new ApiError('server_unavailable', 'Catalogue indisponible dans cette configuration.');
    return mutate((s) => ({ ...s, services: s.services.filter((v) => v.id !== id) }));
  }, [mutate, serverSetup, localSetup, setupRpc]);

  const updateEmployee = useCallback((id: string, patch: Partial<AppUser>): void | Promise<void> => {
    if (dataSource === 'api' && authPort.kind === 'api') {
      if (patch.commissionRateOverride !== undefined) {
        if (patch.commissionRateOverride !== null) validatePercentage(patch.commissionRateOverride);
        return updateUser({ userId: id, commissionRateOverride: patch.commissionRateOverride });
      }
      throw new ApiError('invalid_field', 'Champ employé non modifiable ici.');
    }
    if (!isLocalStockDemo) throw new ApiError('server_unavailable', 'Réglage individuel indisponible en mode connecté.');
    return mutate((s) => {
      const next = { ...s, users: s.users.map((u) => u.id === id ? { ...u, ...patch } : u) };
      return { ...next, auditLogs: logAction(next, 'Employé modifié', `${id} : ${Object.keys(patch).join(', ')}`) };
    });
  }, [mutate, isLocalStockDemo, dataSource, authPort.kind, updateUser]);

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
    if (p.payment && p.payment.amount > 0 && !st.paymentMethods.includes(p.payment.method)) {
      throw new ApiError('invalid_payment', 'Configurez un moyen de paiement accepté avant d’encaisser.');
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
    if (isRemoteAuth) {
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
        if (!s.station?.paymentMethods.includes(method)) throw new ApiError('invalid_payment', 'Configurez un moyen de paiement accepté avant d’encaisser.');
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
    if (!s.station?.paymentMethods.includes(method)) throw new ApiError('invalid_payment', 'Configurez un moyen de paiement accepté avant d’encaisser.');
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

  const submitPendingExpense = useCallback(async (pending: PendingExpense, recovering: boolean): Promise<void> => {
    const commands = adapter.financeCommands;
    if (!serverFinance || !commands || identity?.userId !== pending.userId
      || stateRef.current.station?.id !== pending.stationId) {
      throw new ApiError('station_changed', 'Reconnectez-vous à la même station pour vérifier cette dépense.');
    }
    const lock = `${pending.userId}:${pending.stationId}`;
    if (expensesInFlight.current.has(lock)) throw new ApiError('expense_in_flight', 'Une dépense est déjà en cours.');
    expensesInFlight.current.add(lock);
    const epoch = scopeRef.current.epoch;
    const current = () => scopeRef.current.epoch === epoch;
    const storageProblem = 'La conservation de la tentative n’est plus confirmée. Vérifiez la dépense et le stockage de cet onglet avant de continuer.';
    const keepPending = () => {
      if (!current()) return;
      setPendingExpenseState(pending);
      try { assertPendingExpense(pending); }
      catch { setPendingExpenseError(storageProblem); }
    };
    try {
      let id: string;
      try { id = await commands.addExpense(pending.payload); }
      catch (error) {
        if (current() && !recovering && error instanceof ExpenseCommandError && error.outcome === 'rejected') {
          try { clearPendingExpense(pending); if (current()) setPendingExpenseState(null); }
          catch { keepPending(); if (current()) setPendingExpenseError(storageProblem); }
        } else keepPending();
        throw error;
      }
      if (!current()) throw new ApiError('station_changed', 'Dépense envoyée à la station précédente : vérifiez-la dans cette station.');
      try { await refreshFinance(undefined, undefined, { id, pending }); }
      catch { keepPending(); throw new Error('Dépense envoyée, mais relecture non confirmée : vérifiez la même tentative.'); }
      if (!current()) throw new ApiError('station_changed', 'Station changée : vérifiez la dépense dans sa station d’origine.');
      try { clearPendingExpense(pending); }
      catch {
        keepPending();
        if (current()) setPendingExpenseError(storageProblem);
        throw new Error('Dépense confirmée, mais effacement de la tentative non confirmé : vérifiez l’historique puis rechargez cet onglet.');
      }
      setPendingExpenseState((previous) => previous?.payload.idempotencyKey === pending.payload.idempotencyKey ? null : previous);
      setPendingExpenseError(null);
      notify('success', 'Dépense enregistrée et relue.');
    } finally { expensesInFlight.current.delete(lock); }
  }, [adapter, identity?.userId, serverFinance, refreshFinance, notify]);

  const retryPendingExpense = useCallback(async (): Promise<void> => {
    const stationId = stateRef.current.station?.id;
    if (!serverFinance || !identity?.userId || !stationId) throw new ApiError('server_unavailable', 'Même compte et station requis pour vérifier la dépense.');
    if (pendingExpenseError) throw new ApiError('expense_storage', pendingExpenseError);
    const pending = readPendingExpense(identity.userId, stationId);
    if (!pending) throw new ApiError('not_found', 'Aucune tentative de dépense conservée dans cet onglet.');
    await submitPendingExpense(pending, true);
  }, [identity?.userId, serverFinance, submitPendingExpense, pendingExpenseError]);

  const addExpense = useCallback((p: Omit<Expense, 'id' | 'stationId' | 'status' | 'cancelReason' | 'createdBy' | 'createdAt' | 'cashSessionId'>): void | Promise<void> => {
    assertActivated();
    const s = stateRef.current;
    validateExpense(p);
    if (!s.station?.paymentMethods.includes(p.method)) throw new ApiError('invalid_payment', 'Configurez un moyen de paiement accepté avant d’enregistrer une dépense.');
    assertCashRule(p.method, p.amount);
    const key = p.idempotencyKey ?? idempotencyKey('expense');
    if (serverFinance) {
      if (!identity?.userId || !s.station?.id) throw new ApiError('station_changed', 'Session ou station indisponible.');
      if (expensesInFlight.current.has(`${identity.userId}:${s.station.id}`)) {
        throw new ApiError('expense_in_flight', 'Une dépense est déjà en cours.');
      }
      if (pendingExpenseError || (pendingExpenseState?.userId === identity.userId && pendingExpenseState.stationId === s.station.id)) {
        throw new ApiError('expense_pending', pendingExpenseError ?? 'Vérifiez la tentative précédente avant une nouvelle dépense.');
      }
      let previous: PendingExpense | null;
      try { previous = readPendingExpense(identity.userId, s.station.id); }
      catch (error) {
        setPendingExpenseError(error instanceof Error ? error.message : 'Tentative de dépense inaccessible.');
        throw error;
      }
      if (previous) {
        setPendingExpenseState(previous);
        throw new ApiError('expense_pending', 'Vérifiez la tentative précédente avant une nouvelle dépense.');
      }
      const pending: PendingExpense = {
        version: 1, userId: identity.userId, stationId: s.station.id, startedAt: new Date().toISOString(),
        payload: { stationId: s.station.id, amount: p.amount, category: p.category.trim(), reason: p.reason.trim(),
          supplier: p.supplier.trim(), date: p.date, method: p.method, idempotencyKey: key },
      };
      try { savePendingExpense(pending); }
      catch (error) {
        setPendingExpenseError(error instanceof Error ? error.message : 'Tentative de dépense inaccessible.');
        throw error;
      }
      setPendingExpenseState(pending);
      return submitPendingExpense(pending, false);
    }
    if ((s.expenses ?? []).some((e) => e.idempotencyKey === key)) {
      throw new ApiError('expense_duplicate', 'Cette clé de dépense est déjà utilisée : vérifiez la dépense existante.');
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
  }, [assertActivated, assertCashRule, notify, serverFinance, identity?.userId, submitPendingExpense, pendingExpenseError, pendingExpenseState]);

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

  const updateStockThreshold = useCallback((productId: string, reorderLevel: number): void | Promise<void> => {
    validateQuantity(reorderLevel, true);
    if (dataSource === 'api' && serverStock) {
      assertActivated();
      assertStockWriteMode();
      const product = stateRef.current.products.find((p) => p.id === productId);
      if (!product) throw new ApiError('not_found', 'Produit introuvable.');
      return stockRpc((c) => c.saveProduct({
        stationId: product.stationId,
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        unit: product.unit,
        reorderLevel,
      })).then(() => undefined);
    }
    if (!isLocalStockDemo) {
      throw new ApiError('local_demo_only', 'La modification locale des seuils est réservée au mode démo local.');
    }
    setState((cur) => updateProductThresholdLocal(cur, productId, reorderLevel));
    notify('success', 'Seuil critique mis à jour.');
  }, [dataSource, serverStock, isLocalStockDemo, assertActivated, assertStockWriteMode, stockRpc, notify]);

  const adjustProductStock = useCallback((productId: string, qtyOnHand: number) => {
    validateQuantity(qtyOnHand, true);
    if (!isLocalStockDemo) {
      throw new ApiError('local_demo_only', 'La simulation de stock est réservée au mode démo local.');
    }
    setState((cur) => adjustProductStockQtyLocal(cur, productId, qtyOnHand));
    notify('info', 'Niveau de stock ajusté.');
  }, [isLocalStockDemo, notify]);

  // ── P09 : formules, limites, abonnements, suspension ─────────────────────
  const savePlan = useCallback(async (p: PlanPayload): Promise<string> => {
    if (serverAnalytics) return analyticsRpc((c) => c.savePlan(p));
    const existing = getPlans().find((plan) => plan.id === p.planId);
    const updatedPlan: Plan = {
      id: p.planId, name: p.name.trim(), priceMonthly: Math.round(p.priceMinor),
      trial: p.trialDays > 0,
      limits: existing?.limits ?? { stations: 1, employees: 3, washesPerMonth: 100 },
      entitlements: existing?.entitlements ? { ...existing.entitlements } : undefined,
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
  const requestPlanChange = useCallback(async (planId: string): Promise<void> => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan || !['standard', 'premium'].includes(planId)) throw new ApiError('invalid_plan', 'Formule payante indisponible.');
    if (subscriptionRequestInFlight.current) throw new ApiError('request_pending', 'Une demande est déjà en cours.');
    if (serverSubscription && adapter.subscriptionCommands) {
      if (!identity?.permissions.includes('subscription.manage')) throw new ApiError('forbidden', 'Seul le propriétaire peut demander une formule.');
      const epoch = scopeRef.current.epoch;
      subscriptionRequestInFlight.current = true;
      try {
        try { await adapter.subscriptionCommands.request(planId); }
        catch (error) {
          // Une réponse perdue n'est ni un rejet certain ni une activation.
          // La commande est idempotente pour la même formule : relire avant tout nouvel essai.
          let checked: SubscriptionAccess | null = null;
          try { checked = await refreshSubscriptionAccess(); } catch { /* vérifier plus tard */ }
          if (scopeRef.current.epoch !== epoch || checked?.pendingPlanId !== planId) {
            throw new ApiError('request_unconfirmed', `Demande non confirmée. Relisez l’abonnement avant de réessayer. ${error instanceof Error ? error.message : ''}`);
          }
          notify('info', `Demande « ${plan.name} » retrouvée en attente. Elle n’est pas encore activée.`);
          return;
        }
        const checked = await refreshSubscriptionAccess().catch(() => null);
        if (scopeRef.current.epoch !== epoch || checked?.pendingPlanId !== planId) {
          throw new ApiError('request_unconfirmed', 'Demande envoyée, mais son état n’a pas été confirmé. Relisez l’abonnement avant de réessayer.');
        }
        notify('success', `Demande « ${plan.name} » enregistrée ; validation administrateur en attente. Aucun paiement automatique.`);
      } finally { subscriptionRequestInFlight.current = false; }
      return;
    }
    if (authPort.kind !== 'local' || dataSource !== 'local' || !stateRef.current.subscription
      || stateRef.current.subscription.companyId !== stateRef.current.company?.id) {
      throw new ApiError('subscription_unavailable', 'Aucun abonnement disponible : aucune demande n’a été enregistrée.');
    }
    setState((s) => {
      if (!s.subscription || s.subscription.companyId !== s.company?.id) return s;
      const next = { ...s, subscription: { ...s.subscription, pendingPlanId: planId } };
      return { ...next, auditLogs: logAction(next, 'Choix local de formule', plan.name) };
    });
    notify('success', `Choix « ${plan.name} » noté dans ce navigateur uniquement. Aucune demande réelle ni paiement.`);
  }, [adapter, authPort.kind, dataSource, identity, notify, plans, refreshSubscriptionAccess, serverSubscription]);

  const decideSubscriptionRequest = useCallback(async (requestId: string, approve: boolean): Promise<void> => {
    if (!serverSubscription || !identity?.isPlatformAdmin || !adapter.subscriptionCommands) {
      throw new ApiError('forbidden', 'La validation réelle exige un administrateur plateforme connecté.');
    }
    const epoch = scopeRef.current.epoch;
    await adapter.subscriptionCommands.decide(requestId, approve).catch((error: unknown) => {
      throw new ApiError('decision_unconfirmed', `Décision non confirmée. Relisez les demandes et l’entreprise avant de réessayer. ${error instanceof Error ? error.message : ''}`);
    });
    if (scopeRef.current.epoch !== epoch) throw new ApiError('station_changed', 'Session modifiée : vérifiez la décision dans la plateforme.');
    try { await Promise.all([refreshSubscriptionRequests(), refreshPlatform()]); }
    catch { throw new ApiError('decision_unconfirmed', 'Décision enregistrée, mais relecture indisponible. Vérifiez la plateforme avant toute nouvelle action.'); }
    notify('success', approve ? 'Demande validée : formule activée. Aucun paiement n’a été enregistré.' : 'Demande refusée. La formule précédente est conservée.');
  }, [adapter, identity?.isPlatformAdmin, notify, refreshPlatform, refreshSubscriptionAccess, refreshSubscriptionRequests, serverSubscription]);

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
    if (serverSetup) return setupRpc((c, station) => c.activate(station), (snapshot) => snapshot.station.activated)
      .then(() => { notify('success', 'Station activée : l’exploitation est ouverte.'); });
    if (!localSetup) throw new ApiError('server_unavailable', 'Activation indisponible dans cette configuration.');
    setState((cur) => {
      const next = {
        ...cur,
        station: cur.station ? { ...cur.station, activated: true, activatedAt: new Date().toISOString() } : null,
      };
      return { ...next, auditLogs: logAction(next, 'Station activée', 'Ouverture de l’exploitation') };
    });
    notify('success', 'Station activée : l’exploitation est ouverte.');
  }, [notify, serverSetup, localSetup, setupRpc]);

  const resetAll = useCallback(async () => {
    if (!isLocalStockDemo) {
      throw new ApiError('forbidden', 'La réinitialisation locale est indisponible en mode connecté.');
    }
    await withDemoStorageLock(() => {
      const stored = readDemoState();
      if (stored.status === 'unavailable' || stored.raw !== demoBaseline.current) {
        markDemoIssue('Les données ont changé ou sont inaccessibles. Sauvegardez et rechargez avant toute réinitialisation.');
        throw new ApiError('demo_storage_unavailable', 'Réinitialisation bloquée : les données ont changé ou sont inaccessibles.');
      }
      const passwordsBefore = localStorage.getItem(DEMO_PASSWORDS_KEY);
      try {
        localStorage.removeItem(DEMO_STATE_KEY);
        localStorage.removeItem(DEMO_PASSWORDS_KEY);
        if (localStorage.getItem(DEMO_STATE_KEY) !== null || localStorage.getItem(DEMO_PASSWORDS_KEY) !== null) throw new Error('effacement non confirmé');
      } catch {
        try {
          if (stored.raw !== null) localStorage.setItem(DEMO_STATE_KEY, stored.raw);
          if (passwordsBefore !== null) localStorage.setItem(DEMO_PASSWORDS_KEY, passwordsBefore);
        } catch { /* état incertain : l'avertissement reste explicite */ }
        markDemoIssue('Réinitialisation non confirmée. Sauvegardez et vérifiez les clés locales avant de poursuivre.');
        throw new ApiError('demo_storage_unavailable', 'Effacement non confirmé : vérifiez les données locales.');
      }
      demoWriteGeneration.current += 1;
      demoBaseline.current = null;
      setDemoSavedRaw(null);
      stateRef.current = emptyState();
      (authPort as LocalAuthAdapter).clearAll?.();
    });
    authGenerationRef.current += 1;
    authKeyRef.current = 'signed-out';
    scopeRef.current = { epoch: scopeRef.current.epoch + 1, userId: null, companyId: null, stationId: null };
    setAssignableUsers([]); setStationMetrics(null); setStationMetricsError(null);
    setAuthReady(true);
    setState(stateRef.current);
    setIdentity(null);
    setInvitations([]);
    setAuthRecovery(false);
    setAuthError(null);
    notify('info', 'Données locales de démonstration effacées.');
  }, [authPort, isLocalStockDemo, notify, markDemoIssue]);

  const viewEpoch = scopeRef.current.epoch;
  const scoped = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    if (authPort.kind === 'local' && demoIssueRef.current) {
      throw new ApiError('demo_storage_unavailable', demoIssueRef.current);
    }
    if (isRemoteAuth && viewEpoch !== scopeRef.current.epoch) {
      throw new ApiError('station_changed', 'La station ou la session a changé : vérifiez l’opération initiale avant de poursuivre.');
    }
    return fn(...args);
  };

  const assertSubscriptionWrite = (feature?: PlanFeature) => {
    if (identity?.isPlatformAdmin) return;
    const access = authPort.kind === 'local' ? localSubscriptionAccess(stateRef.current, plans) : subscriptionAccess;
    if (!accessCanWrite(access)) throw new ApiError('subscription_read_only',
      access ? 'Abonnement en lecture seule : demandez une formule et attendez sa validation.'
        : 'Abonnement non confirmé : relisez-le avant toute opération.');
    if (feature && !access?.features[feature]) throw new ApiError('plan_feature', 'Ce module n’est pas inclus dans la formule active.');
  };
  const scopedWrite = <A extends unknown[], R>(fn: (...args: A) => R, feature?: PlanFeature) => scoped((...args: A): R => {
    assertSubscriptionWrite(feature);
    return fn(...args);
  });
  const localQuota = (kind: 'employees' | 'washes') => {
    if (authPort.kind !== 'local') return;
    const current = stateRef.current;
    const access = localSubscriptionAccess(current, plans);
    const plan = plans.find((item) => item.id === access?.planId);
    if (!plan) throw new ApiError('quota_unavailable', 'Limite de formule indisponible.');
    if (kind === 'employees') {
      const active = current.users.filter((u) => u.active);
      const pending = [...localAccountReservations.current].filter((key) => !active.some((u) =>
        key === `id:${u.id}` || key === `email:${u.email.toLowerCase()}`)).length;
      if (active.length + pending >= plan.limits.employees) throw new ApiError('quota_reached', 'Quota de comptes actifs atteint (propriétaire inclus).');
    } else {
      const now = new Date();
      const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      const used = current.washes.filter((w) => w.status !== 'cancelled' && Date.parse(w.createdAt) >= first && Date.parse(w.createdAt) < end);
      const ids = new Set(current.washes.map((w) => w.id));
      const pending = [...localWashReservations.current].filter((id) => !ids.has(id)).length;
      if (used.length + pending >= plan.limits.washesPerMonth) throw new ApiError('quota_reached', 'Quota de lavages du mois atteint.');
    }
  };
  const inviteWithQuota = scopedWrite(async (payload: InvitePayload) => {
    localQuota('employees');
    const key = `email:${payload.email.trim().toLowerCase()}`;
    if (authPort.kind === 'local') localAccountReservations.current.add(key);
    try { return await inviteUser(payload); }
    catch (error) { localAccountReservations.current.delete(key); throw error; }
  });
  const updateUserWithQuota = scopedWrite(async (payload: UpdateUserPayload) => {
    const target = stateRef.current.users.find((u) => u.id === payload.userId);
    const reactivating = authPort.kind === 'local' && payload.active === true && target?.active === false;
    if (reactivating) localQuota('employees');
    const key = `id:${payload.userId}`;
    if (reactivating) localAccountReservations.current.add(key);
    try { await updateUser(payload); }
    catch (error) { localAccountReservations.current.delete(key); throw error; }
  });
  const createWashWithQuota = scopedWrite((payload: WashPayload) => {
    localQuota('washes');
    const result = createWash(payload);
    if (authPort.kind === 'local' && !(result instanceof Promise)) localWashReservations.current.add(result.id);
    return result;
  });

  const value: Ctx = {
    state, toasts, notify: (kind, message) => { if (!isRemoteAuth || viewEpoch === scopeRef.current.epoch) notify(kind, message); }, dismissToast, theme, toggleTheme, themeName, setTheme, plans, dataSource, isLocalStockDemo, demoStorageIssue, demoStoragePending, isServerStock: serverStock, plansError,
    subscriptionAccess, subscriptionStatus, subscriptionError, canWriteSubscription, refreshSubscriptionAccess,
    subscriptionRequests, subscriptionRequestsError, refreshSubscriptionRequests, decideSubscriptionRequest,
    onboarding, missing,
    authReady, authError, authRecovery, authKind: authPort.kind, identity, selectStation, invitations, clearAuthError,
    assignableUsers: serverWash ? assignableUsers : state.users.filter((u) => u.active &&
      (u.stationIds?.length ? u.stationIds.includes(state.station?.id ?? '') : !u.stationId || u.stationId === state.station?.id)),
    stationMetrics, stationMetricsError, refreshStationMetrics,
    signUp, signIn, signOut, requestPasswordReset, updatePassword,
    verifyResetToken, changePassword, listSessions, revokeSession, revokeOtherSessions,
    listAuthActivity, confirmEmail, resendConfirmation,
    inviteUser: inviteWithQuota, revokeInvitation: scopedWrite(revokeInvitation), updateUser: updateUserWithQuota, refreshUsers, refreshInvitations,
    employeeReadWarning, unconfirmedInvitation, unconfirmedAccountUpdate, unconfirmedRevocation, revocationRecoveryLoading, revocationRecoveryError, refreshEmployeeData,
    setupStatus, setupError, refreshSetup,
    updateCompany: scopedWrite(updateCompany), updateStation: scopedWrite(updateStation), setStationLogoPath: scoped(setStationLogoPath), setHours: scopedWrite(setHours), addCategory: scopedWrite(addCategory), toggleCategory: scopedWrite(toggleCategory), removeCategory: scopedWrite(removeCategory),
    addService: scopedWrite(addService), updateService: scopedWrite(updateService), setPrice: scopedWrite(setPrice), removeService: scopedWrite(removeService),
    updateEmployee: scopedWrite(updateEmployee), addClient: scopedWrite(addClient), updateClient: scopedWrite(updateClient),
    createWash: createWashWithQuota, pendingWash, pendingWashError, retryPendingWash: scopedWrite(retryPendingWash),
    setWashStatus: scopedWrite(setWashStatus), addPayment: scopedWrite(addPayment), assignWash: scopedWrite(assignWash), recordQualityCheck: scopedWrite(recordQualityCheck), createWashPost: scopedWrite(createWashPost),
    refreshWashes, vehicleHistory,
    openCash: scopedWrite(openCash), closeCash: scopedWrite(closeCash), reopenCash: scopedWrite(reopenCash),
    addExpense: scopedWrite(addExpense), pendingExpense, pendingExpenseError, retryPendingExpense: scopedWrite(retryPendingExpense), cancelExpense: scopedWrite(cancelExpense),
    cancelPayment: scopedWrite(cancelPayment), reconcileChannel: scopedWrite(reconcileChannel), createCommissionPeriod: scopedWrite(createCommissionPeriod), validateCommissionPeriod: scopedWrite(validateCommissionPeriod),
    recordCommissionPayout: scopedWrite(recordCommissionPayout), refreshFinance,
    refreshStock, saveSupplier: scopedWrite(saveSupplier, 'stock'), saveProduct: scopedWrite(saveProduct, 'stock'), createPurchaseOrder: scopedWrite(createPurchaseOrder, 'stock'), receivePurchaseLines: scopedWrite(receivePurchaseLines, 'stock'),
    startInventory: scopedWrite(startInventory, 'stock'), recordInventoryCount: scopedWrite(recordInventoryCount, 'stock'), closeInventory: scopedWrite(closeInventory, 'stock'), saveServiceConsumption: scopedWrite(saveServiceConsumption, 'stock'),
    consumeWash: scopedWrite(consumeWash, 'stock'), linkExpenseToOrder: scopedWrite(linkExpenseToOrder, 'stock'), certifyCosts: scopedWrite(certifyCosts, 'stock'),
    updateStockThreshold: scopedWrite(updateStockThreshold, 'stock'), adjustProductStock: scopedWrite(adjustProductStock, 'stock'),
    refreshCrm, saveCustomerProfile: scopedWrite(saveCustomerProfile), saveCustomerVehicle: scopedWrite(saveCustomerVehicle), createLoyaltyProgram: scopedWrite(createLoyaltyProgram, 'loyalty'),
    enrollLoyaltyCustomer: scopedWrite(enrollLoyaltyCustomer, 'loyalty'), recordLoyaltyTransaction: scopedWrite(recordLoyaltyTransaction, 'loyalty'), accrueLoyaltyForWash: scopedWrite(accrueLoyaltyForWash, 'loyalty'),
    savePackagePlan: scopedWrite(savePackagePlan, 'loyalty'), sellPackageToCustomer: scopedWrite(sellPackageToCustomer, 'loyalty'), consumePackageForWash: scopedWrite(consumePackageForWash, 'loyalty'),
    savePromotion: scopedWrite(savePromotion, 'loyalty'), applyPromotionToWash: scopedWrite(applyPromotionToWash, 'loyalty'), saveFleet: scopedWrite(saveFleet, 'fleets'), saveFleetContract: scopedWrite(saveFleetContract, 'fleets'),
    attachFleetVehicle: scopedWrite(attachFleetVehicle, 'fleets'), recordFleetReceivable: scopedWrite(recordFleetReceivable, 'fleets'), enqueueNotification: scopedWrite(enqueueNotification, 'loyalty'),
    cancelPendingNotification: scopedWrite(cancelPendingNotification, 'loyalty'),
    analyticsBoard: visibleAnalyticsBoard, subscriptionUsage, platformBoard, analyticsError, platformError,
    refreshAnalytics, refreshSubscriptionUsage, refreshUsageCounters, refreshPlatform,
    savePlan, setPlanLimit, setCompanySubscription, setCompanySuspended,
    requestPlanChange: scoped(requestPlanChange), toggleCompanySuspension: scoped(toggleCompanySuspension), activateStation: scopedWrite(activateStation), resetAll: scoped(resetAll),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore doit être utilisé dans StoreProvider');
  return ctx;
}

export { ApiError, todayISO };
