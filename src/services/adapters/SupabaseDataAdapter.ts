import type { Client, Plan, ProfitabilityReport, Wash, WashPost } from '../../types';
import { PAY_METHOD_DB_KEY } from '../../types';
import { normalizeWashes } from '../../lib/washLifecycle';
import { mapClientRows } from '../../lib/catalog';
import { mapFinanceBoard, mapProfitability, type FinanceSnapshot } from '../../lib/finance';
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
import type {
  AnalyticsCommands, Bootstrap, CatalogPrice, CatalogSnapshot, DataAdapter, DataSource,
  CrmCommands, ExpenseCreatePayload, FinanceCommands, StockCommands,
  WashBoardSnapshot, WashCommands, WashCreatePayload,
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
  error: { message: string } | null;
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
    return {
      id: text(row.id, 'plans.id'),
      name: text(row.name, 'plans.name'),
      priceMonthly: number(row.price_monthly_minor, 'plans.price_monthly_minor'),
      trial: number(row.trial_days, 'plans.trial_days') > 0,
      limits: { stations, employees, washesPerMonth },
      features: features(row.features),
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
    const id = await this.call('create_wash_full', {
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
      },
    });
    const washId = typeof id === 'string' ? id : '';
    if (p.payment && p.payment.amount > 0 && washId) {
      await this.addPayment(washId, p.payment.amount, p.payment.method, `pay:${p.idempotencyKey}`);
    }
    return washId;
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
    await this.call('record_wash_payment_by_key', {
      p_wash_id: id, p_amount_minor: amount, p_method_key: PAY_METHOD_DB_KEY[method],
      p_reference: '', p_idempotency_key: key,
    });
  }

  async createPost(name: string, capacity: number, stationId?: string | null): Promise<void> {
    await this.call('create_wash_post', {
      p_name: name, p_capacity: capacity, p_station_id: stationId ?? null,
    });
  }

  async vehicleHistory(plate: string): Promise<Wash[]> {
    const data = await this.call('my_vehicle_history', { p_plate: plate });
    return normalizeWashes(Array.isArray(data) ? data : []);
  }
}

export class SupabaseDataAdapter implements DataAdapter {
  readonly source: DataSource = 'supabase';
  readonly washCommands: WashCommands;
  readonly financeCommands: FinanceCommands;
  readonly stockCommands: StockCommands;
  readonly crmCommands: CrmCommands;
  readonly analyticsCommands: AnalyticsCommands;

  constructor(private readonly client: SupabaseReader) {
    this.washCommands = new SupabaseWashCommands(client);
    this.financeCommands = new SupabaseFinanceCommands(client);
    this.stockCommands = new SupabaseStockCommands(client);
    this.crmCommands = new SupabaseCrmCommands(client);
    this.analyticsCommands = new SupabaseAnalyticsCommands(client);
  }

  async listAnalyticsBoard(
    start: string, end: string, compareStart: string | null, compareEnd: string | null,
  ): Promise<AnalyticsSnapshot> {
    const { data, error } = await this.client.rpc('my_analytics_board', {
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

  async listCrmBoard(): Promise<CrmSnapshot> {
    const { data, error } = await this.client.rpc('my_crm_board');
    if (error) throw new Error(error.message);
    return mapCrmBoard(data);
  }

  async listStockBoard(): Promise<StockSnapshot> {
    const { data, error } = await this.client.rpc('my_stock_board');
    if (error) throw new Error(error.message);
    return mapStockBoard(data);
  }

  async listFinanceBoard(): Promise<FinanceSnapshot> {
    const { data, error } = await this.client.rpc('my_finance_board');
    if (error) throw new Error(error.message);
    return mapFinanceBoard(data);
  }

  async listProfitability(start: string, end: string): Promise<ProfitabilityReport> {
    const { data, error } = await this.client.rpc('my_profitability', {
      p_start: start, p_end: end,
    });
    if (error) throw new Error(error.message);
    return mapProfitability(data);
  }

  async listClients(): Promise<Client[]> {
    const result = await this.client.rpc('my_company_clients');
    const data = rpcData(result, 'my_company_clients');
    return mapClientRows(Array.isArray(data) ? data : []);
  }

  async listWashBoard(): Promise<WashBoardSnapshot> {
    const [boardResult, postsResult] = await Promise.all([
      this.client.rpc('my_wash_board'),
      this.client.rpc('my_wash_posts'),
    ]);
    return mapWashBoard(rpcData(boardResult, 'my_wash_board'), rpcData(postsResult, 'my_wash_posts'));
  }

  async listPlans(): Promise<Plan[]> {
    const result = await this.client.from('plans')
      .select('id,name,price_monthly_minor,currency_code,trial_days,features,sort_order,plan_limits(key,value_int)')
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

  async listCatalog(): Promise<CatalogSnapshot> {
    const [categoryResult, serviceResult, priceResult] = await Promise.all([
      this.client.from('vehicle_categories')
        .select('id,station_id,name,active,sort_order')
        .eq('active', true).order('sort_order', { ascending: true }).limit(500),
      this.client.from('services')
        .select('id,station_id,name,description,active,sort_order')
        .eq('active', true).order('sort_order', { ascending: true }).limit(500),
      this.client.from('service_prices')
        .select('station_id,service_id,vehicle_category_id,price_minor,currency_code')
        .limit(5000),
    ]);
    return mapCatalogRows(
      rows(categoryResult.data, 'vehicle_categories', categoryResult.error),
      rows(serviceResult.data, 'services', serviceResult.error),
      rows(priceResult.data, 'service_prices', priceResult.error)
    );
  }
}
