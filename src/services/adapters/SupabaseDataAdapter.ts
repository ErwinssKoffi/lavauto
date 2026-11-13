import { PaymentCommandError } from '../../lib/paymentAttempt';
import { isDate, validateMoney } from '../../lib/validation';
import type { AppUser, Client, DayHours, PayMethod, Plan, ProfitabilityReport, Wash, WashPost } from '../../types';
import { isStationLogoPath } from '../../lib/image';
import { dbRoleToUi } from '../auth/authTypes';
import { PAY_METHOD_DB_KEY } from '../../types';
import { WashCreationError } from '../../lib/washCreation';
import { normalizeWashes } from '../../lib/washLifecycle';
import { mapClientRows } from '../../lib/catalog';
import { mapFinanceBoard, mapProfitability, type FinanceSnapshot } from '../../lib/finance';
import { mapStationMetrics, type StationMetrics } from '../../lib/stationMetrics';
import { SupabaseFinanceCommands } from './SupabaseFinanceCommands';
import { SupabaseStockCommands } from './SupabaseStockCommands';
import { SupabaseCrmCommands } from './SupabaseCrmCommands';
import { mapStockBoard, type StockSnapshot } from '../../lib/stock';
import { mapCrmBoard, type CrmSnapshot } from '../../lib/crm';
import {
  mapAnalyticsBoard, mapPlatformBoard, mapSubscriptionUsage,
  type AnalyticsSnapshot, type PlatformSnapshot, type SubscriptionUsageSnapshot,
} from '../../lib/analytics';
import { SupabaseAnalyticsCommands } from './SupabaseAnalyticsCommands';
import { SupabaseSubscriptionCommands } from './SupabaseSubscriptionCommands';
import { FEATURE_KEYS, NO_ADVANCED } from '../../lib/subscription';
import type {
  AnalyticsCommands, Bootstrap, CatalogPrice, CatalogSnapshot, DataAdapter, DataSource,
  CompanySetupPatch, CrmCommands, ExpenseCreatePayload, FinanceCommands, SetupCommands, StationSetupPatch,
  StationSetupSnapshot, StockCommands, SubscriptionCommands, WashBoardSnapshot, WashCommands, WashCreatePayload,
} from './DataAdapter';

// ─── Adaptateur Supabase — lectures + RPC cœur lavages (Prompts 03 + 05) ─────
// Les lectures ne filtrent JAMAIS sur le tenant : la RLS restreint les lignes
// à partir de `auth.uid()`. Les écritures du cycle passent uniquement par des
// RPC `SECURITY DEFINER` (migrations 021/022/023) qui déduisent le tenant du JWT,
// vérifient la permission et l'état machine. Aucune écriture directe de table,
// aucune clé service_role, aucun identifiant d'entreprise dans les arguments.
//
// Le client est injecté sous une interface minimale : les tests JSDOM/Node
// peuvent fournir un faux lecteur/RPC sans réseau.

type Row = Record<string, unknown>;

export interface SupabaseResult<T> {
  data: T;
  error: { message: string; code?: string } | null;
  /** PostgREST indique 0 en cas d'échec réseau ; certains faux lecteurs l'omettent. */
  status?: number;
}

export interface SupabaseQuery extends PromiseLike<SupabaseResult<Row[]>> {
  select(columns: string): SupabaseQuery;
  eq(column: string, value: unknown): SupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery;
  limit(count: number): SupabaseQuery;
  maybeSingle(): Promise<SupabaseResult<Row | null>>;
}

export interface SupabaseReader {
  from(table: string): SupabaseQuery;
  auth: {
    getUser(): Promise<SupabaseResult<{ user: { id: string } | null }>>;
  };
  /** RPC serveur : lecture du board ou commande du cycle de lavage. */
  rpc(name: string, args?: Record<string, unknown>): Promise<SupabaseResult<unknown>>;
}

function asRecord(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Ligne ${label} invalide reçue depuis Supabase.`);
  }
  return value as Row;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Champ ${field} absent ou invalide dans la réponse Supabase.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Champ ${field} numérique invalide dans la réponse Supabase.`);
  }
  return parsed;
}

