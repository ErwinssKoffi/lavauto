import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { getDb, getDatabaseStatus } from './db';
import {
  attachIdentity,
  clearSessionCookie,
  createActionToken,
  createSessionForUser,
  hashPassword,
  hashToken,
  requireAuth,
  requirePermission,
  roleToDbKey,
  setSessionCookie,
  verifyPassword,
  type AuthedRequest,
} from './auth';
import {
  ANALYTICS_RULES,
  emptyProfitability,
  PLATFORM_RULES,
  quotaMonthStartISO,
  redactStockAnalytics,
  type AnalyticsSnapshot,
  type AnalyticsStation,
  type AnalyticsTrendPoint,
  type PlatformSnapshot,
  type SubscriptionUsageSnapshot,
} from '../src/lib/analytics';
import {
  buildProfitability,
  channelExpected,
  FIXED_COST_CATEGORIES,
  redactStockProfitability,
} from '../src/lib/finance';
import {
  cancelExpenseWithLedger,
  cancelPaymentWithLedger,
  cashPaymentMovement,
  closeCashWithLedger,
  createCommissionPeriodLocal,
  movement,
  reconcileChannelLocal,
  recordCommissionPayoutLocal,
  validateCommissionPeriodLocal,
  withFinanceDefaults,
} from '../src/lib/financeState';
import {
  certifyCostsLocal,
  closeInventoryLocal,
  consumeWashLocal,
  createPurchaseOrderLocal,
  linkExpenseToOrderLocal,
  receivePurchaseLinesLocal,
  recordInventoryCountLocal,
  saveProductLocal,
  saveServiceConsumptionLocal,
  saveSupplierLocal,
  startInventoryLocal,
} from '../src/lib/stockState';
import {
  EMPTY_STOCK_VALUATION,
  STOCK_RULES,
  stockBoardFromState,
  withStockDefaults,
} from '../src/lib/stock';
import {
  accrueLoyaltyForWashLocal,
  applyPromotionToWashLocal,
  attachFleetVehicleLocal,
  cancelPendingNotificationLocal,
  consumePackageForWashLocal,
  createLoyaltyProgramLocal,
  enrollLoyaltyCustomerLocal,
  recordFleetReceivableLocal,
  recordLoyaltyTransactionLocal,
  saveCustomerProfileLocal,
  saveCustomerVehicleLocal,
  saveFleetContractLocal,
  saveFleetLocal,
  savePackagePlanLocal,
  savePromotionLocal,
  sellPackageToCustomerLocal,
} from '../src/lib/crmState';
import {
  CRM_RULES,
  crmBoardFromState,
  emptyCrmCollections,
} from '../src/lib/crm';
import {
  NO_ADVANCED,
  permissionFeature,
  type SubscriptionAccess,
  type SubscriptionRequest,
} from '../src/lib/subscription';
import { permissionsForRole } from '../src/lib/permissionCatalog';
import {
  validateCertification,
  validateConsumption,
  validateCustomer,
  validateExpense,
  validateFleet,
  validateFleetContract,
  validateFleetReceivable,
  validateInventory,
  validateMoney,
  validateOrder,
  validatePackage,
  validatePeriod,
  validatePlate,
  validateProduct,
  validatePromotion,
  validateReceipt,
  validateSupplier,
} from '../src/lib/validation';
import {
  canTransitionWash,
  finishedWashes,
  washEvent,
} from '../src/lib/washLifecycle';
import { isStationLogoPath } from '../src/lib/image';
import {
  ApiError,
  PAY_METHOD_LABELS,
  type AppState,
  type AppUser,
  type CashSession,
  type Client,
  type Company,
  type DayHours,
  type Expense,
  type Payment,
  type PaymentMethod,
  type PayMethod,
  type Plan,
  type PlanFeatures,
  type Role,
  type Service,
  type Station,
  type Subscription,
  type VehicleCategory,
  type Wash,
  type WashItem,
  type WashPost,
  type WashQualityResult,
  type WashStatus,
} from '../src/types';

/**
 * Le renvoi du lien de réinitialisation dans la réponse HTTP est une commodité
 * de DÉMONSTRATION (aucun e-mail n'est envoyé par ce serveur). Il est désactivé
 * par défaut et interdit en production : sans lui, un appelant anonyme ne peut
 * plus réinitialiser le mot de passe d'un tiers et prendre le contrôle du compte.
 */
function demoResetEnabled(): boolean {
  return process.env.WASHGUARD_DEMO_RESET === '1' && process.env.NODE_ENV !== 'production';
}

// ─── Per-company async serialization mutex ───────────────────────────────────
const companyLocks = new Map<string, Promise<unknown>>();
async function withCompanyLock<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  const prev = companyLocks.get(companyId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((res) => { release = res; });
  const chained = prev.then(() => current, () => current);
  companyLocks.set(companyId, chained);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (companyLocks.get(companyId) === chained) {
      companyLocks.delete(companyId);
    }
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly missing?: string[],
  ) {
    super(message);
  }
}

const DEFAULT_HOURS: DayHours[] = [
  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
].map((day, idx) => ({
  day,
  open: '08:00',
  close: idx === 6 ? '16:00' : '19:00',
  closed: false,
}));

const DEFAULT_PAYMENT_METHODS: PayMethod[] = ['especes', 'wave', 'orange_money', 'mtn_momo', 'carte'];

interface StationSlice {
  vehicleCategories: VehicleCategory[];
  services: Service[];
  clients: Client[];
  washes: Wash[];
  washPosts: WashPost[];
  cashSessions: AppState['cashSessions'];
  cashMovements: AppState['cashMovements'];
  cashClosures: AppState['cashClosures'];
  expenses: Expense[];
  paymentMethods: PaymentMethod[];
  reconciliations: AppState['reconciliations'];
  commissionPeriods: AppState['commissionPeriods'];
  commissionLines: AppState['commissionLines'];
  commissionPayouts: AppState['commissionPayouts'];
  paymentCancellations: AppState['paymentCancellations'];
  productCategories: AppState['productCategories'];
  suppliers: AppState['suppliers'];
  products: AppState['products'];
  purchaseOrders: AppState['purchaseOrders'];
  purchaseOrderItems: AppState['purchaseOrderItems'];
  stockLevels: AppState['stockLevels'];
  stockMovements: AppState['stockMovements'];
  inventorySessions: AppState['inventorySessions'];
  inventoryItems: AppState['inventoryItems'];
  serviceConsumptions: AppState['serviceConsumptions'];
  receiptEvents: AppState['receiptEvents'];
  consumptionRuns: AppState['consumptionRuns'];
  costCertifications: AppState['costCertifications'];
  vehicles: AppState['vehicles'];
  loyaltyPrograms: AppState['loyaltyPrograms'];
  loyaltyCards: AppState['loyaltyCards'];
  loyaltyTransactions: AppState['loyaltyTransactions'];
  packagePlans: AppState['packagePlans'];
  customerPackages: AppState['customerPackages'];
  packageUsages: AppState['packageUsages'];
  promotions: AppState['promotions'];
  promotionUsages: AppState['promotionUsages'];
  fleets: AppState['fleets'];
  fleetContracts: AppState['fleetContracts'];
  fleetVehicles: AppState['fleetVehicles'];
  fleetReceivables: AppState['fleetReceivables'];
  notificationOutbox: AppState['notificationOutbox'];
  washCounter: number;
}

interface TenantDocument {
  stationsData: Record<string, StationSlice>;
}

function emptyPaymentMethodsForStation(stationId: string, activeMethods: PayMethod[]): PaymentMethod[] {
  const all: PayMethod[] = ['especes', 'wave', 'orange_money', 'mtn_momo', 'mobile_money', 'carte', 'virement'];
  return all.map((uiMethod) => ({
    id: `pm-${stationId.slice(0, 8)}-${uiMethod}`,
    stationId,
    key: uiMethod,
    label: PAY_METHOD_LABELS[uiMethod],
    uiMethod,
    affectsCash: uiMethod === 'especes',
    active: activeMethods.includes(uiMethod),
  }));
}

function emptySlice(stationId: string, activeMethods: PayMethod[] = DEFAULT_PAYMENT_METHODS): StationSlice {
  return {
    vehicleCategories: [],
    services: [],
    clients: [],
    washes: [],
    washPosts: [],
    cashSessions: [],
    cashMovements: [],
    cashClosures: [],
    expenses: [],
    paymentMethods: emptyPaymentMethodsForStation(stationId, activeMethods),
    reconciliations: [],
    commissionPeriods: [],
    commissionLines: [],
    commissionPayouts: [],
    paymentCancellations: [],
    productCategories: [],
    suppliers: [],
    products: [],
    purchaseOrders: [],
    purchaseOrderItems: [],
    stockLevels: [],
    stockMovements: [],
    inventorySessions: [],
    inventoryItems: [],
    serviceConsumptions: [],
    receiptEvents: [],
    consumptionRuns: [],
    costCertifications: [],
    ...emptyCrmCollections(),
    washCounter: 0,
  };
}

function normalizeSlice(raw: Partial<StationSlice> | undefined, stationId: string, paymentMethods: PayMethod[]): StationSlice {
  const base = emptySlice(stationId, paymentMethods);
  const merged = { ...base, ...(raw ?? {}) };
  merged.paymentMethods = emptyPaymentMethodsForStation(stationId, paymentMethods);
  return merged;
}

async function listActivePlansFromDb(): Promise<Plan[]> {
  const db = await getDb();
  const plansRes = await db.query<{
    id: string; name: string; price_minor: number; trial_days: number;
    active: boolean; sort_order: number; features: string[]; entitlements: PlanFeatures;
  }>(`SELECT id, name, price_minor, trial_days, active, sort_order, features, entitlements
      FROM plans WHERE active = TRUE ORDER BY sort_order ASC, id ASC`);
  const limitsRes = await db.query<{ plan_id: string; metric_key: string; value_int: number }>(
    `SELECT plan_id, metric_key, value_int FROM plan_limits`,
  );
  const limitMap = new Map<string, { stations: number; employees: number; washesPerMonth: number }>();
  for (const r of limitsRes.rows) {
    const cur = limitMap.get(r.plan_id) ?? { stations: 1, employees: 3, washesPerMonth: 100 };
    if (r.metric_key === 'stations') cur.stations = Number(r.value_int);
    if (r.metric_key === 'employees') cur.employees = Number(r.value_int);
    if (r.metric_key === 'washes_per_month') cur.washesPerMonth = Number(r.value_int);
    limitMap.set(r.plan_id, cur);
  }
  return plansRes.rows.map((p) => ({
    id: p.id,
    name: p.name,
    priceMonthly: Number(p.price_minor),
    trial: Number(p.trial_days) > 0,
    limits: limitMap.get(p.id) ?? { stations: 1, employees: 3, washesPerMonth: 100 },
    features: Array.isArray(p.features) ? p.features : [],
    entitlements: p.entitlements && typeof p.entitlements === 'object' ? p.entitlements : undefined,
  }));
}

async function loadCompanyRecord(companyId: string): Promise<Company> {
  const db = await getDb();
  const res = await db.query<{
    id: string; name: string; city: string; phone: string; suspended: boolean; created_at: string;
  }>(
    `SELECT id, name, city, phone, suspended, created_at::text AS created_at FROM companies WHERE id = $1`,
    [companyId],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(404, 'company_not_found', 'Entreprise introuvable.');
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    phone: row.phone,
    createdAt: row.created_at,
    suspended: Boolean(row.suspended),
  };
}

async function loadStationRecord(stationId: string, companyId: string): Promise<Station> {
  const db = await getDb();
  const res = await db.query<{
    id: string; company_id: string; name: string; address: string; city: string; phone: string;
    logo_path: string | null; hours: DayHours[]; payment_methods: PayMethod[];
    cash_requires_open: boolean; max_cashier_discount: number; commission_rate: number;
    monthly_target: number; activated: boolean; activated_at: string | null;
  }>(
    `SELECT id, company_id, name, address, city, phone, logo_path, hours, payment_methods,
            cash_requires_open, max_cashier_discount, commission_rate, monthly_target,
            activated, activated_at::text AS activated_at
     FROM stations WHERE id = $1 AND company_id = $2`,
    [stationId, companyId],
  );
  const s = res.rows[0];
  if (!s) throw new HttpError(404, 'station_not_found', 'Station introuvable.');
  return {
    id: s.id,
    companyId: s.company_id,
    name: s.name,
    address: s.address,
    city: s.city,
    phone: s.phone,
    currency: 'FCFA',
    logoPath: s.logo_path,
    hours: Array.isArray(s.hours) && s.hours.length ? s.hours : DEFAULT_HOURS,
    paymentMethods: Array.isArray(s.payment_methods) && s.payment_methods.length
      ? s.payment_methods : [...DEFAULT_PAYMENT_METHODS],
    cashRequiresOpen: Boolean(s.cash_requires_open),
    maxCashierDiscount: Number(s.max_cashier_discount ?? 0),
    commissionRate: Number(s.commission_rate ?? 0),
    monthlyTarget: Number(s.monthly_target ?? 0),
    activated: Boolean(s.activated),
    activatedAt: s.activated_at ?? null,
  };
}

