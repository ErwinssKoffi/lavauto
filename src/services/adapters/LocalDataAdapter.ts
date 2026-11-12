import type { AppState, Client, Plan, ProfitabilityReport } from '../../types';
import { clonePlans } from '../../lib/plans';
import { withStockDefaults } from '../../lib/stock';
import { buildProfitability, financeSnapshotFromState, type FinanceSnapshot } from '../../lib/finance';
import { stockBoardFromState, type StockSnapshot } from '../../lib/stock';
import { crmBoardFromState, type CrmSnapshot } from '../../lib/crm';
import {
  analyticsBoardFromState, mapAnalyticsBoard, mapPlatformBoard,
  mapSubscriptionUsage, platformBoardFromState, subscriptionUsageFromState,
  type AnalyticsSnapshot, type PlatformSnapshot, type SubscriptionUsageSnapshot,
} from '../../lib/analytics';
import { getPlans } from '../../lib/plans';
import type {
  Bootstrap, CatalogPrice, CatalogSnapshot, DataAdapter, DataSource, WashBoardSnapshot,
} from './DataAdapter';

// ─── Adaptateur local ────────────────────────────────────────────────────────
// Enveloppe en LECTURE SEULE l'état existant de `store.tsx`. Aucune action,
// aucune règle métier et aucune clé de stockage ne sont déplacées ou supprimées :
// c'est le « strangler fig » décrit dans docs/architecture-target.md.
//
// Le RBAC n'existe pas encore côté local : `permissions` reste vide jusqu'au
// Prompt 04. C'est un constat explicite, pas une permission accordée.

const ROLE_KEYS: Record<string, string> = {
  proprietaire: 'owner',
  gerant: 'manager',
  caissier: 'cashier',
  support: 'super_admin',
};

export class LocalDataAdapter implements DataAdapter {
  readonly source: DataSource = 'local';
  /** Aucune RPC : les mutations locales restent synchrones dans `store.tsx`. */
  readonly washCommands = null;
  readonly financeCommands = null;
  readonly stockCommands = null;
  readonly crmCommands = null;
  readonly analyticsCommands = null;

  constructor(private readonly getState: () => AppState) {}

  async listPlans(): Promise<Plan[]> {
    return clonePlans();
  }

  async getBootstrap(): Promise<Bootstrap | null> {
    const state = this.getState();
    if (!state.session || !state.company || !state.station) return null;
    return {
      userId: state.session.userId,
      fullName: state.session.name,
      email: state.session.email,
      active: true,
      roleKey: ROLE_KEYS[state.session.role] ?? state.session.role,
      permissions: [],
      company: {
        id: state.company.id,
        name: state.company.name,
        city: state.company.city,
        phone: state.company.phone,
        currencyCode: 'XOF',
        suspended: state.company.suspended,
      },
      stations: [{
        id: state.station.id,
        name: state.station.name,
        city: state.station.city,
        activated: state.station.activated,
      }],
      stationIds: [state.station.id],
    };
  }

  async listFinanceBoard(): Promise<FinanceSnapshot> {
    return financeSnapshotFromState(this.getState());
  }

  async listProfitability(start: string, end: string): Promise<ProfitabilityReport> {
    return buildProfitability(withStockDefaults(this.getState()), new Date(start + 'T00:00:00'), new Date(end + 'T23:59:59'));
  }

  async listStockBoard(): Promise<StockSnapshot> {
    return stockBoardFromState(this.getState());
  }

  async listCrmBoard(): Promise<CrmSnapshot> {
    return crmBoardFromState(this.getState());
  }

  async listAnalyticsBoard(
    start: string, end: string, compareStart: string | null, compareEnd: string | null,
  ): Promise<AnalyticsSnapshot> {
    // Le mapping reste exercé en mode local : la projection serveur et la
    // projection locale doivent garder exactement la même forme de contrat.
    return mapAnalyticsBoard(analyticsBoardFromState(this.getState(), start, end, compareStart, compareEnd));
  }

  async listSubscriptionUsage(periodStart: string): Promise<SubscriptionUsageSnapshot> {
    return mapSubscriptionUsage(subscriptionUsageFromState(this.getState(), periodStart));
  }

  async listPlatformBoard(): Promise<PlatformSnapshot> {
    return mapPlatformBoard(platformBoardFromState(this.getState(), getPlans()));
  }

  async listClients(): Promise<Client[]> {
    return this.getState().clients ?? [];
  }

  async listWashBoard(): Promise<WashBoardSnapshot> {
    const state = this.getState();
    return { washes: state.washes ?? [], posts: state.washPosts ?? [] };
  }

  async listCatalog(): Promise<CatalogSnapshot> {
    const state = this.getState();
    const stationId = state.station?.id ?? '';
    const prices: CatalogPrice[] = state.services.flatMap((service) =>
      Object.entries(service.prices).map(([vehicleCategoryId, priceMinor]) => ({
        stationId: service.stationId,
        serviceId: service.id,
        vehicleCategoryId,
        priceMinor,
        currencyCode: 'XOF',
      }))
    );
    return {
      categories: state.vehicleCategories.map((c) => ({
        id: c.id, stationId: c.stationId, name: c.name, active: c.active,
      })),
      services: state.services.map((s) => ({
        id: s.id, stationId: s.stationId, name: s.name,
        description: s.description, active: s.active,
      })),
      prices: prices.filter((p) => p.stationId === stationId || !stationId),
    };
  }
}