function rows(value: unknown, table: string, resultError: { message: string } | null): Row[] {
  if (resultError) throw new Error(`Lecture ${table} impossible : ${resultError.message}`);
  if (!Array.isArray(value)) throw new Error(`Lecture ${table} : réponse inattendue.`);
  return value.map((row) => asRecord(row, table));
}

function one(value: unknown, table: string, resultError: { message: string } | null): Row | null {
  if (resultError) throw new Error(`Lecture ${table} impossible : ${resultError.message}`);
  return value === null || value === undefined ? null : asRecord(value, table);
}

function features(value: unknown): string[] {
  const list = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
    throw new Error('Formule : liste d’avantages invalide.');
  }
  return list as string[];
}

/** Conversion pure des lignes `plans` + `plan_limits` vers le type UI `Plan`. */
export function mapPlanRows(value: unknown): Plan[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) {
    throw new Error('Aucune formule active lisible dans la base. Aucun tarif local n’est affiché en repli.');
  }
  return list.map((entry) => {
    const row = asRecord(entry, 'plans');
    const currency = text(row.currency_code, 'plans.currency_code');
    if (currency !== 'XOF') {
      throw new Error(`Devise ${currency} non prise en charge par l’interface FCFA.`);
    }
    const limitRows = Array.isArray(row.plan_limits)
      ? row.plan_limits.map((item) => asRecord(item, 'plan_limits'))
      : [];
    const limits: Record<string, number> = {};
    for (const limit of limitRows) {
      limits[text(limit.key, 'plan_limits.key')] = number(limit.value_int, 'plan_limits.value_int');
    }
    const stations = limits.stations;
    const employees = limits.employees;
    const washesPerMonth = limits.washes_per_month;
    if (stations === undefined || employees === undefined || washesPerMonth === undefined) {
      throw new Error(`Limites manquantes pour la formule ${String(row.id ?? '?')}.`);
    }
    if (!Array.isArray(row.plan_entitlements)) throw new Error(`Droits de formule indisponibles pour ${String(row.id ?? '?')}.`);
    const entitlements = { ...NO_ADVANCED };
    const seen = new Set<string>();
    for (const item of row.plan_entitlements) {
      const entitlement = asRecord(item, 'plan_entitlements');
      const key = entitlement.feature_key;
      if (typeof key !== 'string' || !FEATURE_KEYS.includes(key as typeof FEATURE_KEYS[number])
        || typeof entitlement.enabled !== 'boolean' || seen.has(key)) throw new Error('Droit de formule invalide.');
      seen.add(key);
      entitlements[key as typeof FEATURE_KEYS[number]] = entitlement.enabled;
    }
    if (seen.size !== FEATURE_KEYS.length) throw new Error(`Droits de formule incomplets pour ${String(row.id ?? '?')}.`);
    return {
      id: text(row.id, 'plans.id'),
      name: text(row.name, 'plans.name'),
      priceMonthly: number(row.price_monthly_minor, 'plans.price_monthly_minor'),
      trial: number(row.trial_days, 'plans.trial_days') > 0,
      limits: { stations, employees, washesPerMonth },
      features: features(row.features),
      entitlements,
    };
  });
}

/** Conversion pure des trois lectures du catalogue. */
export function mapCatalogRows(
  categoryRows: Row[], serviceRows: Row[], priceRows: Row[]
): CatalogSnapshot {
  return {
    categories: categoryRows.map((r) => ({
      id: text(r.id, 'vehicle_categories.id'),
      stationId: text(r.station_id, 'vehicle_categories.station_id'),
      name: text(r.name, 'vehicle_categories.name'),
      active: r.active !== false,
    })),
    services: serviceRows.map((r) => ({
      id: text(r.id, 'services.id'),
      stationId: text(r.station_id, 'services.station_id'),
      name: text(r.name, 'services.name'),
      description: typeof r.description === 'string' ? r.description : '',
      active: r.active !== false,
    })),
    prices: priceRows.map((r): CatalogPrice => ({
      stationId: text(r.station_id, 'service_prices.station_id'),
      serviceId: text(r.service_id, 'service_prices.service_id'),
      vehicleCategoryId: text(r.vehicle_category_id, 'service_prices.vehicle_category_id'),
      priceMinor: number(r.price_minor, 'service_prices.price_minor'),
      currencyCode: typeof r.currency_code === 'string' ? r.currency_code.trim() : 'XOF',
    })),
  };
}