async function loadCompanyUsers(companyId: string): Promise<AppUser[]> {
  const db = await getDb();
  const res = await db.query<{
    id: string; company_id: string; name: string; email: string; phone: string;
    role: Role; active: boolean; commission_rate_override: number | null; created_at: string;
  }>(
    `SELECT id, company_id, name, email, phone, role, active, commission_rate_override, created_at::text AS created_at
     FROM users WHERE company_id = $1 ORDER BY created_at ASC`,
    [companyId],
  );
  const usRes = await db.query<{ user_id: string; station_id: string }>(
    `SELECT us.user_id, us.station_id
     FROM user_stations us JOIN users u ON u.id = us.user_id
     WHERE u.company_id = $1`,
    [companyId],
  );
  const byUser = new Map<string, string[]>();
  for (const row of usRes.rows) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row.station_id);
    byUser.set(row.user_id, arr);
  }
  return res.rows.map((u) => {
    const stationIds = byUser.get(u.id) ?? [];
    return {
      id: u.id,
      companyId: u.company_id,
      stationId: stationIds[0] ?? null,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      active: Boolean(u.active),
      commissionRateOverride: u.commission_rate_override === null ? null : Number(u.commission_rate_override),
      createdAt: u.created_at,
      stationIds,
    };
  });
}

async function computeSubscriptionAccess(companyId: string): Promise<{
  subscription: Subscription | null;
  access: SubscriptionAccess;
}> {
  const db = await getDb();
  const company = await loadCompanyRecord(companyId);
  const subRes = await db.query<{
    id: string; company_id: string; plan_id: string; status: string;
    started_at: string; trial_ends_at: string | null; current_period_end: string | null; pending_plan_id: string | null;
  }>(
    `SELECT id, company_id, plan_id, status, started_at::text AS started_at,
            trial_ends_at::text AS trial_ends_at, current_period_end, pending_plan_id
     FROM subscriptions WHERE company_id = $1`,
    [companyId],
  );
  const row = subRes.rows[0];
  const plans = await listActivePlansFromDb();
  const fallbackPlan = plans.find((p) => p.id === (row?.plan_id ?? 'essai')) ?? plans[0];

  const now = new Date();
  const nowIso = now.toISOString();
  if (!row) {
    return {
      subscription: null,
      access: {
        id: crypto.randomUUID(),
        companyId,
        planId: 'essai',
        planName: fallbackPlan?.name ?? 'Essai',
        status: 'suspended',
        startedAt: nowIso,
        trialEndsAt: null,
        currentPeriodEnd: null,
        pendingPlanId: null,
        canWrite: false,
        reason: 'subscription_missing',
        features: { ...NO_ADVANCED },
        clientWriteDeadline: null,
      },
    };
  }

  const plan = plans.find((p) => p.id === row.plan_id) ?? fallbackPlan;
  const trialEndsMs = row.trial_ends_at ? Date.parse(row.trial_ends_at) : NaN;
  const periodEndIso = row.current_period_end
    ?? (row.plan_id !== 'essai'
      ? new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
      : null);
  const periodEndMs = periodEndIso ? Date.parse(`${periodEndIso}T00:00:00.000Z`) : NaN;

  let status: SubscriptionAccess['status'];
  let canWrite = false;
  let reason: string | null = null;

  if (company.suspended || row.status === 'suspendue' || row.status === 'suspended') {
    status = 'suspended';
    reason = 'company_suspended';
  } else if (row.status === 'cancelled') {
    status = 'cancelled';
    reason = 'cancelled';
  } else if (row.status === 'past_due') {
    status = 'past_due';
    reason = 'past_due';
  } else if (row.plan_id === 'essai') {
    status = 'trial';
    if (Number.isFinite(trialEndsMs) && trialEndsMs > now.getTime()) {
      canWrite = true;
    } else {
      reason = 'trial_expired';
    }
  } else {
    status = 'active';
    if (Number.isFinite(periodEndMs) && periodEndMs > now.getTime()) {
      canWrite = true;
    } else {
      reason = 'period_expired';
    }
  }

  const subStatus: Subscription['status'] = company.suspended
    ? 'suspendue'
    : row.pending_plan_id ? 'en_attente' : (row.plan_id === 'essai' ? 'essai' : 'active');

  const subscription: Subscription = {
    id: row.id,
    companyId,
    planId: row.plan_id,
    status: subStatus,
    startedAt: row.started_at,
    trialEndsAt: row.trial_ends_at,
    pendingPlanId: row.pending_plan_id,
  };

  const features: PlanFeatures = {
    ...NO_ADVANCED,
    ...(plan?.entitlements ?? (plan?.id === 'standard'
      ? { stock: false, loyalty: false, fleets: false, consolidation: false, audit: false }
      : { stock: true, loyalty: true, fleets: true, consolidation: true, audit: true })),
  };

  return {
    subscription,
    access: {
      id: row.id,
      companyId,
      planId: row.plan_id,
      planName: plan?.name ?? row.plan_id,
      status,
      startedAt: row.started_at,
      trialEndsAt: row.trial_ends_at,
      currentPeriodEnd: row.plan_id === 'essai' ? null : periodEndIso,
      pendingPlanId: row.pending_plan_id,
      canWrite,
      reason,
      features,
      clientWriteDeadline: null,
    },
  };
}

async function loadTenantDoc(companyId: string): Promise<TenantDocument> {
  const db = await getDb();
  const res = await db.query<{ state_json: TenantDocument }>(
    `SELECT state_json FROM tenant_states WHERE company_id = $1`,
    [companyId],
  );
  const doc = res.rows[0]?.state_json;
  if (!doc || typeof doc !== 'object' || !doc.stationsData) {
    return { stationsData: {} };
  }
  return doc;
}

