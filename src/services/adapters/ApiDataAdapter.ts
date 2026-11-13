import type {
  AppUser, Client, PayMethod, Plan, ProfitabilityReport, Wash, WashQualityResult, WashStatus,
} from '../../types';
import { setPlansCache } from '../../lib/plans';
import type { StationMetrics } from '../../lib/stationMetrics';
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
import { mapSubscriptionAccess, type SubscriptionAccess, type SubscriptionRequest } from '../../lib/subscription';
import { ExpenseCommandError } from '../../lib/expenseAttempt';
import { PaymentCommandError } from '../../lib/paymentAttempt';
import { WashCreationError } from '../../lib/washCreation';
import { apiFetch, HttpClientError } from '../api/apiClient';
import type {
  AnalyticsCommands, Bootstrap, CatalogSnapshot, CompanySetupPatch,
  CompanySubscriptionPayload, CompanySuspensionPayload, CrmCommands, DataAdapter,
  ExpenseCreatePayload, FinanceCommands, PlanLimitPayload, PlanPayload,
  SetupCommands, StationSetupPatch, StationSetupSnapshot, StockCommands,
  SubscriptionCommands, WashBoardSnapshot, WashCommands, WashCreatePayload,
} from './DataAdapter';

function qs(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export class ApiDataAdapter implements DataAdapter {
  readonly source = 'api' as const;

  readonly setupCommands: SetupCommands = {
    read: (stationId) => apiFetch<StationSetupSnapshot>(`/api/setup/${encodeURIComponent(stationId)}`),
    saveCompany: async (stationId, patch: CompanySetupPatch) => {
      await apiFetch(`/api/setup/${encodeURIComponent(stationId)}/company`, {
        method: 'POST',
        body: JSON.stringify(patch),
      });
    },
    saveStation: async (stationId, patch: StationSetupPatch) => {
      await apiFetch(`/api/setup/${encodeURIComponent(stationId)}/station`, {
        method: 'POST',
        body: JSON.stringify(patch),
      });
    },
    saveCategory: async (stationId, id, name, active, remove) => {
      const r = await apiFetch<{ id: string }>(`/api/setup/${encodeURIComponent(stationId)}/category`, {
        method: 'POST',
        body: JSON.stringify({ id, name, active, remove }),
      });
      return r.id;
    },
    saveService: async (stationId, id, name, description, active, remove) => {
      const r = await apiFetch<{ id: string }>(`/api/setup/${encodeURIComponent(stationId)}/service`, {
        method: 'POST',
        body: JSON.stringify({ id, name, description, active, remove }),
      });
      return r.id;
    },
    savePrice: async (stationId, serviceId, categoryId, price) => {
      await apiFetch(`/api/setup/${encodeURIComponent(stationId)}/price`, {
        method: 'POST',
        body: JSON.stringify({ serviceId, categoryId, price }),
      });
    },
    activate: async (stationId) => {
      await apiFetch(`/api/setup/${encodeURIComponent(stationId)}/activate`, {
        method: 'POST',
      });
    },
  };

  readonly subscriptionCommands: SubscriptionCommands = {
    read: async (companyId: string): Promise<SubscriptionAccess> => {
      const raw = await apiFetch<unknown>('/api/subscription');
      return mapSubscriptionAccess(raw, companyId);
    },
    request: async (planId: string): Promise<string> => {
      const r = await apiFetch<{ id: string }>('/api/subscription/request', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      return r.id;
    },
    listRequests: async (): Promise<SubscriptionRequest[]> => {
      const r = await apiFetch<{ requests: SubscriptionRequest[] }>('/api/subscription/requests');
      return r.requests;
    },
    decide: async (requestId: string, approve: boolean): Promise<void> => {
      await apiFetch(`/api/subscription/requests/${encodeURIComponent(requestId)}/decide`, {
        method: 'POST',
        body: JSON.stringify({ approve }),
      });
    },
  };

  readonly washCommands: WashCommands = {
    createWash: async (p: WashCreatePayload): Promise<string> => {
      try {
        const r = await apiFetch<{ id: string }>('/api/washes/create', {
          method: 'POST',
          body: JSON.stringify(p),
        });
        return r.id;
      } catch (err) {
        if (err instanceof HttpClientError) {
          throw new WashCreationError(err.message, err.outcome);
        }
        throw new WashCreationError(err instanceof Error ? err.message : 'Erreur réseau', 'unknown');
      }
    },
    transitionStatus: async (id: string, to: WashStatus, reason?: string): Promise<void> => {
      await apiFetch(`/api/washes/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ to, reason }),
      });
    },
    assign: async (id: string, userIds: string[], postId: string | null): Promise<void> => {
      await apiFetch(`/api/washes/${encodeURIComponent(id)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ userIds, postId }),
      });
    },
    qualityCheck: async (id: string, result: WashQualityResult, notes: string): Promise<void> => {
      await apiFetch(`/api/washes/${encodeURIComponent(id)}/quality`, {
        method: 'POST',
        body: JSON.stringify({ result, notes }),
      });
    },
    addPayment: async (id: string, amount: number, method: PayMethod, idempotencyKey: string): Promise<void> => {
      try {
        await apiFetch(`/api/washes/${encodeURIComponent(id)}/payment`, {
          method: 'POST',
          body: JSON.stringify({ amount, method, idempotencyKey }),
        });
      } catch (err) {
        if (err instanceof HttpClientError) {
          throw new PaymentCommandError(err.message, err.outcome);
        }
        throw new PaymentCommandError(err instanceof Error ? err.message : 'Erreur réseau', 'unknown');
      }
    },
    createPost: async (name: string, capacity: number, stationId?: string | null): Promise<void> => {
      await apiFetch('/api/washes/posts', {
        method: 'POST',
        body: JSON.stringify({ name, capacity, stationId }),
      });
    },
    vehicleHistory: async (plate: string, stationId?: string): Promise<Wash[]> => {
      const r = await apiFetch<{ washes: Wash[] }>(`/api/washes/history${qs({ plate, stationId })}`);
      return r.washes;
    },
  };

  readonly financeCommands: FinanceCommands = {
    openCash: async (stationId: string, openingFloat: number): Promise<string> => {
      const r = await apiFetch<{ id: string }>('/api/finance/open-cash', {
        method: 'POST',
        body: JSON.stringify({ stationId, openingFloat }),
      });
      return r.id ?? '';
    },
    closeCash: async (sessionId: string, counted: number): Promise<void> => {
      await apiFetch('/api/finance/close-cash', {
        method: 'POST',
        body: JSON.stringify({ sessionId, counted }),
      });
    },
    reopenCash: async (sessionId: string, reason: string): Promise<void> => {
      await apiFetch('/api/finance/reopen-cash', {
        method: 'POST',
        body: JSON.stringify({ sessionId, reason }),
      });
    },
    addExpense: async (p: ExpenseCreatePayload): Promise<string> => {
      try {
        const r = await apiFetch<{ id: string }>('/api/finance/expense', {
          method: 'POST',
          body: JSON.stringify(p),
        });
        return r.id ?? '';
      } catch (err) {
        if (err instanceof HttpClientError) {
          throw new ExpenseCommandError(err.message, err.outcome);
        }
        throw new ExpenseCommandError(err instanceof Error ? err.message : 'Erreur réseau', 'unknown');
      }
    },
    cancelExpense: async (id: string, reason: string): Promise<void> => {
      await apiFetch('/api/finance/cancel-expense', {
        method: 'POST',
        body: JSON.stringify({ id, reason }),
      });
    },
    cancelPayment: async (paymentId: string, reason: string): Promise<void> => {
      await apiFetch('/api/finance/cancel-payment', {
        method: 'POST',
        body: JSON.stringify({ paymentId, reason }),
      });
    },
    reconcileChannel: async (methodId: string, start: string, end: string, counted: number): Promise<void> => {
      await apiFetch('/api/finance/reconcile', {
        method: 'POST',
        body: JSON.stringify({ methodId, start, end, counted }),
      });
    },
    createCommissionPeriod: async (stationId: string, start: string, end: string): Promise<string> => {
      const r = await apiFetch<{ id: string }>('/api/finance/commission-period', {
        method: 'POST',
        body: JSON.stringify({ stationId, start, end }),
      });
      return r.id ?? '';
    },
    validateCommissionPeriod: async (periodId: string): Promise<void> => {
      await apiFetch('/api/finance/commission-validate', {
        method: 'POST',
        body: JSON.stringify({ periodId }),
      });
    },
    recordCommissionPayout: async (periodId: string, userId: string, amount: number, reference: string): Promise<void> => {
      await apiFetch('/api/finance/commission-payout', {
        method: 'POST',
        body: JSON.stringify({ periodId, userId, amount, reference }),
      });
    },
  };

  readonly stockCommands: StockCommands = {
    saveSupplier: async (p: SupplierPayload) => (await apiFetch<{ id: string }>('/api/stock/supplier', { method: 'POST', body: JSON.stringify(p) })).id,
    saveProduct: async (p: ProductPayload) => (await apiFetch<{ id: string }>('/api/stock/product', { method: 'POST', body: JSON.stringify(p) })).id,
    createPurchaseOrder: async (p: CreatePurchaseOrderPayload) => (await apiFetch<{ id: string }>('/api/stock/order', { method: 'POST', body: JSON.stringify(p) })).id,
    receivePurchaseLines: async (p: ReceivePurchasePayload) => { await apiFetch('/api/stock/receive', { method: 'POST', body: JSON.stringify(p) }); },
    startInventory: async (stationId: string) => (await apiFetch<{ id: string }>('/api/stock/inventory-start', { method: 'POST', body: JSON.stringify({ stationId }) })).id,
    recordInventoryCount: async (p: InventoryCountPayload) => { await apiFetch('/api/stock/inventory-count', { method: 'POST', body: JSON.stringify(p) }); },
    closeInventory: async (sessionId: string) => { await apiFetch('/api/stock/inventory-close', { method: 'POST', body: JSON.stringify({ sessionId }) }); },
    saveServiceConsumption: async (p: ServiceConsumptionPayload) => (await apiFetch<{ id: string }>('/api/stock/consumption-rule', { method: 'POST', body: JSON.stringify(p) })).id,
    consumeWash: async (washId: string) => { await apiFetch('/api/stock/consume-wash', { method: 'POST', body: JSON.stringify({ washId }) }); },
    linkExpenseToOrder: async (expenseId: string, orderId: string) => { await apiFetch('/api/stock/link-expense', { method: 'POST', body: JSON.stringify({ expenseId, orderId }) }); },
    certifyCosts: async (p: CostCertificationPayload) => { await apiFetch('/api/stock/certify-costs', { method: 'POST', body: JSON.stringify(p) }); },
  };

  readonly crmCommands: CrmCommands = {
    saveCustomerProfile: async (p: CustomerProfilePayload) => (await apiFetch<{ id: string }>('/api/crm/customer-profile', { method: 'POST', body: JSON.stringify(p) })).id,
    saveCustomerVehicle: async (p: CustomerVehiclePayload) => (await apiFetch<{ id: string }>('/api/crm/customer-vehicle', { method: 'POST', body: JSON.stringify(p) })).id,
    createLoyaltyProgram: async (p: LoyaltyProgramPayload) => (await apiFetch<{ id: string }>('/api/crm/loyalty-program', { method: 'POST', body: JSON.stringify(p) })).id,
    enrollLoyaltyCustomer: async (p: LoyaltyEnrollmentPayload) => (await apiFetch<{ id: string }>('/api/crm/loyalty-enroll', { method: 'POST', body: JSON.stringify(p) })).id,
    recordLoyaltyTransaction: async (p: LoyaltyTransactionPayload) => (await apiFetch<{ id: string }>('/api/crm/loyalty-tx', { method: 'POST', body: JSON.stringify(p) })).id,
    accrueLoyaltyForWash: (washId: string, idempotencyKey?: string | null) =>
      apiFetch<LoyaltyAccrualResult>('/api/crm/loyalty-accrue', { method: 'POST', body: JSON.stringify({ washId, idempotencyKey }) }),
    savePackagePlan: async (p: PackagePlanPayload) => (await apiFetch<{ id: string }>('/api/crm/package-plan', { method: 'POST', body: JSON.stringify(p) })).id,
    sellPackageToCustomer: async (p: PackageSalePayload) => (await apiFetch<{ id: string }>('/api/crm/package-sell', { method: 'POST', body: JSON.stringify(p) })).id,
    consumePackageForWash: (washId: string) =>
      apiFetch<PackageConsumptionResult>('/api/crm/package-consume', { method: 'POST', body: JSON.stringify({ washId }) }),
    savePromotion: async (p: PromotionPayload) => (await apiFetch<{ id: string }>('/api/crm/promotion', { method: 'POST', body: JSON.stringify(p) })).id,
    applyPromotionToWash: (p: PromotionApplicationPayload) =>
      apiFetch<PromotionApplicationResult>('/api/crm/promotion-apply', { method: 'POST', body: JSON.stringify(p) }),
    saveFleet: async (p: FleetPayload) => (await apiFetch<{ id: string }>('/api/crm/fleet', { method: 'POST', body: JSON.stringify(p) })).id,
    saveFleetContract: async (p: FleetContractPayload) => (await apiFetch<{ id: string }>('/api/crm/fleet-contract', { method: 'POST', body: JSON.stringify(p) })).id,
    attachFleetVehicle: async (p: AttachFleetVehiclePayload) => (await apiFetch<{ id: string }>('/api/crm/fleet-attach-vehicle', { method: 'POST', body: JSON.stringify(p) })).id,
    recordFleetReceivable: async (p: FleetReceivablePayload) => (await apiFetch<{ id: string }>('/api/crm/fleet-receivable', { method: 'POST', body: JSON.stringify(p) })).id,
    enqueueNotification: async (p: NotificationPayload) => (await apiFetch<{ id: string }>('/api/crm/notification-enqueue', { method: 'POST', body: JSON.stringify(p) })).id,
    cancelPendingNotification: async (id: string) => { await apiFetch('/api/crm/notification-cancel', { method: 'POST', body: JSON.stringify({ id }) }); },
  };

  readonly analyticsCommands: AnalyticsCommands = {
    refreshSubscriptionUsage: async (periodStart: string) => { await apiFetch('/api/platform/refresh-usage', { method: 'POST', body: JSON.stringify({ periodStart }) }); },
    savePlan: async (p: PlanPayload) => (await apiFetch<{ id: string }>('/api/platform/save-plan', { method: 'POST', body: JSON.stringify(p) })).id,
    setPlanLimit: async (p: PlanLimitPayload) => { await apiFetch('/api/platform/set-plan-limit', { method: 'POST', body: JSON.stringify(p) }); },
    setCompanySubscription: async (p: CompanySubscriptionPayload) => { await apiFetch('/api/platform/set-company-subscription', { method: 'POST', body: JSON.stringify(p) }); },
    setCompanySuspended: async (p: CompanySuspensionPayload) => { await apiFetch('/api/platform/set-company-suspended', { method: 'POST', body: JSON.stringify(p) }); },
  };

  async listPlans(): Promise<Plan[]> {
    const res = await apiFetch<{ plans: Plan[] }>('/api/plans');
    setPlansCache(res.plans);
    return res.plans;
  }

  async getBootstrap(): Promise<Bootstrap | null> {
    const { identity } = await apiFetch<{ identity: import('../auth/authTypes').AuthIdentity | null }>('/api/auth/me');
    if (!identity || !identity.company) return null;
    return {
      userId: identity.userId,
      fullName: identity.fullName,
      email: identity.email,
      active: identity.active,
      roleKey: identity.roleKey,
      permissions: identity.permissions,
      company: {
        id: identity.company.id,
        name: identity.company.name,
        city: identity.company.city,
        phone: identity.company.phone,
        currencyCode: identity.company.currencyCode,
        suspended: identity.company.suspended,
      },
      stations: identity.stations.map((s) => ({
        id: s.id, name: s.name, city: s.city, activated: s.activated,
      })),
      stationIds: identity.stationIds,
    };
  }

  async listCatalog(stationId?: string): Promise<CatalogSnapshot> {
    if (!stationId) return { categories: [], services: [], prices: [] };
    const snap = await this.setupCommands.read(stationId);
    return snap.catalog;
  }

  async listClients(stationId?: string): Promise<Client[]> {
    const r = await apiFetch<{ clients: Client[] }>(`/api/washes/clients${qs({ stationId })}`);
    return r.clients;
  }

  async listAssignableUsers(stationId: string): Promise<AppUser[]> {
    const r = await apiFetch<{ users: AppUser[] }>(`/api/washes/assignable${qs({ stationId })}`);
    return r.users;
  }

  async listWashBoard(stationId?: string): Promise<WashBoardSnapshot> {
    return apiFetch<WashBoardSnapshot>(`/api/washes/board${qs({ stationId })}`);
  }

  async listStationMetrics(stationId: string, start: string, end: string): Promise<StationMetrics> {
    return apiFetch<StationMetrics>(`/api/washes/metrics${qs({ stationId, start, end })}`);
  }

  async listFinanceBoard(stationId?: string): Promise<FinanceSnapshot> {
    return apiFetch<FinanceSnapshot>(`/api/finance/board${qs({ stationId })}`);
  }

  async listProfitability(start: string, end: string, stationId?: string): Promise<ProfitabilityReport> {
    return apiFetch<ProfitabilityReport>(`/api/finance/profitability${qs({ start, end, stationId })}`);
  }

  async listStockBoard(stationId?: string): Promise<StockSnapshot> {
    return apiFetch<StockSnapshot>(`/api/stock/board${qs({ stationId })}`);
  }

  async listCrmBoard(stationId?: string): Promise<CrmSnapshot> {
    return apiFetch<CrmSnapshot>(`/api/crm/board${qs({ stationId })}`);
  }

  async listAnalyticsBoard(
    start: string,
    end: string,
    compareStart: string | null,
    compareEnd: string | null,
  ): Promise<AnalyticsSnapshot> {
    return apiFetch<AnalyticsSnapshot>(`/api/analytics/board${qs({ start, end, compareStart, compareEnd })}`);
  }

  async listSubscriptionUsage(periodStart: string): Promise<SubscriptionUsageSnapshot> {
    return apiFetch<SubscriptionUsageSnapshot>(`/api/analytics/usage${qs({ periodStart })}`);
  }

  async listPlatformBoard(): Promise<PlatformSnapshot> {
    return apiFetch<PlatformSnapshot>('/api/platform/board');
  }
}