const SETUP_METHODS: PayMethod[] = ['especes', 'mobile_money', 'wave', 'orange_money', 'mtn_momo', 'carte', 'virement'];

/** Rejette les réponses partielles : ne jamais fabriquer un catalogue serveur. */
export function mapStationSetup(raw: unknown, expectedStation: string): StationSetupSnapshot {
  const setup = asRecord(raw, 'my_station_setup');
  const co = asRecord(setup.company, 'company');
  const st = asRecord(setup.station, 'station');
  const companyId = text(co.id, 'company.id');
  const stationId = text(st.id, 'station.id');
  if (stationId !== expectedStation || st.companyId !== companyId) throw new Error('Station ou entreprise incohérente dans la réponse serveur.');
  if (typeof co.suspended !== 'boolean' || typeof st.activated !== 'boolean'
    || !Array.isArray(st.hours) || !Array.isArray(st.paymentMethods)) throw new Error('Paramètres de station incomplets.');
  const hours: DayHours[] = st.hours.map((value) => {
    const h = asRecord(value, 'station.hours');
    if (typeof h.day !== 'string' || typeof h.open !== 'string' || typeof h.close !== 'string' || typeof h.closed !== 'boolean') {
      throw new Error('Horaires serveur illisibles.');
    }
    return { day: h.day, open: h.open, close: h.close, closed: h.closed };
  });
  if (st.paymentMethods.some((m: unknown) => typeof m !== 'string' || !SETUP_METHODS.includes(m as PayMethod))) {
    throw new Error('Moyens de paiement serveur illisibles.');
  }
  const paymentMethods = st.paymentMethods as PayMethod[];
  if (new Set(paymentMethods).size !== paymentMethods.length
    || typeof st.commissionRate !== 'number' || typeof st.monthlyTarget !== 'number') {
    throw new Error('Règles de station incomplètes.');
  }
  const commissionRate = number(st.commissionRate, 'station.commissionRate');
  const monthlyTarget = number(st.monthlyTarget, 'station.monthlyTarget');
  if (!Number.isSafeInteger(commissionRate) || commissionRate > 100 || !Number.isSafeInteger(monthlyTarget) || monthlyTarget > 1_000_000_000_000) {
    throw new Error('Règles de station hors limites.');
  }
  const categoryRows = rows(setup.categories, 'categories', null);
  const serviceRows = rows(setup.services, 'services', null);
  const priceRows = rows(setup.prices, 'prices', null);
  if (categoryRows.some((row) => typeof row.active !== 'boolean')
    || serviceRows.some((row) => typeof row.active !== 'boolean' || typeof row.description !== 'string')
    || priceRows.some((row) => typeof row.price_minor !== 'number' || !Number.isSafeInteger(row.price_minor)
      || row.price_minor < 0 || row.price_minor > 1_000_000_000_000 || typeof row.currency_code !== 'string')) {
    throw new Error('Catalogue serveur incomplet ou invalide.');
  }
  const catalog = mapCatalogRows(categoryRows, serviceRows, priceRows);
  const categoryIds = new Set(catalog.categories.map((row) => row.id));
  const serviceIds = new Set(catalog.services.map((row) => row.id));
  const priceKeys = new Set(catalog.prices.map((row) => `${row.serviceId}:${row.vehicleCategoryId}`));
  if ([...catalog.categories, ...catalog.services, ...catalog.prices].some((row) => row.stationId !== stationId)
    || categoryIds.size !== catalog.categories.length || serviceIds.size !== catalog.services.length
    || priceKeys.size !== catalog.prices.length || catalog.prices.some((row) => !categoryIds.has(row.vehicleCategoryId) || !serviceIds.has(row.serviceId))) {
    throw new Error('Catalogue hors périmètre ou incohérent dans la réponse serveur.');
  }
  return {
    company: { id: companyId, name: text(co.name, 'company.name'), city: optionalText(co.city), phone: optionalText(co.phone),
      createdAt: text(co.createdAt, 'company.createdAt'), suspended: co.suspended },
    station: { id: stationId, companyId, name: text(st.name, 'station.name'), address: optionalText(st.address),
      city: optionalText(st.city), phone: optionalText(st.phone), currency: 'FCFA',
      logoPath: isStationLogoPath(st.logoPath) && st.logoPath.startsWith(`${companyId}/`) ? st.logoPath : null,
      hours, paymentMethods, cashRequiresOpen: true, maxCashierDiscount: 0, commissionRate, monthlyTarget,
      activated: st.activated, activatedAt: typeof st.activatedAt === 'string' ? st.activatedAt : null },
    catalog,
  };
}