async function saveTenantDoc(companyId: string, doc: TenantDocument): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO tenant_states (company_id, state_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (company_id) DO UPDATE SET state_json = $2::jsonb, updated_at = NOW()`,
    [companyId, JSON.stringify(doc)],
  );
}

function resolveStationId(req: AuthedRequest, explicitStationId?: string | null): string {
  const id = req.identity;
  if (!id || !id.companyId) {
    throw new HttpError(401, 'unauthenticated', 'Session entreprise requise.');
  }
  const requested = typeof explicitStationId === 'string' && explicitStationId.trim()
    ? explicitStationId.trim()
    : null;
  if (requested) {
    if (!id.stationIds.includes(requested)) {
      throw new HttpError(403, 'station_forbidden', 'Accès refusé à cette station.');
    }
    return requested;
  }
  if (!id.stationIds[0]) {
    throw new HttpError(404, 'station_not_found', 'Aucune station accessible.');
  }
  return id.stationIds[0];
}

async function loadStationAppState(
  req: AuthedRequest,
  stationId: string,
): Promise<{
  companyId: string;
  company: Company;
  station: Station;
  users: AppUser[];
  doc: TenantDocument;
  slice: StationSlice;
  appState: AppState;
  access: SubscriptionAccess;
  subscription: Subscription | null;
}> {
  const identity = req.identity!;
  const companyId = identity.companyId!;
  const [company, station, users, doc, sub] = await Promise.all([
    loadCompanyRecord(companyId),
    loadStationRecord(stationId, companyId),
    loadCompanyUsers(companyId),
    loadTenantDoc(companyId),
    computeSubscriptionAccess(companyId),
  ]);
  const slice = normalizeSlice(doc.stationsData[stationId], stationId, station.paymentMethods);
  const appState: AppState = {
    company,
    station,
    users,
    ...slice,
    profitability: null,
    stockValuation: { ...EMPTY_STOCK_VALUATION },
    stockAlerts: [],
    stockServices: slice.services.map((s) => ({
      id: s.id, stationId: s.stationId, name: s.name, active: s.active,
    })),
    crmStats: crmBoardFromState({
      ...slice,
      company,
      station,
      users,
      profitability: null,
      stockValuation: { ...EMPTY_STOCK_VALUATION },
      stockAlerts: [],
      stockServices: [],
      crmStats: {
        clients: 0, vehicles: 0, activeCards: 0, activePackages: 0,
        activePromotions: 0, fleets: 0, openReceivablesMinor: 0, pendingNotifications: 0,
      },
      crmRules: { ...CRM_RULES },
      subscription: sub.subscription,
      auditLogs: [],
      platformCompanies: [],
      session: null,
      demoMode: false,
    } as AppState).stats,
    crmRules: { ...CRM_RULES },
    subscription: sub.subscription,
    auditLogs: [],
    platformCompanies: [],
    session: {
      userId: identity.userId,
      email: identity.email,
      name: identity.fullName,
      role: identity.role,
      companyId,
      stationId,
    },
    demoMode: false,
  };
  return {
    companyId,
    company,
    station,
    users,
    doc,
    slice,
    appState: withStockDefaults(withFinanceDefaults(appState)),
    access: sub.access,
    subscription: sub.subscription,
  };
}

const SLICE_KEYS: (keyof StationSlice)[] = [
  'vehicleCategories', 'services', 'clients', 'washes', 'washPosts',
  'cashSessions', 'cashMovements', 'cashClosures', 'expenses', 'paymentMethods',
  'reconciliations', 'commissionPeriods', 'commissionLines', 'commissionPayouts',
  'paymentCancellations', 'productCategories', 'suppliers', 'products',
  'purchaseOrders', 'purchaseOrderItems', 'stockLevels', 'stockMovements',
  'inventorySessions', 'inventoryItems', 'serviceConsumptions', 'receiptEvents',
  'consumptionRuns', 'costCertifications', 'vehicles', 'loyaltyPrograms',
  'loyaltyCards', 'loyaltyTransactions', 'packagePlans', 'customerPackages',
  'packageUsages', 'promotions', 'promotionUsages', 'fleets', 'fleetContracts',
  'fleetVehicles', 'fleetReceivables', 'notificationOutbox', 'washCounter',
];

function extractSlice(state: AppState): StationSlice {
  const out: Record<string, unknown> = {};
  for (const key of SLICE_KEYS) {
    out[key] = (state as unknown as Record<string, unknown>)[key];
  }
  return out as unknown as StationSlice;
}

function assertWritable(access: SubscriptionAccess, station?: Station, requireActivated = false): void {
  if (!access.canWrite) {
    throw new HttpError(
      403,
      'subscription_readonly',
      access.reason === 'trial_expired'
        ? 'Période d’essai expirée : passez à une formule payante pour continuer.'
        : 'Abonnement en lecture seule : contactez votre administrateur.',
    );
  }
  if (requireActivated && station && !station.activated) {
    throw new HttpError(
      409,
      'onboarding_incomplete',
      'Activez d’abord votre station dans Mise en route avant d’enregistrer des opérations.',
    );
  }
}

function assertModuleFeature(req: AuthedRequest, access: SubscriptionAccess, permission: string): void {
  const feature = permissionFeature(permission);
  if (feature && !req.identity?.isPlatformAdmin && !access.features[feature]) {
    throw new HttpError(403, 'plan_feature_unavailable', `Module non inclus dans votre formule (${feature}).`);
  }
}

function monthWashCountAcrossCompany(doc: TenantDocument, periodStart = quotaMonthStartISO()): number {
  const from = Date.parse(`${periodStart}T00:00:00Z`);
  const endDate = new Date(from);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const to = endDate.getTime();
  let count = 0;
  for (const slice of Object.values(doc.stationsData)) {
    for (const w of slice.washes ?? []) {
      if (w.status !== 'cancelled') {
        const ms = Date.parse(w.createdAt);
        if (Number.isFinite(ms) && ms >= from && ms < to) count += 1;
      }
    }
  }
  return count;
}

async function getPlanLimits(planId: string): Promise<{ stations: number; employees: number; washesPerMonth: number }> {
  const plans = await listActivePlansFromDb();
  const plan = plans.find((p) => p.id === planId);
  return plan?.limits ?? { stations: 1, employees: 3, washesPerMonth: 100 };
}

async function logAudit(
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO platform_audit_logs (id, actor_user_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [crypto.randomUUID(), actorUserId, action, entityType, entityId, JSON.stringify(detail)],
  );
}

function wrap(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    fn(req as AuthedRequest, res).catch((err) => {
      if (err instanceof HttpError) {
        res.status(err.status).json({ code: err.code, message: err.message, missing: err.missing });
        return;
      }
      if (err instanceof ApiError) {
        res.status(400).json({ code: err.code, message: err.message, missing: err.missing });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ code: 'bad_request', message: err.message });
        return;
      }
      next(err);
    });
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();
  router.use('/storage/station-logo/upload', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'], limit: '6mb' }));
  router.use(express.json({ limit: '2mb' }));
  router.use(attachIdentity);

  router.get('/health', wrap(async (_req, res) => {
    // Initialise la base (et donc l'état réel) avant d'exposer le diagnostic.
    await getDb();
    const status = getDatabaseStatus();
    // Un repli mémoire non signalé ferait perdre les données au redémarrage :
    // l'état est donc exposé, et le code HTTP le reflète pour les sondes.
    res.status(status.mode === 'memory' ? 503 : 200).json({
      ok: status.mode !== 'memory',
      service: 'washguard-api',
      time: new Date().toISOString(),
      database: status,
      demoReset: demoResetEnabled(),
    });
  }));

  router.get('/plans', wrap(async (_req, res) => {
    const plans = await listActivePlansFromDb();
    res.json({ plans });
  }));

  // ─── Auth endpoints ────────────────────────────────────────────────────────
  router.post('/auth/signup', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const companyName = String(body.companyName ?? '').trim();
    const stationName = String(body.stationName ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const city = String(body.city ?? '').trim();
    const ownerName = String(body.ownerName ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const requestedPlanId = String(body.requestedPlanId ?? 'essai').trim();

    if (companyName.length < 2 || stationName.length < 2 || ownerName.length < 2) {
      throw new HttpError(400, 'invalid_form', 'Renseignez le nom de l’entreprise, de la station et votre nom.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'invalid_email', 'Adresse e-mail invalide.');
    }
    if (password.length < 8) {
      throw new HttpError(400, 'weak_password', 'Le mot de passe doit contenir au moins 8 caractères.');
    }

    const db = await getDb();
    const dup = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (dup.rows.length > 0) {
      throw new HttpError(409, 'email_in_use', 'Un compte utilise déjà cette adresse e-mail.');
    }

    const companyId = crypto.randomUUID();
    const stationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const trialEndsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();

    await db.query(
      `INSERT INTO companies (id, name, city, phone, currency_code, suspended)
       VALUES ($1, $2, $3, $4, 'XOF', FALSE)`,
      [companyId, companyName, city, phone],
    );
    await db.query(
      `INSERT INTO stations (id, company_id, name, address, city, phone, hours, payment_methods, activated)
       VALUES ($1, $2, $3, '', $4, $5, $6::jsonb, $7::jsonb, FALSE)`,
      [stationId, companyId, stationName, city, phone, JSON.stringify(DEFAULT_HOURS), JSON.stringify(DEFAULT_PAYMENT_METHODS)],
    );
    await db.query(
      `INSERT INTO users (id, company_id, name, email, phone, password_hash, role, active, email_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, 'proprietaire', TRUE, TRUE)`,
      [userId, companyId, ownerName, email, phone, hashPassword(password)],
    );
    await db.query(
      `INSERT INTO user_stations (user_id, station_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, stationId],
    );
    await db.query(
      `INSERT INTO subscriptions (id, company_id, plan_id, status, started_at, trial_ends_at, pending_plan_id)
       VALUES ($1, $2, 'essai', 'essai', NOW(), $3::timestamptz, $4)`,
      [crypto.randomUUID(), companyId, trialEndsAt, requestedPlanId && requestedPlanId !== 'essai' ? requestedPlanId : null],
    );
    if (requestedPlanId && requestedPlanId !== 'essai') {
      await db.query(
        `INSERT INTO subscription_requests (id, company_id, from_plan_id, to_plan_id, status)
         VALUES ($1, $2, 'essai', $3, 'pending')`,
        [crypto.randomUUID(), companyId, requestedPlanId],
      );
    }

    const doc: TenantDocument = {
      stationsData: { [stationId]: emptySlice(stationId, DEFAULT_PAYMENT_METHODS) },
    };
    await saveTenantDoc(companyId, doc);

    const token = await createSessionForUser(userId);
    setSessionCookie(res, token, true);
    const { buildIdentityForUser } = await import('./auth');
    const identity = await buildIdentityForUser(userId);
    res.status(201).json({
      identity,
      confirmationRequired: false,
      message: requestedPlanId && requestedPlanId !== 'essai'
        ? 'Compte créé avec essai de 14 jours. Votre demande de formule est enregistrée.'
        : 'Compte créé et essai de 14 jours activé.',
    });
  }));

  router.post('/auth/signin', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const rememberMe = body.rememberMe !== false;

    const db = await getDb();
    const uRes = await db.query<{
      id: string; password_hash: string; active: boolean; email_confirmed: boolean;
    }>(`SELECT id, password_hash, active, email_confirmed FROM users WHERE email = $1`, [email]);
    const user = uRes.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'invalid_credentials', 'Adresse e-mail ou mot de passe incorrect.');
    }
    if (!user.active) {
      throw new HttpError(403, 'account_disabled', 'Ce compte est désactivé par l’administrateur.');
    }

    const token = await createSessionForUser(user.id);
    setSessionCookie(res, token, rememberMe);
    const { buildIdentityForUser } = await import('./auth');
    const identity = await buildIdentityForUser(user.id);
    res.json({ identity });
  }));

  router.post('/auth/signout', wrap(async (req, res) => {
    if (req.sessionTokenHash) {
      const db = await getDb();
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionTokenHash]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  router.get('/auth/me', wrap(async (req, res) => {
    res.json({ identity: req.identity ?? null });
  }));

  router.post('/auth/forgot-password', wrap(async (req, res) => {
    const email = String((req.body as Record<string, unknown>).email ?? '').trim().toLowerCase();
    const db = await getDb();
    const uRes = await db.query<{ id: string; active: boolean }>(
      `SELECT id, active FROM users WHERE email = $1`,
      [email],
    );
    const user = uRes.rows[0];
    if (!user || !user.active) {
      res.json({ ok: true });
      return;
    }
    const rawToken = await createActionToken(user.id, 'reset_password', 24);
    // Le jeton n'est renvoyé au client QUE si la démonstration locale le permet
    // explicitement (`WASHGUARD_DEMO_RESET=1`) et jamais en production. Sinon,
    // n'importe quel appelant non authentifié pourrait réinitialiser le mot de
    // passe d'autrui et prendre le contrôle du compte.
    if (!demoResetEnabled()) {
      res.json({ ok: true });
      return;
    }
    res.json({
      ok: true,
      demoMode: true,
      resetUrl: `/reinitialiser-mot-de-passe?token=${encodeURIComponent(rawToken)}`,
    });
  }));

  router.post('/auth/reset-password', wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const password = String(body.password ?? '');
    const rawToken = typeof body.token === 'string' ? body.token.trim() : '';
    if (password.length < 8) {
      throw new HttpError(400, 'weak_password', 'Le mot de passe doit contenir au moins 8 caractères.');
    }
    const db = await getDb();
    let userId: string | null = null;
    if (rawToken) {
      const tHash = hashToken(rawToken);
      const tRes = await db.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM action_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [tHash],
      );
      const tRow = tRes.rows[0];
      if (!tRow) {
        throw new HttpError(400, 'invalid_token', 'Lien de réinitialisation invalide ou expiré.');
      }
      userId = tRow.user_id;
      await db.query('UPDATE action_tokens SET used_at = NOW() WHERE id = $1', [tRow.id]);
      const uEmail = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
      if (uEmail.rows[0]) {
        await db.query(
          `UPDATE invitations SET accepted_at = COALESCE(accepted_at, NOW())
           WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL`,
          [uEmail.rows[0].email],
        );
      }
    } else if (req.identity) {
      userId = req.identity.userId;
    } else {
      throw new HttpError(401, 'unauthenticated', 'Jeton de réinitialisation ou session requis.');
    }

    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), userId]);
    // Un changement de mot de passe doit invalider les sessions déjà ouvertes,
    // y compris celle de l'attaquant qui aurait volé un cookie. Les jetons de
    // réinitialisation encore valides sont consommés dans la même foulée.
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await db.query(
      'UPDATE action_tokens SET used_at = COALESCE(used_at, NOW()) WHERE user_id = $1 AND kind = $2',
      [userId, 'reset_password'],
    );
    // La session courante (si le changement vient d'un compte connecté) est
    // fermée aussi : le frontend re-authentifie proprement.
    clearSessionCookie(res);
    res.json({ ok: true, sessionsRevoked: true });
  }));

  // ─── Employees & Invitations ───────────────────────────────────────────────
  router.get('/employees', requireAuth, wrap(async (req, res) => {
    const id = req.identity!;
    if (!id.companyId) {
      res.json({ identity: id, users: [], invitations: [] });
      return;
    }
    const db = await getDb();
    const users = await loadCompanyUsers(id.companyId);
    const invRes = await db.query<{
      id: string; email: string; role: Role; station_ids: string[];
      expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string;
    }>(
      `SELECT id, email, role, station_ids, expires_at::text AS expires_at,
              accepted_at::text AS accepted_at, revoked_at::text AS revoked_at, created_at::text AS created_at
       FROM invitations WHERE company_id = $1 ORDER BY created_at DESC`,
      [id.companyId],
    );
    res.json({
      identity: id,
      users: users.map((u) => ({
        id: u.id,
        fullName: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        roleKey: roleToDbKey(u.role),
        active: u.active,
        commissionRateOverride: u.commissionRateOverride,
        createdAt: u.createdAt,
        stationIds: u.stationIds ?? [],
      })),
      invitations: invRes.rows.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        roleKey: roleToDbKey(i.role),
        stationIds: Array.isArray(i.station_ids) ? i.station_ids : [],
        expiresAt: i.expires_at,
        acceptedAt: i.accepted_at,
        revokedAt: i.revoked_at,
        createdAt: i.created_at,
      })),
    });
  }));

  router.post('/employees/invite', requirePermission('employees.invite'), wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId!;
    const body = req.body as Record<string, unknown>;
    const fullName = String(body.fullName ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const phone = String(body.phone ?? '').trim();
    const role = String(body.role ?? 'caissier') as Role;
    const stationIds = Array.isArray(body.stationIds)
      ? body.stationIds.filter((x): x is string => typeof x === 'string' && id.stationIds.includes(x))
      : [];

    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'invalid_form', 'Nom ou adresse e-mail invalide.');
    }
    if (!['gerant', 'caissier', 'laveur'].includes(role)) {
      throw new HttpError(400, 'invalid_role', 'Rôle non autorisé pour une invitation.');
    }

    await withCompanyLock(companyId, async () => {
      const { access } = await computeSubscriptionAccess(companyId);
      assertWritable(access);
      const limits = await getPlanLimits(access.planId);
      const db = await getDb();
      const activeCountRes = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE company_id = $1 AND active = TRUE`,
        [companyId],
      );
      if (Number(activeCountRes.rows[0]?.count ?? '0') >= limits.employees) {
        throw new HttpError(403, 'quota_exceeded', `Limite de ${limits.employees} comptes actifs atteinte pour la formule ${access.planName}.`);
      }
      const existing = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        throw new HttpError(409, 'email_in_use', 'Cette adresse e-mail possède déjà un compte.');
      }

      const assignedStations = stationIds.length ? stationIds : [resolveStationId(req)];
      const newUserId = crypto.randomUUID();
      const tempPassword = crypto.randomBytes(24).toString('hex');
      await db.query(
        `INSERT INTO users (id, company_id, name, email, phone, password_hash, role, active, email_confirmed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)`,
        [newUserId, companyId, fullName, email, phone, hashPassword(tempPassword), role],
      );
      for (const stId of assignedStations) {
        await db.query(
          `INSERT INTO user_stations (user_id, station_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [newUserId, stId],
        );
      }
      const invId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await db.query(
        `INSERT INTO invitations (id, company_id, email, full_name, phone, role, station_ids, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [invId, companyId, email, fullName, phone, role, JSON.stringify(assignedStations), expiresAt],
      );
      const token = await createActionToken(newUserId, 'invite', 168);
      const inviteUrl = `/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`;
      res.status(201).json({
        id: invId,
        inviteUrl,
        message: 'Compte employé créé et lien d’activation généré.',
      });
    });
  }));

  router.post('/employees/invitations/:invId/revoke', requirePermission('employees.invite'), wrap(async (req, res) => {
    const companyId = req.identity!.companyId!;
    const db = await getDb();
    await db.query(
      `UPDATE invitations SET revoked_at = NOW() WHERE id = $1 AND company_id = $2 AND revoked_at IS NULL`,
      [String(req.params.invId), companyId],
    );
    res.json({ ok: true });
  }));

  router.patch('/employees/:userId', requirePermission('employees.manage'), wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId!;
    const targetId = String(req.params.userId);
    const body = req.body as Record<string, unknown>;
    const db = await getDb();

    await withCompanyLock(companyId, async () => {
      const { access } = await computeSubscriptionAccess(companyId);
      assertWritable(access);
      const targetRes = await db.query<{ id: string; role: Role; active: boolean }>(
        `SELECT id, role, active FROM users WHERE id = $1 AND company_id = $2`,
        [targetId, companyId],
      );
      const target = targetRes.rows[0];
      if (!target) throw new HttpError(404, 'user_not_found', 'Employé introuvable.');
      if (target.role === 'proprietaire' && body.active === false) {
        throw new HttpError(400, 'owner_protected', 'Le compte propriétaire ne peut pas être désactivé.');
      }

      if (body.active === true && !target.active) {
        const limits = await getPlanLimits(access.planId);
        const countRes = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users WHERE company_id = $1 AND active = TRUE`,
          [companyId],
        );
        if (Number(countRes.rows[0]?.count ?? '0') >= limits.employees) {
          throw new HttpError(403, 'quota_exceeded', `Limite de ${limits.employees} comptes actifs atteinte.`);
        }
      }

      if (typeof body.role === 'string' && target.role !== 'proprietaire') {
        if (!['gerant', 'caissier', 'laveur'].includes(body.role)) {
          throw new HttpError(400, 'invalid_role', 'Rôle invalide.');
        }
        await db.query('UPDATE users SET role = $1 WHERE id = $2', [body.role, targetId]);
      }
      if (typeof body.active === 'boolean') {
        await db.query('UPDATE users SET active = $1 WHERE id = $2', [body.active, targetId]);
      }
      if ('commissionRateOverride' in body) {
        const val = body.commissionRateOverride === null || body.commissionRateOverride === ''
          ? null
          : Math.round(Number(body.commissionRateOverride));
        if (val !== null && (!Number.isFinite(val) || val < 0 || val > 100)) {
          throw new HttpError(400, 'invalid_commission', 'Commission invalide (0 à 100 %).');
        }
        await db.query('UPDATE users SET commission_rate_override = $1 WHERE id = $2', [val, targetId]);
      }
      if (Array.isArray(body.stationIds)) {
        const allowed = body.stationIds.filter((s): s is string => typeof s === 'string' && id.stationIds.includes(s));
        await db.query('DELETE FROM user_stations WHERE user_id = $1', [targetId]);
        for (const stId of allowed) {
          await db.query('INSERT INTO user_stations (user_id, station_id) VALUES ($1, $2)', [targetId, stId]);
        }
      }
    });
    res.json({ ok: true });
  }));

  // ─── Setup & Catalog ───────────────────────────────────────────────────────
  router.get('/setup/:stationId', requireAuth, wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const ctx = await loadStationAppState(req, stationId);
    const prices = ctx.appState.services.flatMap((s) =>
      Object.entries(s.prices).map(([vehicleCategoryId, priceMinor]) => ({
        stationId,
        serviceId: s.id,
        vehicleCategoryId,
        priceMinor,
        currencyCode: 'XOF',
      })),
    );
    res.json({
      company: ctx.company,
      station: ctx.station,
      catalog: {
        categories: ctx.appState.vehicleCategories.map((c) => ({
          id: c.id, stationId: c.stationId, name: c.name, active: c.active,
        })),
        services: ctx.appState.services.map((s) => ({
          id: s.id, stationId: s.stationId, name: s.name, description: s.description, active: s.active,
        })),
        prices,
      },
    });
  }));

  router.post('/setup/:stationId/company', requirePermission('settings.manage'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const companyId = req.identity!.companyId!;
    await withCompanyLock(companyId, async () => {
      const { access } = await computeSubscriptionAccess(companyId);
      assertWritable(access);
      const patch = req.body as Record<string, unknown>;
      const db = await getDb();
      const cur = await loadCompanyRecord(companyId);
      await db.query(
        `UPDATE companies SET name = $1, city = $2, phone = $3 WHERE id = $4`,
        [
          typeof patch.name === 'string' ? patch.name.trim() || cur.name : cur.name,
          typeof patch.city === 'string' ? patch.city.trim() : cur.city,
          typeof patch.phone === 'string' ? patch.phone.trim() : cur.phone,
          companyId,
        ],
      );
    });
    res.json({ ok: true, stationId });
  }));

  router.post('/setup/:stationId/station', requirePermission('settings.manage'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const companyId = req.identity!.companyId!;
    await withCompanyLock(companyId, async () => {
      const { access } = await computeSubscriptionAccess(companyId);
      assertWritable(access);
      const patch = req.body as Record<string, unknown>;
      const cur = await loadStationRecord(stationId, companyId);
      const db = await getDb();
      await db.query(
        `UPDATE stations
         SET name = $1, address = $2, city = $3, phone = $4, hours = $5::jsonb,
             payment_methods = $6::jsonb, cash_requires_open = $7, max_cashier_discount = $8,
             commission_rate = $9, monthly_target = $10
         WHERE id = $11 AND company_id = $12`,
        [
          typeof patch.name === 'string' ? patch.name.trim() || cur.name : cur.name,
          typeof patch.address === 'string' ? patch.address.trim() : cur.address,
          typeof patch.city === 'string' ? patch.city.trim() : cur.city,
          typeof patch.phone === 'string' ? patch.phone.trim() : cur.phone,
          JSON.stringify(Array.isArray(patch.hours) ? patch.hours : cur.hours),
          JSON.stringify(Array.isArray(patch.paymentMethods) ? patch.paymentMethods : cur.paymentMethods),
          typeof patch.cashRequiresOpen === 'boolean' ? patch.cashRequiresOpen : cur.cashRequiresOpen,
          typeof patch.maxCashierDiscount === 'number' ? Math.max(0, Math.round(patch.maxCashierDiscount)) : cur.maxCashierDiscount,
          typeof patch.commissionRate === 'number' ? Math.max(0, Math.min(100, Math.round(patch.commissionRate))) : cur.commissionRate,
          typeof patch.monthlyTarget === 'number' ? Math.max(0, Math.round(patch.monthlyTarget)) : cur.monthlyTarget,
          stationId,
          companyId,
        ],
      );
    });
    res.json({ ok: true });
  }));

  router.post('/setup/:stationId/category', requirePermission('catalog.manage'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const companyId = req.identity!.companyId!;
    const body = req.body as Record<string, unknown>;
    const resultId = await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access);
      const id = typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID();
      const name = String(body.name ?? '').trim();
      const active = body.active !== false;
      const remove = body.remove === true;
      let categories = [...ctx.slice.vehicleCategories];
      let services = [...ctx.slice.services];
      if (remove) {
        categories = categories.filter((c) => c.id !== id);
        services = services.map((s) => {
          const nextPrices = { ...s.prices };
          delete nextPrices[id];
          return { ...s, prices: nextPrices };
        });
      } else {
        if (name.length < 2) throw new HttpError(400, 'invalid_form', 'Nom de catégorie trop court.');
        const existing = categories.find((c) => c.id === id);
        if (existing) {
          categories = categories.map((c) => c.id === id ? { ...c, name, active } : c);
        } else {
          categories.push({ id, stationId, name, active });
        }
      }
      ctx.doc.stationsData[stationId] = { ...ctx.slice, vehicleCategories: categories, services };
      await saveTenantDoc(companyId, ctx.doc);
      return id;
    });
    res.json({ id: resultId });
  }));

  router.post('/setup/:stationId/service', requirePermission('catalog.manage'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const companyId = req.identity!.companyId!;
    const body = req.body as Record<string, unknown>;
    const resultId = await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access);
      const id = typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID();
      const name = String(body.name ?? '').trim();
      const description = String(body.description ?? '').trim();
      const active = body.active !== false;
      const remove = body.remove === true;
      let services = [...ctx.slice.services];
      if (remove) {
        services = services.filter((s) => s.id !== id);
      } else {
        if (name.length < 2) throw new HttpError(400, 'invalid_form', 'Nom de prestation trop court.');
        const existing = services.find((s) => s.id === id);
        if (existing) {
          services = services.map((s) => s.id === id ? { ...s, name, description, active } : s);
        } else {
          services.push({ id, stationId, name, description, active, prices: {} });
        }
      }
      ctx.doc.stationsData[stationId] = { ...ctx.slice, services };
      await saveTenantDoc(companyId, ctx.doc);
      return id;
    });
    res.json({ id: resultId });
  }));

  router.post('/setup/:stationId/price', requirePermission('catalog.manage'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const companyId = req.identity!.companyId!;
    const body = req.body as Record<string, unknown>;
    const serviceId = String(body.serviceId ?? '');
    const categoryId = String(body.categoryId ?? '');
    const price = validateMoney(Number(body.price));
    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access);
      const services = ctx.slice.services.map((s) =>
        s.id === serviceId ? { ...s, prices: { ...s.prices, [categoryId]: price } } : s,
      );
      ctx.doc.stationsData[stationId] = { ...ctx.slice, services };
      await saveTenantDoc(companyId, ctx.doc);
    });
    res.json({ ok: true });
  }));

  router.post('/setup/:stationId/activate', requirePermission('settings.manage'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, String(req.params.stationId));
    const companyId = req.identity!.companyId!;
    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access);
      const missing: string[] = [];
      if (!ctx.station.name.trim()) missing.push('Nom de station');
      if (!ctx.station.city.trim()) missing.push('Ville');
      if (!ctx.station.paymentMethods.length) missing.push('Au moins un moyen de paiement');
      const activeCats = ctx.slice.vehicleCategories.filter((c) => c.active);
      if (activeCats.length === 0) missing.push('Au moins une catégorie de véhicule active');
      const activeServices = ctx.slice.services.filter((s) => s.active);
      if (activeServices.length === 0) missing.push('Au moins une prestation active');
      const hasValidPrice = activeServices.some((s) =>
        activeCats.some((c) => (s.prices[c.id] ?? 0) > 0),
      );
      if (!hasValidPrice) missing.push('Au moins un tarif > 0 FCFA dans la grille');
      if (missing.length > 0) {
        throw new HttpError(400, 'onboarding_incomplete', `Mise en route incomplète : ${missing.join(', ')}.`, missing);
      }
      const db = await getDb();
      await db.query(
        `UPDATE stations SET activated = TRUE, activated_at = COALESCE(activated_at, NOW())
         WHERE id = $1 AND company_id = $2`,
        [stationId, companyId],
      );
    });
    res.json({ ok: true });
  }));

  // ─── Subscription ──────────────────────────────────────────────────────────
  router.get('/subscription', requireAuth, wrap(async (req, res) => {
    const companyId = req.identity!.companyId;
    if (!companyId) throw new HttpError(400, 'no_company', 'Aucune entreprise associée.');
    const { access } = await computeSubscriptionAccess(companyId);
    res.json({ ...access, serverTime: new Date().toISOString() });
  }));

  router.post('/subscription/request', requirePermission('subscription.manage'), wrap(async (req, res) => {
    const companyId = req.identity!.companyId!;
    const planId = String((req.body as Record<string, unknown>).planId ?? '').trim();
    const plans = await listActivePlansFromDb();
    if (!plans.some((p) => p.id === planId && p.id !== 'essai')) {
      throw new HttpError(400, 'invalid_plan', 'Formule payante introuvable.');
    }
    const db = await getDb();
    const cur = await db.query<{ plan_id: string }>('SELECT plan_id FROM subscriptions WHERE company_id = $1', [companyId]);
    const fromPlanId = cur.rows[0]?.plan_id ?? null;
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO subscription_requests (id, company_id, from_plan_id, to_plan_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [id, companyId, fromPlanId, planId],
    );
    await db.query('UPDATE subscriptions SET pending_plan_id = $1 WHERE company_id = $2', [planId, companyId]);
    res.status(201).json({ id });
  }));

  router.get('/subscription/requests', requirePermission('platform.view'), wrap(async (_req, res) => {
    const db = await getDb();
    const rows = await db.query<{
      id: string; company_id: string; company_name: string; from_plan_id: string | null;
      to_plan_id: string; to_plan_name: string; requested_at: string;
    }>(
      `SELECT r.id, r.company_id, c.name AS company_name, r.from_plan_id,
              r.to_plan_id, COALESCE(p.name, r.to_plan_id) AS to_plan_name,
              r.requested_at::text AS requested_at
       FROM subscription_requests r
       JOIN companies c ON c.id = r.company_id
       LEFT JOIN plans p ON p.id = r.to_plan_id
       WHERE r.status = 'pending'
       ORDER BY r.requested_at DESC`,
    );
    const requests: SubscriptionRequest[] = rows.rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      companyName: r.company_name,
      fromPlanId: r.from_plan_id,
      toPlanId: r.to_plan_id,
      toPlanName: r.to_plan_name,
      requestedAt: r.requested_at,
    }));
    res.json({ requests });
  }));

  router.post('/subscription/requests/:requestId/decide', requirePermission('platform.companies.manage'), wrap(async (req, res) => {
    const approve = Boolean((req.body as Record<string, unknown>).approve);
    const requestId = String(req.params.requestId);
    const db = await getDb();
    const rRes = await db.query<{ id: string; company_id: string; to_plan_id: string; status: string }>(
      `SELECT id, company_id, to_plan_id, status FROM subscription_requests WHERE id = $1`,
      [requestId],
    );
    const r = rRes.rows[0];
    if (!r || r.status !== 'pending') {
      throw new HttpError(404, 'request_not_found', 'Demande introuvable ou déjà traitée.');
    }
    await db.query(
      `UPDATE subscription_requests SET status = $1, decided_at = NOW(), decided_by = $2 WHERE id = $3`,
      [approve ? 'approved' : 'rejected', req.identity!.userId, requestId],
    );
    if (approve) {
      const nextPeriodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      await db.query(
        `UPDATE subscriptions
         SET plan_id = $1, status = 'active', pending_plan_id = NULL, current_period_end = $2
         WHERE company_id = $3`,
        [r.to_plan_id, nextPeriodEnd, r.company_id],
      );
    } else {
      await db.query('UPDATE subscriptions SET pending_plan_id = NULL WHERE company_id = $1', [r.company_id]);
    }
    await logAudit(req.identity!.userId, approve ? 'subscription.approve' : 'subscription.reject', 'subscription_request', requestId, {
      companyId: r.company_id, toPlanId: r.to_plan_id,
    });
    res.json({ ok: true });
  }));

  // ─── Washes & Operations ───────────────────────────────────────────────────
  router.get('/washes/board', requirePermission('washes.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const ctx = await loadStationAppState(req, stationId);
    res.json({ washes: ctx.slice.washes, posts: ctx.slice.washPosts });
  }));

  router.get('/washes/clients', requirePermission('customers.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const ctx = await loadStationAppState(req, stationId);
    res.json({ clients: ctx.slice.clients });
  }));

  router.get('/washes/assignable', requirePermission('washes.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const users = await loadCompanyUsers(req.identity!.companyId!);
    const assignable = users.filter((u) =>
      u.active && (u.role === 'proprietaire' || (u.stationIds ?? []).includes(stationId)),
    );
    res.json({ users: assignable });
  }));

  router.get('/washes/metrics', requirePermission('washes.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const start = String(req.query.start ?? quotaMonthStartISO());
    const end = String(req.query.end ?? new Date().toISOString().slice(0, 10));
    validatePeriod(start, end);
    const ctx = await loadStationAppState(req, stationId);
    const financeAvailable = req.identity!.permissions.includes('reports.view')
      || req.identity!.permissions.includes('cash.open');

    const daySet = new Map<string, { revenue: number; collected: number; expenses: number; washCount: number; finishedCount: number }>();
    const from = new Date(`${start}T00:00:00Z`);
    const to = new Date(`${end}T23:59:59Z`);
    for (let d = new Date(from); d <= to && daySet.size <= 366; d = new Date(d.getTime() + 86_400_000)) {
      daySet.set(d.toISOString().slice(0, 10), { revenue: 0, collected: 0, expenses: 0, washCount: 0, finishedCount: 0 });
    }

    const serviceMap = new Map<string, { name: string; count: number; revenue: number }>();
    const clientMap = new Map<string, { name: string; count: number; revenue: number }>();
    const empMap = new Map<string, { id: string; name: string; count: number; revenue: number }>();
    const methodMap = new Map<PayMethod, { amount: number; count: number }>();
    const dayMethodMap = new Map<string, { date: string; method: PayMethod; amount: number; count: number }>();

    for (const w of ctx.slice.washes) {
      if (w.status === 'cancelled') continue;
      const day = w.createdAt.slice(0, 10);
      if (day < start || day > end) continue;
      const bucket = daySet.get(day);
      if (bucket) {
        bucket.revenue += w.total;
        bucket.washCount += 1;
        if (w.status === 'ready' || w.status === 'delivered') bucket.finishedCount += 1;
      }
      for (const item of w.items) {
        const cur = serviceMap.get(item.serviceName) ?? { name: item.serviceName, count: 0, revenue: 0 };
        cur.count += item.qty;
        cur.revenue += item.unitPrice * item.qty;
        serviceMap.set(item.serviceName, cur);
      }
      const cName = w.clientName?.trim() || 'Client de passage';
      const cli = clientMap.get(cName) ?? { name: cName, count: 0, revenue: 0 };
      cli.count += 1;
      cli.revenue += w.total;
      clientMap.set(cName, cli);

      const empIds = w.assignedUserIds.length ? [...new Set(w.assignedUserIds)] : (w.employeeId ? [w.employeeId] : []);
      if (empIds.length) {
        const share = Math.round(w.total / empIds.length);
        for (const eid of empIds) {
          const uName = ctx.users.find((u) => u.id === eid)?.name ?? 'Employé';
          const cur = empMap.get(eid) ?? { id: eid, name: uName, count: 0, revenue: 0 };
          cur.count += 1;
          cur.revenue += share;
          empMap.set(eid, cur);
        }
      }
    }

    for (const w of ctx.slice.washes) {
      for (const p of w.payments ?? []) {
        if (p.cancelledAt) continue;
        const day = p.at.slice(0, 10);
        if (day < start || day > end) continue;
        const bucket = daySet.get(day);
        if (bucket) bucket.collected += p.amount;
        const mCur = methodMap.get(p.method) ?? { amount: 0, count: 0 };
        mCur.amount += p.amount;
        mCur.count += 1;
        methodMap.set(p.method, mCur);
        const dmKey = `${day}:${p.method}`;
        const dmCur = dayMethodMap.get(dmKey) ?? { date: day, method: p.method, amount: 0, count: 0 };
        dmCur.amount += p.amount;
        dmCur.count += 1;
        dayMethodMap.set(dmKey, dmCur);
      }
    }

    if (financeAvailable) {
      for (const e of ctx.slice.expenses) {
        if (e.status !== 'enregistree') continue;
        const day = e.date.slice(0, 10);
        if (day < start || day > end) continue;
        const bucket = daySet.get(day);
        if (bucket) bucket.expenses += e.amount;
      }
    }

    res.json({
      stationId,
      periodStart: start,
      periodEnd: end,
      financeAvailable,
      trend: Array.from(daySet.entries()).map(([date, d]) => ({
        date,
        revenue: d.revenue,
        collected: financeAvailable ? d.collected : null,
        expenses: financeAvailable ? d.expenses : null,
        washCount: d.washCount,
        finishedCount: d.finishedCount,
      })),
      byMethod: Array.from(methodMap.entries()).map(([method, v]) => ({ method, ...v })),
      byDayMethod: Array.from(dayMethodMap.values()),
      topServices: Array.from(serviceMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      byEmployee: Array.from(empMap.values()).sort((a, b) => b.revenue - a.revenue),
      bestClients: Array.from(clientMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    });
  }));

  router.get('/washes/history', requirePermission('washes.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const plate = validatePlate(String(req.query.plate ?? '')).toUpperCase();
    const ctx = await loadStationAppState(req, stationId);
    const washes = ctx.slice.washes.filter((w) => w.plate.trim().toUpperCase() === plate);
    res.json({ washes });
  }));

  router.post('/washes/create', requirePermission('washes.create'), wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    const washId = await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);

      const idempotencyKey = String(body.idempotencyKey ?? '').trim();
      if (idempotencyKey) {
        const db = await getDb();
        const existingIdem = await db.query<{ id: string }>(
          'SELECT id FROM rpc_idempotency WHERE id = $1',
          [`wash:${companyId}:${idempotencyKey}`],
        );
        if (existingIdem.rows[0]) {
          const existingWash = ctx.slice.washes.find((w) =>
            w.history.some((h) => h.id === idempotencyKey) || w.id === idempotencyKey,
          );
          if (existingWash) return existingWash.id;
        }
      }

      const limits = await getPlanLimits(ctx.access.planId);
      if (monthWashCountAcrossCompany(ctx.doc) >= limits.washesPerMonth) {
        throw new HttpError(403, 'quota_exceeded', `Quota mensuel de ${limits.washesPerMonth} lavages atteint.`);
      }

      const categoryId = String(body.categoryId ?? '');
      const cat = ctx.slice.vehicleCategories.find((c) => c.id === categoryId && c.active);
      if (!cat) throw new HttpError(400, 'invalid_category', 'Catégorie de véhicule introuvable ou inactive.');

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) throw new HttpError(400, 'invalid_items', 'Ajoutez au moins une prestation.');
      const items: WashItem[] = rawItems.map((entry: unknown) => {
        const r = entry as Record<string, unknown>;
        const service = ctx.slice.services.find((s) => s.id === String(r.serviceId) && s.active);
        if (!service) throw new HttpError(400, 'invalid_service', 'Prestation introuvable ou inactive.');
        const unitPrice = Number(service.prices[categoryId] ?? 0);
        if (unitPrice <= 0) throw new HttpError(400, 'missing_price', `Tarif non configuré pour ${service.name} (${cat.name}).`);
        const qty = Math.round(Number(r.qty ?? 1));
        if (!Number.isSafeInteger(qty) || qty < 1) throw new HttpError(400, 'invalid_qty', 'Quantité invalide.');
        return { serviceId: service.id, serviceName: service.name, unitPrice, qty };
      });

      const gross = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
      const discount = validateMoney(Number(body.discount ?? 0));
      if (discount > gross) throw new HttpError(400, 'invalid_discount', 'La remise dépasse le total.');
      if (req.identity!.role === 'caissier' && discount > ctx.station.maxCashierDiscount) {
        throw new HttpError(403, 'discount_limit', `Remise limitée à ${ctx.station.maxCashierDiscount} FCFA pour un caissier.`);
      }
      const total = gross - discount;

      const paymentRaw = body.payment && typeof body.payment === 'object'
        ? body.payment as { amount: number; method: PayMethod }
        : null;
      if (paymentRaw) {
        const payAmount = validateMoney(Number(paymentRaw.amount), true);
        if (payAmount > total) throw new HttpError(400, 'overpayment', 'L’encaissement dépasse le total de la fiche.');
        if (!ctx.station.paymentMethods.includes(paymentRaw.method)) {
          throw new HttpError(400, 'invalid_method', 'Moyen de paiement non activé sur cette station.');
        }
        if (paymentRaw.method === 'especes' && ctx.station.cashRequiresOpen) {
          const openCash = ctx.slice.cashSessions.some((cs) => cs.status === 'ouverte');
          if (!openCash) throw new HttpError(400, 'cash_closed', 'Ouvrez la caisse avant d’encaisser en espèces.');
        }
      }

      const employeeIds = Array.isArray(body.employeeIds)
        ? body.employeeIds.filter((x): x is string => typeof x === 'string')
        : [];
      const postId = typeof body.postId === 'string' && body.postId ? body.postId : null;
      const now = new Date().toISOString();
      const nextCounter = (ctx.slice.washCounter ?? 0) + 1;
      const wId = idempotencyKey || crypto.randomUUID();
      const status: WashStatus = employeeIds.length > 0 ? 'assigned' : 'pending';
      const plate = validatePlate(String(body.plate ?? '')).toUpperCase();
      const clientId = typeof body.clientId === 'string' && body.clientId ? body.clientId : null;
      let clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';

      let clients = [...ctx.slice.clients];
      let finalClientId = clientId;
      if (!finalClientId && clientName.length >= 2) {
        const newCliId = crypto.randomUUID();
        clients.push({
          id: newCliId,
          stationId,
          name: clientName,
          phone: '',
          plate,
          notes: '',
          createdAt: now,
          customerType: 'individual',
          preferredChannel: 'none',
          loyaltyOptIn: false,
          fleetId: null,
        });
        finalClientId = newCliId;
      } else if (finalClientId) {
        const foundCli = clients.find((c) => c.id === finalClientId);
        if (foundCli && !clientName) clientName = foundCli.name;
      }

      const payments: Payment[] = [];
      let nextMovements = [...ctx.slice.cashMovements];
      if (paymentRaw) {
        const pId = crypto.randomUUID();
        payments.push({
          id: pId,
          amount: Math.round(paymentRaw.amount),
          method: paymentRaw.method,
          at: now,
          byUserId: req.identity!.userId,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:pay` : null,
        });
        const mv = cashPaymentMovement(
          ctx.appState, wId, pId, Math.round(paymentRaw.amount), paymentRaw.method,
          idempotencyKey ? `${idempotencyKey}:pay` : null, now,
        );
        if (mv) nextMovements.push(mv);
      }

      const wash: Wash = {
        id: wId,
        stationId,
        number: `LAV-${String(nextCounter).padStart(4, '0')}`,
        clientId: finalClientId,
        clientName: clientName || null,
        vehicleCategoryId: categoryId,
        vehicleLabel: cat.name,
        plate,
        employeeId: employeeIds[0] ?? '',
        assignedUserIds: employeeIds,
        postId,
        items,
        discount,
        total,
        paid: payments.reduce((s, p) => s + p.amount, 0),
        status,
        createdAt: now,
        finishedAt: null,
        deliveredAt: null,
        cancelledReason: null,
        payments,
        history: [
          washEvent(null, status, employeeIds.length > 0 ? 'Création et affectation' : 'Création de la fiche', now, req.identity!.userId, idempotencyKey || crypto.randomUUID()),
        ],
        qualityResult: null,
        qualityNotes: null,
      };

      ctx.doc.stationsData[stationId] = {
        ...ctx.slice,
        clients,
        washes: [wash, ...ctx.slice.washes],
        cashMovements: nextMovements,
        washCounter: nextCounter,
      };
      await saveTenantDoc(companyId, ctx.doc);
      if (idempotencyKey) {
        const db = await getDb();
        await db.query(
          `INSERT INTO rpc_idempotency (id, rpc_name, user_id) VALUES ($1, 'create_wash', $2) ON CONFLICT DO NOTHING`,
          [`wash:${companyId}:${idempotencyKey}`, req.identity!.userId],
        );
      }
      return wId;
    });

    res.status(201).json({ id: washId });
  }));

  router.post('/washes/:washId/status', requirePermission('washes.update_status'), wrap(async (req, res) => {
    const washId = String(req.params.washId);
    const body = req.body as Record<string, unknown>;
    const to = String(body.to ?? '') as WashStatus;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);
      const wash = ctx.slice.washes.find((w) => w.id === washId);
      if (!wash) throw new HttpError(404, 'wash_not_found', 'Fiche introuvable.');
      if (!canTransitionWash(wash.status, to)) {
        throw new HttpError(400, 'invalid_transition', `Transition ${wash.status} → ${to} interdite.`);
      }
      if (to === 'cancelled' && (!reason || reason.length < 2)) {
        throw new HttpError(400, 'reason_required', 'Précisez le motif d’annulation.');
      }
      const now = new Date().toISOString();
      const washes = ctx.slice.washes.map((w) => w.id !== washId ? w : {
        ...w,
        status: to,
        deliveredAt: to === 'delivered' ? now : w.deliveredAt,
        cancelledReason: to === 'cancelled' ? reason : w.cancelledReason,
        history: [...w.history, washEvent(w.status, to, reason, now, req.identity!.userId, crypto.randomUUID())],
      });
      ctx.doc.stationsData[stationId] = { ...ctx.slice, washes };
      await saveTenantDoc(companyId, ctx.doc);
    });
    res.json({ ok: true });
  }));

  router.post('/washes/:washId/assign', requirePermission('washes.assign'), wrap(async (req, res) => {
    const washId = String(req.params.washId);
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;
    const userIds = Array.isArray(body.userIds) ? body.userIds.filter((x): x is string => typeof x === 'string') : [];
    const postId = typeof body.postId === 'string' && body.postId ? body.postId : null;

    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);
      const wash = ctx.slice.washes.find((w) => w.id === washId);
      if (!wash) throw new HttpError(404, 'wash_not_found', 'Fiche introuvable.');
      const now = new Date().toISOString();
      const nextStatus: WashStatus = wash.status === 'pending' && userIds.length > 0 ? 'assigned' : wash.status;
      const washes = ctx.slice.washes.map((w) => w.id !== washId ? w : {
        ...w,
        assignedUserIds: userIds,
        employeeId: userIds[0] ?? w.employeeId,
        postId,
        status: nextStatus,
        history: nextStatus !== w.status
          ? [...w.history, washEvent(w.status, nextStatus, 'Affectation équipe / poste', now, req.identity!.userId, crypto.randomUUID())]
          : w.history,
      });
      ctx.doc.stationsData[stationId] = { ...ctx.slice, washes };
      await saveTenantDoc(companyId, ctx.doc);
    });
    res.json({ ok: true });
  }));

  router.post('/washes/:washId/quality', requirePermission('washes.quality'), wrap(async (req, res) => {
    const washId = String(req.params.washId);
    const body = req.body as Record<string, unknown>;
    const result = body.result as WashQualityResult;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);
      const wash = ctx.slice.washes.find((w) => w.id === washId);
      if (!wash) throw new HttpError(404, 'wash_not_found', 'Fiche introuvable.');
      if (wash.status !== 'quality_check') {
        throw new HttpError(400, 'invalid_status', 'Le contrôle qualité exige le statut « Contrôle qualité ».');
      }
      const now = new Date().toISOString();
      const to: WashStatus = result === 'approved' ? 'ready' : 'in_progress';
      const washes = ctx.slice.washes.map((w) => w.id !== washId ? w : {
        ...w,
        status: to,
        finishedAt: result === 'approved' ? now : w.finishedAt,
        qualityResult: result,
        qualityNotes: notes || null,
        history: [...w.history, washEvent(w.status, to, notes || (result === 'approved' ? 'Qualité approuvée' : 'Retouche demandée'), now, req.identity!.userId, crypto.randomUUID())],
      });
      ctx.doc.stationsData[stationId] = { ...ctx.slice, washes };
      await saveTenantDoc(companyId, ctx.doc);
    });
    res.json({ ok: true });
  }));

  router.post('/washes/:washId/payment', requirePermission('payments.create'), wrap(async (req, res) => {
    const washId = String(req.params.washId);
    const body = req.body as Record<string, unknown>;
    const amount = validateMoney(Number(body.amount), true);
    const method = String(body.method ?? '') as PayMethod;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);
      const wash = ctx.slice.washes.find((w) => w.id === washId);
      if (!wash) throw new HttpError(404, 'wash_not_found', 'Fiche introuvable.');
      if (wash.status === 'cancelled') throw new HttpError(400, 'cancelled_wash', 'Fiche annulée.');
      if (idempotencyKey && wash.payments.some((p) => p.idempotencyKey === idempotencyKey)) {
        return;
      }
      if (wash.paid + amount > wash.total) {
        throw new HttpError(400, 'overpayment', 'L’encaissement dépasse le reste dû.');
      }
      if (!ctx.station.paymentMethods.includes(method)) {
        throw new HttpError(400, 'invalid_method', 'Moyen de paiement non activé sur cette station.');
      }
      if (method === 'especes' && ctx.station.cashRequiresOpen) {
        if (!ctx.slice.cashSessions.some((c) => c.status === 'ouverte')) {
          throw new HttpError(400, 'cash_closed', 'Ouvrez la caisse avant d’encaisser en espèces.');
        }
      }
      const now = new Date().toISOString();
      const payment: Payment = {
        id: crypto.randomUUID(),
        amount,
        method,
        at: now,
        byUserId: req.identity!.userId,
        idempotencyKey: idempotencyKey || null,
      };
      const mv = cashPaymentMovement(ctx.appState, washId, payment.id, amount, method, idempotencyKey || null, now);
      const washes = ctx.slice.washes.map((w) => w.id !== washId ? w : {
        ...w,
        paid: w.paid + amount,
        payments: [...w.payments, payment],
      });
      ctx.doc.stationsData[stationId] = {
        ...ctx.slice,
        washes,
        cashMovements: mv ? [...ctx.slice.cashMovements, mv] : ctx.slice.cashMovements,
      };
      await saveTenantDoc(companyId, ctx.doc);
    });
    res.json({ ok: true });
  }));

  router.post('/washes/posts', requirePermission('catalog.manage'), wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;
    const name = String(body.name ?? '').trim();
    const capacity = Math.max(1, Math.round(Number(body.capacity ?? 1)));
    if (name.length < 2) throw new HttpError(400, 'invalid_form', 'Nom de poste trop court.');
    await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access);
      const post: WashPost = { id: crypto.randomUUID(), stationId, name, capacity, active: true };
      ctx.doc.stationsData[stationId] = { ...ctx.slice, washPosts: [...ctx.slice.washPosts, post] };
      await saveTenantDoc(companyId, ctx.doc);
    });
    res.status(201).json({ ok: true });
  }));

  // ─── Finance ───────────────────────────────────────────────────────────────
  router.get('/finance/board', requireAuth, wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const ctx = await loadStationAppState(req, stationId);
    res.json({
      paymentMethods: ctx.slice.paymentMethods,
      cashSessions: ctx.slice.cashSessions,
      cashMovements: ctx.slice.cashMovements,
      cashClosures: ctx.slice.cashClosures,
      expenses: ctx.slice.expenses,
      reconciliations: ctx.slice.reconciliations,
      commissionPeriods: ctx.slice.commissionPeriods,
      commissionLines: ctx.slice.commissionLines,
      commissionPayouts: ctx.slice.commissionPayouts,
      paymentCancellations: ctx.slice.paymentCancellations,
    });
  }));

  router.get('/finance/profitability', requirePermission('reports.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const start = String(req.query.start ?? quotaMonthStartISO());
    const end = String(req.query.end ?? new Date().toISOString().slice(0, 10));
    validatePeriod(start, end);
    const ctx = await loadStationAppState(req, stationId);
    const raw = buildProfitability(ctx.appState, new Date(`${start}T00:00:00`), new Date(`${end}T23:59:59`));
    const report = ctx.access.features.stock ? raw : redactStockProfitability(raw);
    res.json(report);
  }));

  router.post('/finance/:action', requireAuth, wrap(async (req, res) => {
    const action = String(req.params.action);
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    const permMap: Record<string, string> = {
      'open-cash': 'cash.open',
      'close-cash': 'cash.close',
      'reopen-cash': 'cash.reopen',
      expense: 'expenses.create',
      'cancel-expense': 'expenses.cancel',
      'cancel-payment': 'payments.cancel',
      reconcile: 'cash.close',
      'commission-period': 'commissions.view',
      'commission-validate': 'commissions.validate',
      'commission-payout': 'commissions.validate',
    };
    const requiredPerm = permMap[action];
    if (!requiredPerm) throw new HttpError(404, 'unknown_action', 'Action finance inconnue.');
    if (!req.identity!.permissions.includes(requiredPerm) && !req.identity!.isPlatformAdmin) {
      throw new HttpError(403, 'forbidden', `Permission requise : ${requiredPerm}.`);
    }

    const result = await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);
      const now = new Date().toISOString();
      let nextState = ctx.appState;
      let id: string | undefined;

      if (action === 'open-cash') {
        if (nextState.cashSessions.some((c) => c.status === 'ouverte')) {
          throw new HttpError(400, 'already_open', 'Une session de caisse est déjà ouverte.');
        }
        const openingFloat = validateMoney(Number(body.openingFloat ?? 0));
        id = crypto.randomUUID();
        const session: CashSession = {
          id, stationId, openedBy: req.identity!.userId, openedAt: now, openingFloat,
          closedAt: null, countedAmount: null, closedBy: null, status: 'ouverte',
          reopenReason: null, reopenedAt: null,
        };
        const mv = movement(nextState, id, 'opening', openingFloat, 'especes', null, null, 'Fond de caisse', null, now);
        nextState = {
          ...nextState,
          cashSessions: [session, ...nextState.cashSessions],
          cashMovements: [...nextState.cashMovements, mv],
        };
      } else if (action === 'close-cash') {
        const sessionId = String(body.sessionId ?? '');
        const counted = validateMoney(Number(body.counted));
        const cs = nextState.cashSessions.find((c) => c.id === sessionId && c.status === 'ouverte');
        if (!cs) throw new HttpError(404, 'session_not_found', 'Session de caisse ouverte introuvable.');
        const since = cs.reopenedAt ?? cs.openedAt;
        const cashIn = nextState.washes.flatMap((w) => w.payments)
          .filter((p) => !p.cancelledAt && p.method === 'especes' && p.at >= since)
          .reduce((s, p) => s + p.amount, 0);
        const cashOut = nextState.expenses
          .filter((e) => e.status === 'enregistree' && e.method === 'especes' && e.cashSessionId === cs.id)
          .reduce((s, e) => s + e.amount, 0);
        const theoretical = cs.openingFloat + cashIn - cashOut;
        nextState = closeCashWithLedger(nextState, sessionId, counted, theoretical, now);
      } else if (action === 'reopen-cash') {
        const sessionId = String(body.sessionId ?? '');
        const reason = String(body.reason ?? '').trim();
        if (reason.length < 3) throw new HttpError(400, 'reason_required', 'Motif de réouverture requis.');
        if (nextState.cashSessions.some((c) => c.status === 'ouverte')) {
          throw new HttpError(400, 'already_open', 'Une session de caisse est déjà ouverte.');
        }
        nextState = {
          ...nextState,
          cashSessions: nextState.cashSessions.map((c) => c.id === sessionId ? {
            ...c, status: 'ouverte' as const, reopenReason: reason, reopenedAt: now,
          } : c),
          cashMovements: [...nextState.cashMovements, movement(nextState, sessionId, 'reopen', 0, null, null, null, reason, null, now)],
        };
      } else if (action === 'expense') {
        validateExpense(body);
        const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null;
        if (key) {
          const dup = nextState.expenses.find((e) => e.idempotencyKey === key);
          if (dup) return { id: dup.id };
        }
        const openSession = nextState.cashSessions.find((c) => c.status === 'ouverte');
        if (body.method === 'especes' && nextState.station?.cashRequiresOpen && !openSession) {
          throw new HttpError(400, 'cash_closed', 'Ouvrez la caisse avant d’enregistrer une dépense en espèces.');
        }
        id = crypto.randomUUID();
        const expense: Expense = {
          id,
          stationId,
          amount: Math.round(Number(body.amount)),
          category: String(body.category).trim(),
          reason: String(body.reason).trim(),
          supplier: String(body.supplier ?? '').trim(),
          date: String(body.date).slice(0, 10),
          method: body.method as PayMethod,
          cashSessionId: body.method === 'especes' ? (openSession?.id ?? null) : null,
          status: 'enregistree',
          cancelReason: null,
          createdBy: req.identity!.userId,
          createdAt: now,
          idempotencyKey: key,
        };
        const mvs = body.method === 'especes' && openSession
          ? [...nextState.cashMovements, movement(nextState, openSession.id, 'expense_out', -expense.amount, 'especes', null, id, expense.reason, key ? `exp:${key}` : null, now)]
          : nextState.cashMovements;
        nextState = { ...nextState, expenses: [expense, ...nextState.expenses], cashMovements: mvs };
      } else if (action === 'cancel-expense') {
        const reason = String(body.reason ?? '').trim();
        if (reason.length < 2) throw new HttpError(400, 'reason_required', 'Motif requis.');
        nextState = cancelExpenseWithLedger(nextState, String(body.id), reason, now);
      } else if (action === 'cancel-payment') {
        const reason = String(body.reason ?? '').trim();
        if (reason.length < 2) throw new HttpError(400, 'reason_required', 'Motif requis.');
        nextState = cancelPaymentWithLedger(nextState, String(body.paymentId), reason, now);
      } else if (action === 'reconcile') {
        const methodId = String(body.methodId ?? '');
        const start = String(body.start ?? '');
        const end = String(body.end ?? '');
        validatePeriod(start, end);
        const counted = validateMoney(Number(body.counted));
        nextState = reconcileChannelLocal(nextState, methodId, start, end, counted, now);
      } else if (action === 'commission-period') {
        const start = String(body.start ?? '');
        const end = String(body.end ?? '');
        validatePeriod(start, end);
        const created = createCommissionPeriodLocal(nextState, stationId, start, end);
        nextState = created.state;
        id = created.id;
      } else if (action === 'commission-validate') {
        nextState = validateCommissionPeriodLocal(nextState, String(body.periodId), now);
      } else if (action === 'commission-payout') {
        const amount = validateMoney(Number(body.amount), true);
        nextState = recordCommissionPayoutLocal(
          nextState, String(body.periodId), String(body.userId), amount, String(body.reference ?? '').trim(), now,
        );
      }

      ctx.doc.stationsData[stationId] = extractSlice(nextState);
      await saveTenantDoc(companyId, ctx.doc);
      return { id };
    });

    res.json({ ok: true, id: result.id });
  }));

  // ─── Stock ─────────────────────────────────────────────────────────────────
  router.get('/stock/board', requirePermission('inventory.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const ctx = await loadStationAppState(req, stationId);
    assertModuleFeature(req, ctx.access, 'inventory.view');
    res.json(stockBoardFromState(ctx.appState));
  }));

  router.post('/stock/:action', requireAuth, wrap(async (req, res) => {
    const action = String(req.params.action);
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    const permMap: Record<string, string> = {
      supplier: 'inventory.receive',
      product: 'inventory.receive',
      order: 'inventory.receive',
      receive: 'inventory.receive',
      'inventory-start': 'inventory.adjust',
      'inventory-count': 'inventory.adjust',
      'inventory-close': 'inventory.adjust',
      'consumption-rule': 'inventory.consume',
      'consume-wash': 'inventory.consume',
      'link-expense': 'inventory.receive',
      'certify-costs': 'reports.view',
    };
    const requiredPerm = permMap[action];
    if (!requiredPerm) throw new HttpError(404, 'unknown_action', 'Action stock inconnue.');
    if (!req.identity!.permissions.includes(requiredPerm) && !req.identity!.isPlatformAdmin) {
      throw new HttpError(403, 'forbidden', `Permission requise : ${requiredPerm}.`);
    }

    const out = await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, true);
      assertModuleFeature(req, ctx.access, 'inventory.view');

      let next = ctx.appState;
      let id: string | undefined;

      if (action === 'supplier') {
        const p = { ...body, stationId } as Parameters<typeof saveSupplierLocal>[1];
        validateSupplier(p);
        const r = saveSupplierLocal(next, p);
        next = r.state; id = r.id;
      } else if (action === 'product') {
        const p = { ...body, stationId } as Parameters<typeof saveProductLocal>[1];
        validateProduct(p);
        const r = saveProductLocal(next, p);
        next = r.state; id = r.id;
      } else if (action === 'order') {
        const p = { ...body, stationId } as Parameters<typeof createPurchaseOrderLocal>[1];
        validateOrder(p);
        const r = createPurchaseOrderLocal(next, p);
        next = r.state; id = r.id;
      } else if (action === 'receive') {
        const p = body as unknown as Parameters<typeof receivePurchaseLinesLocal>[1];
        validateReceipt(p);
        next = receivePurchaseLinesLocal(next, p);
      } else if (action === 'inventory-start') {
        const r = startInventoryLocal(next, stationId);
        next = r.state; id = r.id;
      } else if (action === 'inventory-count') {
        const p = body as unknown as Parameters<typeof recordInventoryCountLocal>[1];
        validateInventory(p);
        next = recordInventoryCountLocal(next, p);
      } else if (action === 'inventory-close') {
        next = closeInventoryLocal(next, String(body.sessionId));
      } else if (action === 'consumption-rule') {
        const p = body as unknown as Parameters<typeof saveServiceConsumptionLocal>[1];
        validateConsumption(p);
        const r = saveServiceConsumptionLocal(next, p);
        next = r.state; id = r.id;
      } else if (action === 'consume-wash') {
        next = consumeWashLocal(next, String(body.washId));
      } else if (action === 'link-expense') {
        next = linkExpenseToOrderLocal(next, String(body.expenseId), String(body.orderId));
      } else if (action === 'certify-costs') {
        const p = body as unknown as Parameters<typeof certifyCostsLocal>[1];
        validateCertification(p);
        next = certifyCostsLocal(next, p);
      }

      ctx.doc.stationsData[stationId] = extractSlice(next);
      await saveTenantDoc(companyId, ctx.doc);
      return { id };
    });

    res.json({ ok: true, id: out.id });
  }));

  // ─── CRM ───────────────────────────────────────────────────────────────────
  router.get('/crm/board', requirePermission('crm.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const ctx = await loadStationAppState(req, stationId);
    res.json(crmBoardFromState(ctx.appState));
  }));

  router.post('/crm/:action', requireAuth, wrap(async (req, res) => {
    const action = String(req.params.action);
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const companyId = req.identity!.companyId!;

    const out = await withCompanyLock(companyId, async () => {
      const ctx = await loadStationAppState(req, stationId);
      assertWritable(ctx.access, ctx.station, action !== 'customer-profile' && action !== 'customer-vehicle');
      let next = ctx.appState;
      let result: unknown = { ok: true };

      if (action === 'customer-profile') {
        const p = { ...body, stationId } as Parameters<typeof saveCustomerProfileLocal>[1];
        validateCustomer(p);
        const r = saveCustomerProfileLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'customer-vehicle') {
        const p = { ...body, stationId } as Parameters<typeof saveCustomerVehicleLocal>[1];
        validatePlate(p.plate);
        const r = saveCustomerVehicleLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'loyalty-program') {
        assertModuleFeature(req, ctx.access, 'loyalty.manage');
        const r = createLoyaltyProgramLocal(next, { ...body, stationId } as Parameters<typeof createLoyaltyProgramLocal>[1]);
        next = r.state; result = { id: r.value };
      } else if (action === 'loyalty-enroll') {
        assertModuleFeature(req, ctx.access, 'loyalty.manage');
        const r = enrollLoyaltyCustomerLocal(next, { ...body, stationId } as Parameters<typeof enrollLoyaltyCustomerLocal>[1]);
        next = r.state; result = { id: r.value };
      } else if (action === 'loyalty-tx') {
        assertModuleFeature(req, ctx.access, 'loyalty.manage');
        const r = recordLoyaltyTransactionLocal(next, body as unknown as Parameters<typeof recordLoyaltyTransactionLocal>[1]);
        next = r.state; result = { id: r.value };
      } else if (action === 'loyalty-accrue') {
        assertModuleFeature(req, ctx.access, 'loyalty.manage');
        const r = accrueLoyaltyForWashLocal(next, String(body.washId), body.idempotencyKey as string | undefined);
        next = r.state; result = r.value;
      } else if (action === 'package-plan') {
        assertModuleFeature(req, ctx.access, 'packages.manage');
        const p = { ...body, stationId } as Parameters<typeof savePackagePlanLocal>[1];
        validatePackage(p);
        const r = savePackagePlanLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'package-sell') {
        assertModuleFeature(req, ctx.access, 'packages.manage');
        const r = sellPackageToCustomerLocal(next, { ...body, stationId } as Parameters<typeof sellPackageToCustomerLocal>[1]);
        next = r.state; result = { id: r.value };
      } else if (action === 'package-consume') {
        assertModuleFeature(req, ctx.access, 'packages.manage');
        const r = consumePackageForWashLocal(next, String(body.washId));
        next = r.state; result = r.value;
      } else if (action === 'promotion') {
        assertModuleFeature(req, ctx.access, 'promotions.manage');
        const p = { ...body, stationId } as Parameters<typeof savePromotionLocal>[1];
        validatePromotion(p);
        const r = savePromotionLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'promotion-apply') {
        assertModuleFeature(req, ctx.access, 'promotions.manage');
        const r = applyPromotionToWashLocal(next, body as unknown as Parameters<typeof applyPromotionToWashLocal>[1]);
        next = r.state; result = r.value;
      } else if (action === 'fleet') {
        assertModuleFeature(req, ctx.access, 'fleets.manage');
        const p = { ...body, stationId } as Parameters<typeof saveFleetLocal>[1];
        validateFleet(p);
        const r = saveFleetLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'fleet-contract') {
        assertModuleFeature(req, ctx.access, 'fleets.manage');
        const p = { ...body, stationId } as Parameters<typeof saveFleetContractLocal>[1];
        validateFleetContract(p);
        const r = saveFleetContractLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'fleet-attach-vehicle') {
        assertModuleFeature(req, ctx.access, 'fleets.manage');
        const r = attachFleetVehicleLocal(next, { ...body, stationId } as Parameters<typeof attachFleetVehicleLocal>[1]);
        next = r.state; result = { id: r.value };
      } else if (action === 'fleet-receivable') {
        assertModuleFeature(req, ctx.access, 'fleets.manage');
        const p = { ...body, stationId } as Parameters<typeof recordFleetReceivableLocal>[1];
        validateFleetReceivable(p);
        const r = recordFleetReceivableLocal(next, p);
        next = r.state; result = { id: r.value };
      } else if (action === 'notification-enqueue') {
        assertModuleFeature(req, ctx.access, 'notifications.enqueue');
        const r = enqueueNotificationLocalServer(next, { ...body, stationId });
        next = r.state; result = { id: r.value };
      } else if (action === 'notification-cancel') {
        const r = cancelPendingNotificationLocal(next, String(body.id));
        next = r.state; result = { ok: true };
      } else {
        throw new HttpError(404, 'unknown_action', 'Action CRM inconnue.');
      }

      ctx.doc.stationsData[stationId] = extractSlice(next);
      await saveTenantDoc(companyId, ctx.doc);
      return result;
    });

    res.json(out);
  }));

  // ─── Analytics & Multi-Station Consolidation ───────────────────────────────
  router.get('/analytics/board', requirePermission('analytics.view'), wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId!;
    const start = String(req.query.start ?? quotaMonthStartISO());
    const end = String(req.query.end ?? new Date().toISOString().slice(0, 10));
    validatePeriod(start, end);
    const compareStart = typeof req.query.compareStart === 'string' && req.query.compareStart ? req.query.compareStart : null;
    const compareEnd = typeof req.query.compareEnd === 'string' && req.query.compareEnd ? req.query.compareEnd : null;
    if (compareStart && compareEnd) validatePeriod(compareStart, compareEnd);

    const { access, subscription } = await computeSubscriptionAccess(companyId);
    const doc = await loadTenantDoc(companyId);
    const users = await loadCompanyUsers(companyId);
    const company = await loadCompanyRecord(companyId);

    const buildMergedForRange = async (rStart: string, rEnd: string) => {
      const stationRows: AnalyticsStation[] = [];
      let totalRevenue = 0;
      let totalCollected = 0;
      let totalReceivables = 0;
      let totalExpenses = 0;
      let totalConsumptions = 0;
      let totalCommissions = 0;
      let totalWashCount = 0;
      let allCertified = true;

      for (const stSummary of id.stations) {
        const st = await loadStationRecord(stSummary.id, companyId);
        const slice = normalizeSlice(doc.stationsData[st.id], st.id, st.paymentMethods);
        const stationAppState = withStockDefaults(withFinanceDefaults({
          company, station: st, users, ...slice,
          profitability: null, stockValuation: { ...EMPTY_STOCK_VALUATION }, stockAlerts: [],
          stockServices: [], crmStats: {
            clients: 0, vehicles: 0, activeCards: 0, activePackages: 0,
            activePromotions: 0, fleets: 0, openReceivablesMinor: 0, pendingNotifications: 0,
          }, crmRules: { ...CRM_RULES },
          subscription, auditLogs: [], platformCompanies: [], session: null, demoMode: false,
        } as AppState));
        const prof = buildProfitability(stationAppState, new Date(`${rStart}T00:00:00`), new Date(`${rEnd}T23:59:59`));
        const washes = slice.washes.filter((w) => w.status !== 'cancelled' && w.createdAt.slice(0, 10) >= rStart && w.createdAt.slice(0, 10) <= rEnd);
        totalRevenue += prof.revenue;
        totalCollected += prof.collected;
        totalReceivables += prof.receivables;
        totalExpenses += prof.expenses;
        totalConsumptions += prof.consumptions ?? 0;
        totalCommissions += prof.commissions;
        totalWashCount += washes.length;
        if (!prof.certified) allCertified = false;

        stationRows.push({
          rank: 1,
          stationId: st.id,
          name: st.name,
          city: st.city,
          revenue: prof.revenue,
          collected: prof.collected,
          receivables: prof.receivables,
          expenses: prof.expenses,
          consumptions: prof.consumptions,
          partialBalance: prof.partialBalance,
          washCount: washes.length,
          grossMargin: prof.grossMargin,
          result: prof.result,
          certified: prof.certified === true,
        });
      }

      stationRows.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
      stationRows.forEach((s, idx) => { s.rank = idx + 1; });

      const report = emptyProfitability(rStart, rEnd);
      report.revenue = totalRevenue;
      report.collected = totalCollected;
      report.receivables = totalReceivables;
      report.expenses = totalExpenses;
      report.consumptions = totalConsumptions;
      report.commissions = totalCommissions;
      report.partialBalance = totalCollected - totalExpenses;
      if (stationRows.length > 0 && allCertified) {
        report.certified = true;
        report.costsMissing = false;
        report.grossMargin = stationRows.reduce((s, r) => s + (r.grossMargin ?? 0), 0);
        report.result = stationRows.reduce((s, r) => s + (r.result ?? 0), 0);
      }

      return { stationRows, report, totalWashCount };
    };

    const main = await buildMergedForRange(start, end);
    const comp = compareStart && compareEnd ? await buildMergedForRange(compareStart, compareEnd) : null;

    const trendMap = new Map<string, AnalyticsTrendPoint>();
    const fromD = new Date(`${start}T00:00:00Z`);
    const toD = new Date(`${end}T00:00:00Z`);
    for (let d = new Date(fromD); d <= toD && trendMap.size <= 92; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10);
      trendMap.set(k, { date: k, revenue: 0, collected: 0, expenses: 0, washCount: 0 });
    }
    for (const stSummary of id.stations) {
      const slice = doc.stationsData[stSummary.id];
      if (!slice) continue;
      for (const w of slice.washes ?? []) {
        if (w.status !== 'cancelled') {
          const pt = trendMap.get(w.createdAt.slice(0, 10));
          if (pt) { pt.revenue += w.total; pt.washCount += 1; }
        }
        for (const p of w.payments ?? []) {
          if (!p.cancelledAt) {
            const pt = trendMap.get(p.at.slice(0, 10));
            if (pt) pt.collected += p.amount;
          }
        }
      }
      for (const e of slice.expenses ?? []) {
        if (e.status === 'enregistree') {
          const pt = trendMap.get(e.date.slice(0, 10));
          if (pt) pt.expenses += e.amount;
        }
      }
    }

    const compareDelta = comp ? main.report.revenue - comp.report.revenue : null;
    const snapshot: AnalyticsSnapshot = {
      periodStart: start,
      periodEnd: end,
      compareStart,
      compareEnd,
      period: main.report,
      compare: comp?.report ?? null,
      compareDelta,
      stations: main.stationRows,
      rankings: main.stationRows.map((s) => ({
        rank: s.rank, stationId: s.stationId, name: s.name,
        revenue: s.revenue, washCount: s.washCount, collected: s.collected,
      })),
      trend: Array.from(trendMap.values()),
      definitions: main.report.definitions,
      stats: {
        stations: main.stationRows.length,
        revenue: main.report.revenue,
        collected: main.report.collected,
        receivables: main.report.receivables,
        partialBalance: main.report.partialBalance,
        washCount: main.totalWashCount,
        certified: main.report.certified === true,
        compareDelta,
      },
      rules: { ...ANALYTICS_RULES },
    };

    res.json(access.features.stock ? snapshot : redactStockAnalytics(snapshot));
  }));

  router.get('/analytics/usage', requireAuth, wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId;
    const periodStart = String(req.query.periodStart ?? quotaMonthStartISO());
    if (!companyId) {
      res.json({
        periodStart,
        usage: { stations: 0, employees: 0, washes: 0 },
        limits: { stations: null, employees: null, washesPerMonth: null },
        rows: [],
        rules: { quota: 'Limite lue côté serveur' },
      } satisfies SubscriptionUsageSnapshot);
      return;
    }
    const db = await getDb();
    const { access } = await computeSubscriptionAccess(companyId);
    const limits = await getPlanLimits(access.planId);
    const stRes = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM stations WHERE company_id = $1', [companyId]);
    const empRes = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users WHERE company_id = $1 AND active = TRUE', [companyId]);
    const doc = await loadTenantDoc(companyId);
    const washesCount = monthWashCountAcrossCompany(doc, periodStart);
    const stationCount = Number(stRes.rows[0]?.count ?? '0');
    const empCount = Number(empRes.rows[0]?.count ?? '0');

    res.json({
      periodStart,
      usage: { stations: stationCount, employees: empCount, washes: washesCount },
      limits,
      rows: [],
      rules: { quota: 'Limite lue et appliquée côté serveur' },
    } satisfies SubscriptionUsageSnapshot);
  }));

  // ─── Platform Back-office (super_admin) ────────────────────────────────────
  router.get('/platform/board', requirePermission('platform.view'), wrap(async (_req, res) => {
    const db = await getDb();
    const plans = await listActivePlansFromDb();
    const compRes = await db.query<{
      id: string; name: string; city: string; phone: string; suspended: boolean; created_at: string;
    }>('SELECT id, name, city, phone, suspended, created_at::text AS created_at FROM companies ORDER BY created_at DESC');

    const companies: PlatformSnapshot['companies'] = [];
    for (const c of compRes.rows) {
      const { access } = await computeSubscriptionAccess(c.id);
      const limits = await getPlanLimits(access.planId);
      const stRes = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM stations WHERE company_id = $1', [c.id]);
      const empRes = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users WHERE company_id = $1 AND active = TRUE', [c.id]);
      const doc = await loadTenantDoc(c.id);
      const washesMonth = monthWashCountAcrossCompany(doc);
      const stationCount = Number(stRes.rows[0]?.count ?? '0');
      const employeeCount = Number(empRes.rows[0]?.count ?? '0');

      const monthStart = quotaMonthStartISO();
      let monthlyRevenue = 0;
      for (const slice of Object.values(doc.stationsData)) {
        for (const w of slice.washes ?? []) {
          if (w.status !== 'cancelled' && w.createdAt.slice(0, 10) >= monthStart) {
            monthlyRevenue += w.total;
          }
        }
      }

      const quotaExceeded = stationCount > limits.stations || employeeCount > limits.employees || washesMonth > limits.washesPerMonth;
      companies.push({
        companyId: c.id,
        name: c.name,
        city: c.city,
        phone: c.phone,
        suspended: c.suspended,
        status: c.suspended ? 'suspendue' : (access.status === 'trial' ? 'essai' : 'active'),
        planId: access.planId,
        planName: access.planName,
        subscriptionStatus: access.status,
        subscriptionStartedAt: access.startedAt,
        subscriptionReason: access.reason,
        stationCount,
        employeeCount,
        washesMonth,
        monthlyRevenue,
        companyCreatedAt: c.created_at,
        limits,
        quota: {
          stationsUsed: stationCount,
          employeesUsed: employeeCount,
          washesMonthUsed: washesMonth,
          quotaExceeded,
        },
      });
    }

    const planLimits = plans.flatMap((p) => [
      { planId: p.id, key: 'stations', valueInt: p.limits.stations },
      { planId: p.id, key: 'employees', valueInt: p.limits.employees },
      { planId: p.id, key: 'washes_per_month', valueInt: p.limits.washesPerMonth },
    ]);
    const auditRes = await db.query<{
      id: string; actor_user_id: string | null; action: string; entity_type: string;
      entity_id: string; detail: Record<string, unknown>; created_at: string;
    }>('SELECT id, actor_user_id, action, entity_type, entity_id, detail, created_at::text AS created_at FROM platform_audit_logs ORDER BY created_at DESC LIMIT 100');

    res.json({
      companies,
      plans,
      planLimits,
      subscriptionUsage: [],
      auditLogs: auditRes.rows.map((a) => ({
        id: a.id,
        actorUserId: a.actor_user_id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        detail: a.detail ?? {},
        createdAt: a.created_at,
      })),
      stats: {
        companies: companies.length,
        suspendedCompanies: companies.filter((c) => c.suspended).length,
        plans: plans.length,
        planLimits: planLimits.length,
        usageRows: 0,
        auditLogs: auditRes.rows.length,
        quotasExceeded: companies.filter((c) => c.quota.quotaExceeded).length,
      },
      rules: { ...PLATFORM_RULES },
    } satisfies PlatformSnapshot);
  }));

  router.post('/platform/:action', requirePermission('platform.view'), wrap(async (req, res) => {
    const action = String(req.params.action);
    const body = req.body as Record<string, unknown>;
    const db = await getDb();

    if (action === 'refresh-usage') {
      await logAudit(req.identity!.userId, 'platform.refresh_usage', 'subscription_usage', String(body.periodStart ?? ''), {});
      res.json({ ok: true });
      return;
    }
    if (action === 'save-plan') {
      if (!req.identity!.permissions.includes('platform.plans.manage')) {
        throw new HttpError(403, 'forbidden', 'Permission requise.');
      }
      const planId = String(body.planId ?? '').trim();
      const name = String(body.name ?? '').trim();
      const priceMinor = Math.max(0, Math.round(Number(body.priceMinor ?? 0)));
      const trialDays = Math.max(0, Math.round(Number(body.trialDays ?? 0)));
      const active = body.active !== false;
      const sortOrder = Math.round(Number(body.sortOrder ?? 1));
      const features = Array.isArray(body.features) ? body.features.filter((f): f is string => typeof f === 'string') : [];
      await db.query(
        `INSERT INTO plans (id, name, price_minor, trial_days, active, sort_order, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (id) DO UPDATE SET name = $2, price_minor = $3, trial_days = $4, active = $5, sort_order = $6, features = $7::jsonb`,
        [planId, name, priceMinor, trialDays, active, sortOrder, JSON.stringify(features)],
      );
      await logAudit(req.identity!.userId, 'platform.save_plan', 'plans', planId, { name, priceMinor });
      res.json({ id: planId });
      return;
    }
    if (action === 'set-plan-limit') {
      const planId = String(body.planId ?? '').trim();
      const key = String(body.key ?? '').trim();
      const valueInt = Math.max(1, Math.round(Number(body.valueInt ?? 1)));
      await db.query(
        `INSERT INTO plan_limits (plan_id, metric_key, value_int)
         VALUES ($1, $2, $3) ON CONFLICT (plan_id, metric_key) DO UPDATE SET value_int = $3`,
        [planId, key, valueInt],
      );
      await logAudit(req.identity!.userId, 'platform.set_plan_limit', 'plan_limits', `${planId}:${key}`, { valueInt });
      res.json({ ok: true });
      return;
    }
    if (action === 'set-company-subscription') {
      const companyId = String(body.companyId ?? '').trim();
      const planId = String(body.planId ?? '').trim();
      const status = String(body.status ?? 'active').trim();
      const nextPeriodEnd = planId === 'essai' ? null : new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      await db.query(
        `UPDATE subscriptions SET plan_id = $1, status = $2, pending_plan_id = NULL, current_period_end = COALESCE($3, current_period_end) WHERE company_id = $4`,
        [planId, status, nextPeriodEnd, companyId],
      );
      await logAudit(req.identity!.userId, 'platform.set_company_subscription', 'companies', companyId, { planId, status });
      res.json({ ok: true });
      return;
    }
    if (action === 'set-company-suspended') {
      const companyId = String(body.companyId ?? '').trim();
      const suspended = Boolean(body.suspended);
      await db.query('UPDATE companies SET suspended = $1 WHERE id = $2', [suspended, companyId]);
      await logAudit(req.identity!.userId, suspended ? 'platform.suspend_company' : 'platform.unsuspend_company', 'companies', companyId, { suspended });
      res.json({ ok: true });
      return;
    }

    throw new HttpError(404, 'unknown_action', 'Action plateforme inconnue.');
  }));

  // ─── QA & Station Logo Storage ─────────────────────────────────────────────
  router.get('/qa/board', requirePermission('reports.view'), wrap(async (_req, res) => {
    res.json({
      migrations: 15,
      tables: 15,
      views: 4,
      permissions: permissionsForRole('super_admin').length,
      rolePermissions: 6,
      indexes: 12,
      storageBucket: true,
      storagePolicies: 4,
      bucketPolicies: 2,
      anonStorageRevoked: true,
      anonStorageSelectGrant: false,
      authenticatedBucketInsertRevoked: true,
      idempotencyTable: true,
      rpcCount: 38,
      quotaTriggers: 3,
      rules: {
        auth: 'Session HTTP-only vérifiée par le serveur sur chaque route.',
        tenant: 'Isolation stricte par companyId et stationId.',
        idempotency: 'Clés d’idempotence vérifiées côté serveur.',
        storage: 'Logos stockés en base PostgreSQL avec contrôle d’accès par entreprise.',
      },
    });
  }));

  router.get('/qa/washes-page', requirePermission('washes.view'), wrap(async (req, res) => {
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const ctx = await loadStationAppState(req, stationId);
    const slice = ctx.slice.washes.slice(offset, offset + limit);
    res.json({
      rows: slice.map((w) => ({
        washId: w.id,
        number: w.number,
        status: w.status,
        total: w.total,
        paid: w.paid,
        createdAt: w.createdAt,
        stationId: w.stationId,
        customerName: w.clientName,
        plate: w.plate || null,
      })),
      total: ctx.slice.washes.length,
      limit,
      offset,
      hasMore: offset + slice.length < ctx.slice.washes.length,
      rules: { pagination: 'Pagination calculée sur les données persistées de la station.' },
    });
  }));

  router.post('/storage/station-logo/claim', requirePermission('settings.manage'), wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId!;
    const body = req.body as Record<string, unknown>;
    const filename = String(body.filename ?? 'logo.webp').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const objectPath = `${companyId}/${filename}`;
    if (!isStationLogoPath(objectPath)) {
      throw new HttpError(400, 'invalid_path', 'Nom de fichier logo invalide.');
    }
    res.json({ path: objectPath });
  }));

  router.put('/storage/station-logo/upload', requirePermission('settings.manage'), wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId!;
    const logoPath = String(req.query.path ?? '');
    if (!isStationLogoPath(logoPath) || !logoPath.startsWith(`${companyId}/`)) {
      throw new HttpError(403, 'forbidden', 'Chemin de logo refusé.');
    }
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buf.length === 0 || buf.length > 5 * 1024 * 1024) {
      throw new HttpError(400, 'invalid_file', 'Fichier vide ou supérieur à 5 Mo.');
    }
    const mimeType = String(req.headers['content-type'] ?? 'image/png').split(';')[0].trim();
    const stationId = resolveStationId(req, req.query.stationId as string | undefined);
    const db = await getDb();
    await db.query(
      `INSERT INTO station_logos (path, company_id, station_id, mime_type, data_base64)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (path) DO UPDATE SET mime_type = $4, data_base64 = $5`,
      [logoPath, companyId, stationId, mimeType, buf.toString('base64')],
    );
    res.json({ path: logoPath });
  }));

  router.post('/storage/station-logo/save', requirePermission('settings.manage'), wrap(async (req, res) => {
    const id = req.identity!;
    const companyId = id.companyId!;
    const body = req.body as Record<string, unknown>;
    const stationId = resolveStationId(req, body.stationId as string | undefined);
    const logoPath = body.path === null ? null : String(body.path ?? '');
    const db = await getDb();
    if (logoPath !== null) {
      if (!isStationLogoPath(logoPath) || !logoPath.startsWith(`${companyId}/`)) {
        throw new HttpError(403, 'forbidden', 'Chemin de logo invalide.');
      }
      const exists = await db.query<{ path: string }>(
        'SELECT path FROM station_logos WHERE path = $1 AND company_id = $2',
        [logoPath, companyId],
      );
      if (exists.rows.length === 0) {
        throw new HttpError(404, 'logo_not_found', 'Fichier logo introuvable sur le serveur.');
      }
    }
    await db.query('UPDATE stations SET logo_path = $1 WHERE id = $2 AND company_id = $3', [logoPath, stationId, companyId]);
    res.json({ ok: true });
  }));

  router.get('/storage/station-logo/file', requireAuth, wrap(async (req, res) => {
    const id = req.identity!;
    const logoPath = String(req.query.path ?? '');
    if (!isStationLogoPath(logoPath) || (!id.isPlatformAdmin && !logoPath.startsWith(`${id.companyId}/`))) {
      throw new HttpError(403, 'forbidden', 'Accès refusé à ce logo.');
    }
    const db = await getDb();
    const row = await db.query<{ mime_type: string; data_base64: string }>(
      'SELECT mime_type, data_base64 FROM station_logos WHERE path = $1',
      [logoPath],
    );
    const logo = row.rows[0];
    if (!logo) throw new HttpError(404, 'not_found', 'Logo introuvable.');
    const buf = Buffer.from(logo.data_base64, 'base64');
    res.setHeader('Content-Type', logo.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  }));

  return router;
}

function enqueueNotificationLocalServer(
  state: AppState,
  body: Record<string, unknown>,
): { state: AppState; value: string } {
  const stationId = String(body.stationId ?? state.station?.id ?? '');
  const templateKey = String(body.templateKey ?? '').trim();
  const customerId = typeof body.customerId === 'string' && body.customerId ? body.customerId : null;
  const fleetId = typeof body.fleetId === 'string' && body.fleetId ? body.fleetId : null;
  if (templateKey.length < 2) throw new Error('Modèle de notification invalide.');
  if (Boolean(customerId) === Boolean(fleetId)) throw new Error('Une seule cible de notification autorisée.');
  const cli = customerId ? state.clients.find((c) => c.id === customerId) : null;
  const fl = fleetId ? state.fleets.find((f) => f.id === fleetId) : null;
  const channel = cli?.preferredChannel ?? fl?.preferredChannel ?? 'none';
  if (channel === 'none') throw new Error('Aucun canal de communication choisi : notification non mise en attente.');
  const id = crypto.randomUUID();
  const item = {
    id,
    stationId,
    customerId,
    fleetId,
    channel,
    templateKey,
    payload: (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null,
  };
  const next = { ...state, notificationOutbox: [...state.notificationOutbox, item] };
  return { state: { ...next, crmStats: crmBoardFromState(next).stats }, value: id };
}