/** Aucun repli local et aucune reprise automatique d'une création incertaine. */
export class SupabaseSetupCommands implements SetupCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async write(name: string, args: Record<string, unknown>): Promise<unknown> {
    let result: SupabaseResult<unknown>;
    try { result = await this.client.rpc(name, args); }
    catch { throw new Error('Résultat incertain : rechargez et vérifiez les données avant de réessayer.'); }
    if (result.error) {
      if (result.status === 0 || (result.status !== undefined && result.status >= 500)) {
        throw new Error('Résultat incertain : rechargez et vérifiez les données avant de réessayer.');
      }
      throw new Error(result.error.message);
    }
    return result.data;
  }

  async read(stationId: string): Promise<StationSetupSnapshot> {
    const result = await this.client.rpc('my_station_setup', { p_station_id: stationId });
    return mapStationSetup(rpcData(result, 'my_station_setup'), stationId);
  }
  async saveCompany(stationId: string, patch: CompanySetupPatch): Promise<void> {
    await this.write('save_company_setup', { p_station_id: stationId, p_patch: patch });
  }
  async saveStation(stationId: string, patch: StationSetupPatch): Promise<void> {
    await this.write('save_station_setup', { p_station_id: stationId, p_patch: patch });
  }
  async saveCategory(stationId: string, id: string | null, name: string, active: boolean, remove = false): Promise<string> {
    return text(await this.write('save_station_category', { p_station_id: stationId, p_id: id, p_name: name, p_active: active, p_remove: remove }), 'category.id');
  }
  async saveService(stationId: string, id: string | null, name: string, description: string, active: boolean, remove = false): Promise<string> {
    return text(await this.write('save_station_service', { p_station_id: stationId, p_id: id, p_name: name, p_description: description, p_active: active, p_remove: remove }), 'service.id');
  }
  async savePrice(stationId: string, serviceId: string, categoryId: string, price: number): Promise<void> {
    await this.write('save_station_price', { p_station_id: stationId, p_service_id: serviceId, p_category_id: categoryId, p_price_minor: price });
  }
  async activate(stationId: string): Promise<void> {
    await this.write('activate_station_setup', { p_station_id: stationId });
  }
}

function rpcData(result: SupabaseResult<unknown>, name: string): unknown {
  if (result.error) throw new Error(`RPC ${name} : ${result.error.message}`);
  return result.data;
}

/** Projection pure des JSONB serveur vers les types du domaine UI. */
export function mapWashBoard(board: unknown, posts: unknown): WashBoardSnapshot {
  const postRows = Array.isArray(posts) ? posts : [];
  const mappedPosts: WashPost[] = postRows.map((entry) => {
    const p = asRecord(entry, 'my_wash_posts');
    return {
      id: text(p.id, 'my_wash_posts.id'),
      stationId: optionalText(p.stationId),
      name: text(p.name, 'my_wash_posts.name'),
      capacity: number(p.capacity, 'my_wash_posts.capacity'),
      active: p.active !== false,
    };
  });
  return { washes: normalizeWashes(Array.isArray(board) ? board : []), posts: mappedPosts };
}

/**
 * Commandes du cycle de lavage. Chaque appel est un RPC `SECURITY DEFINER` :
 * aucun identifiant de tenant, aucune insertion directe, idempotence par clé UI.
 */
export class SupabaseWashCommands implements WashCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return rpcData(await this.client.rpc(name, args), name);
  }

  async createWash(p: WashCreatePayload): Promise<string> {
    // Une seule RPC : si le paiement est refusé, toute la transaction est
    // annulée. Ne jamais revenir aux deux anciennes RPC si 052 manque.
    let result: SupabaseResult<unknown>;
    try {
      result = await this.client.rpc('create_wash_atomic', {
        p_payload: {
          station_id: p.stationId,
          category_id: p.categoryId,
          plate: p.plate,
          customer_id: p.clientId,
          customer_name: p.clientName,
          discount_minor: p.discount,
          items: p.items.map((i) => ({ serviceId: i.serviceId, qty: i.qty })),
          employee_ids: p.employeeIds,
          post_id: p.postId,
          idempotency_key: p.idempotencyKey,
          initial_payment: p.payment && p.payment.amount > 0
            ? { amount_minor: p.payment.amount, method_key: PAY_METHOD_DB_KEY[p.payment.method] }
            : null,
        },
      });
    } catch (error) {
      throw new WashCreationError(`Résultat de la création incertain : ${error instanceof Error ? error.message : 'réponse réseau absente'}`, 'unknown');
    }
    if (result.error) {
      const status = result.status;
      // Une 4xx explicite (sauf timeout/throttling) ou une erreur SQL typée
      // sans statut est un refus ; 0, 5xx et réponse réseau sont incertains.
      // Une collision de clé peut désigner une ancienne fiche déjà créée :
      // conserver la tentative pour vérification, même si HTTP vaut 409.
      const rejected = result.error.code !== '23505' && (status !== undefined
        ? status >= 400 && status < 500 && status !== 408 && status !== 429
        : Boolean(result.error.code && /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(result.error.code)));
      const message = result.error.code === 'PGRST202'
        ? 'Commande de création atomique indisponible : appliquez la migration 052 avant ce frontend.'
        : `RPC create_wash_atomic : ${result.error.message}`;
      throw new WashCreationError(message, rejected ? 'rejected' : 'unknown');
    }
    if (typeof result.data !== 'string' || !result.data.trim()) {
      throw new WashCreationError('Résultat de la création incertain : identifiant serveur absent.', 'unknown');
    }
    return result.data;
  }

  async transitionStatus(id: string, to: string, reason = ''): Promise<void> {
    await this.call('transition_wash_status', { p_wash_id: id, p_to_status: to, p_reason: reason });
  }

  async assign(id: string, userIds: string[], postId: string | null): Promise<void> {
    await this.call('assign_wash', { p_wash_id: id, p_user_ids: userIds, p_post_id: postId });
  }

  async qualityCheck(id: string, result: string, notes: string): Promise<void> {
    await this.call('record_wash_quality_check', { p_wash_id: id, p_result: result, p_notes: notes });
  }

  async addPayment(id: string, amount: number, method: keyof typeof PAY_METHOD_DB_KEY, key: string): Promise<void> {
    validateMoney(amount, true);
    if (!PAY_METHOD_DB_KEY[method]) throw new Error('Moyen de paiement invalide.');
    let result: SupabaseResult<unknown>;
    try {
      result = await this.client.rpc('record_wash_payment_by_key', {
        p_wash_id: id, p_amount_minor: amount, p_method_key: PAY_METHOD_DB_KEY[method],
        p_reference: '', p_idempotency_key: key,
      });
    } catch (error) {
      throw new PaymentCommandError(`Résultat du paiement incertain : ${error instanceof Error ? error.message : 'réponse réseau absente'}`, 'unknown');
    }
    if (result.error) {
      const status = result.status;
      const rejected = result.error.code !== '23505' && (status !== undefined
        ? status >= 400 && status < 500 && status !== 408 && status !== 429
        : Boolean(result.error.code && /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(result.error.code)));
      throw new PaymentCommandError(`Paiement : ${result.error.message}`, rejected ? 'rejected' : 'unknown');
    }
    if (typeof result.data !== 'string' || !result.data.trim()) {
      throw new PaymentCommandError('Résultat du paiement incertain : identifiant serveur absent.', 'unknown');
    }
  }

  async createPost(name: string, capacity: number, stationId?: string | null): Promise<void> {
    await this.call('create_wash_post', {
      p_name: name, p_capacity: capacity, p_station_id: stationId ?? null,
    });
  }

  async vehicleHistory(plate: string, stationId?: string): Promise<Wash[]> {
    const data = stationId
      ? await this.call('my_station_wash_board', { p_station_id: stationId, p_plate: plate })
      : await this.call('my_vehicle_history', { p_plate: plate });
    return normalizeWashes(Array.isArray(data) ? data : []);
  }
}

export class SupabaseDataAdapter implements DataAdapter {
  readonly source: DataSource = 'supabase';
  readonly setupCommands: SetupCommands;
  readonly subscriptionCommands: SubscriptionCommands;
  readonly washCommands: WashCommands;
  readonly financeCommands: FinanceCommands;
  readonly stockCommands: StockCommands;
  readonly crmCommands: CrmCommands;
  readonly analyticsCommands: AnalyticsCommands;

  constructor(private readonly client: SupabaseReader) {
    this.setupCommands = new SupabaseSetupCommands(client);
    this.subscriptionCommands = new SupabaseSubscriptionCommands(client);
    this.washCommands = new SupabaseWashCommands(client);
    this.financeCommands = new SupabaseFinanceCommands(client);
    this.stockCommands = new SupabaseStockCommands(client);
    this.crmCommands = new SupabaseCrmCommands(client);
    this.analyticsCommands = new SupabaseAnalyticsCommands(client);
  }

  async listAnalyticsBoard(
    start: string, end: string, compareStart: string | null, compareEnd: string | null,
  ): Promise<AnalyticsSnapshot> {
    const { data, error } = await this.client.rpc('my_accessible_analytics_board', {
      p_start: start, p_end: end,
      p_compare_start: compareStart, p_compare_end: compareEnd,
    });
    if (error) throw new Error(error.message);
    return mapAnalyticsBoard(data);
  }

  async listSubscriptionUsage(periodStart: string): Promise<SubscriptionUsageSnapshot> {
    const { data, error } = await this.client.rpc('my_subscription_usage', {
      p_period_start: periodStart,
    });
    if (error) throw new Error(error.message);
    return mapSubscriptionUsage(data);
  }

  async listPlatformBoard(): Promise<PlatformSnapshot> {
    const { data, error } = await this.client.rpc('my_platform_board');
    if (error) throw new Error(error.message);
    return mapPlatformBoard(data);
  }

  async listCrmBoard(stationId?: string): Promise<CrmSnapshot> {
    const { data, error } = await this.client.rpc(stationId ? 'my_station_crm_board' : 'my_crm_board',
      stationId ? { p_station_id: stationId } : undefined);
    if (error) throw new Error(error.message);
    return mapCrmBoard(data);
  }

  async listStockBoard(stationId?: string): Promise<StockSnapshot> {
    const { data, error } = await this.client.rpc(stationId ? 'my_station_stock_board' : 'my_stock_board',
      stationId ? { p_station_id: stationId } : undefined);
    if (error) throw new Error(error.message);
    return mapStockBoard(data);
  }

  async listFinanceBoard(stationId?: string): Promise<FinanceSnapshot> {
    const { data, error } = await this.client.rpc(stationId ? 'my_station_finance_board' : 'my_finance_board',
      stationId ? { p_station_id: stationId } : undefined);
    if (error) throw new Error(error.message);
    if (stationId) {
      // Le mapping historique remplace certains champs absents par des valeurs
      // par défaut. Ne jamais utiliser ces substitutions pour confirmer une
      // dépense : valider les champs bruts avant toute projection.
      const raw = asRecord(data, 'my_station_finance_board');
      if (!Array.isArray(raw.expenses)) throw new Error('Liste des dépenses invalide.');
      for (const value of raw.expenses) {
        const e = asRecord(value, 'dépense');
        if (typeof e.id !== 'string' || !e.id.trim() || e.stationId !== stationId
          || typeof e.amount !== 'number' || !Number.isSafeInteger(e.amount) || e.amount <= 0
          || typeof e.category !== 'string' || !e.category.trim() || typeof e.reason !== 'string' || !e.reason.trim()
          || typeof e.supplier !== 'string' || typeof e.date !== 'string' || !isDate(e.date)
          || typeof e.method !== 'string' || !Object.prototype.hasOwnProperty.call(PAY_METHOD_DB_KEY, e.method)
          || (e.status !== 'enregistree' && e.status !== 'annulee')
          || (e.idempotencyKey !== null && (typeof e.idempotencyKey !== 'string' || !e.idempotencyKey.trim()))) {
          throw new Error('Dépense invalide reçue dans la lecture finance.');
        }
      }
    }
    return mapFinanceBoard(data);
  }

  async listProfitability(start: string, end: string, stationId?: string): Promise<ProfitabilityReport> {
    const { data, error } = await this.client.rpc(stationId ? 'my_station_profitability' : 'my_profitability', {
      p_start: start, p_end: end, ...(stationId ? { p_station_id: stationId } : {}),
    });
    if (error) throw new Error(error.message);
    if (stationId && (!data || typeof data !== 'object' || (data as Record<string, unknown>).stationId !== stationId)) {
      throw new Error('Rapport reçu pour une autre station.');
    }
    const result = mapProfitability(data);
    if (stationId && (result.periodStart !== start || result.periodEnd !== end)) throw new Error('Période du rapport incorrecte.');
    return result;
  }

  async listStationMetrics(stationId: string, start: string, end: string): Promise<StationMetrics> {
    const { data, error } = await this.client.rpc('my_station_metrics', {
      p_station_id: stationId, p_start: start, p_end: end,
    });
    if (error) throw new Error(error.message);
    return mapStationMetrics(data, stationId, start, end);
  }

  async listClients(stationId?: string): Promise<Client[]> {
    const name = stationId ? 'my_station_clients' : 'my_company_clients';
    const result = await this.client.rpc(name, stationId ? { p_station_id: stationId } : undefined);
    const data = rpcData(result, name);
    return mapClientRows(Array.isArray(data) ? data : []);
  }

  async listAssignableUsers(stationId: string): Promise<AppUser[]> {
    const data = rpcData(await this.client.rpc('my_station_assignable_users', { p_station_id: stationId }), 'my_station_assignable_users');
    if (!Array.isArray(data)) throw new Error('Liste des employés affectables invalide.');
    return data.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
        throw new Error('Employé affectable invalide.');
      }
      return {
        id: entry.id, name: entry.name, role: dbRoleToUi(entry.roleKey),
        companyId: null, stationId, stationIds: [stationId],
        email: '', phone: '', active: true, commissionRateOverride: null, createdAt: '',
      };
    });
  }

  async listWashBoard(stationId?: string): Promise<WashBoardSnapshot> {
    const boardName = stationId ? 'my_station_wash_board' : 'my_wash_board';
    const postsName = stationId ? 'my_station_wash_posts' : 'my_wash_posts';
    const args = stationId ? { p_station_id: stationId } : undefined;
    const [boardResult, postsResult] = await Promise.all([
      this.client.rpc(boardName, args), this.client.rpc(postsName, args),
    ]);
    return mapWashBoard(rpcData(boardResult, boardName), rpcData(postsResult, postsName));
  }

  async listPlans(): Promise<Plan[]> {
    const result = await this.client.from('plans')
      .select('id,name,price_monthly_minor,currency_code,trial_days,features,sort_order,plan_limits(key,value_int),plan_entitlements(feature_key,enabled)')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    return mapPlanRows(rows(result.data, 'plans', result.error));
  }

  async getBootstrap(): Promise<Bootstrap | null> {
    const auth = await this.client.auth.getUser();
    if (auth.error) throw new Error(`Session illisible : ${auth.error.message}`);
    if (!auth.data.user) return null; // pas de session : aucun contexte, aucune fuite

    const userId = auth.data.user.id;
    const profileResult = await this.client.from('user_profiles')
      .select('id,full_name,email,active,role_id')
      .eq('id', userId)
      .maybeSingle();
    const profile = one(profileResult.data, 'user_profiles', profileResult.error);
    if (!profile) return null;
    const roleId = text(profile.role_id, 'user_profiles.role_id');

    // Aucun filtre de tenant : la RLS ne renvoie que l'entreprise du JWT.
    const [companyResult, stationResult, assignmentResult, roleResult, permissionResult] = await Promise.all([
      this.client.from('companies')
        .select('id,name,city,phone,currency_code,suspended').limit(2),
      this.client.from('stations')
        .select('id,name,city,activated').limit(200),
      this.client.from('user_station_assignments')
        .select('station_id').eq('user_id', userId).limit(200),
      this.client.from('roles')
        .select('key').eq('id', roleId).maybeSingle(),
      this.client.from('role_permissions')
        .select('permission_id').eq('role_id', roleId).limit(200),
    ]);

    const companyRows = rows(companyResult.data, 'companies', companyResult.error);
    if (companyRows.length !== 1) {
      throw new Error('Contexte entreprise ambigu ou absent : la RLS doit en renvoyer exactement une.');
    }
    const c = companyRows[0];
    const stationRows = rows(stationResult.data, 'stations', stationResult.error);
    const assignmentRows = rows(assignmentResult.data, 'user_station_assignments', assignmentResult.error);
    const role = one(roleResult.data, 'roles', roleResult.error);
    const permissionRows = rows(permissionResult.data, 'role_permissions', permissionResult.error);

    return {
      userId,
      fullName: text(profile.full_name, 'user_profiles.full_name'),
      email: optionalText(profile.email),
      active: profile.active !== false,
      roleKey: role ? text(role.key, 'roles.key') : '',
      permissions: permissionRows.map((p) => text(p.permission_id, 'role_permissions.permission_id')),
      company: {
        id: text(c.id, 'companies.id'),
        name: text(c.name, 'companies.name'),
        city: typeof c.city === 'string' ? c.city : '',
        phone: typeof c.phone === 'string' ? c.phone : '',
        currencyCode: text(c.currency_code, 'companies.currency_code'),
        suspended: c.suspended === true,
      },
      stations: stationRows.map((s) => ({
        id: text(s.id, 'stations.id'),
        name: text(s.name, 'stations.name'),
        city: typeof s.city === 'string' ? s.city : '',
        activated: s.activated === true,
      })),
      stationIds: assignmentRows.map((a) => text(a.station_id, 'user_station_assignments.station_id')),
    };
  }

  async listCatalog(stationId?: string): Promise<CatalogSnapshot> {
    let categories = this.client.from('vehicle_categories')
      .select('id,station_id,name,active,sort_order').eq('active', true);
    let services = this.client.from('services')
      .select('id,station_id,name,description,active,sort_order').eq('active', true);
    let prices = this.client.from('service_prices')
      .select('station_id,service_id,vehicle_category_id,price_minor,currency_code');
    // La limite doit s'appliquer après le filtre, sinon une autre station peut
    // occuper toute la page. La RLS reste l'autorité pour l'accès.
    if (stationId) {
      categories = categories.eq('station_id', stationId);
      services = services.eq('station_id', stationId);
      prices = prices.eq('station_id', stationId);
    }
    const [categoryResult, serviceResult, priceResult] = await Promise.all([
      categories.order('sort_order', { ascending: true }).limit(500),
      services.order('sort_order', { ascending: true }).limit(500), prices.limit(5000),
    ]);
    const mapped = mapCatalogRows(
      rows(categoryResult.data, 'vehicle_categories', categoryResult.error),
      rows(serviceResult.data, 'services', serviceResult.error),
      rows(priceResult.data, 'service_prices', priceResult.error)
    );
    return stationId ? {
      categories: mapped.categories.filter((row) => row.stationId === stationId),
      services: mapped.services.filter((row) => row.stationId === stationId),
      prices: mapped.prices.filter((row) => row.stationId === stationId),
    } : mapped;
  }
}
