import type {
  AppState, CostCertification, InventoryItem, InventorySession, Product,
  ProductCategory, PurchaseOrder, PurchaseOrderItem, Service, StockAlert,
  StockConsumptionRun, StockLevel, StockMovement, StockReceiptEvent,
  StockService, StockValuation, Supplier, ServiceProductConsumption,
} from '../types';

// ─── Prompt 07 : projection serveur → domaine, aucune donnée fabriquée ───────
// `my_stock_board()` renvoie un JSONB déjà filtré par RLS et par station. Ces
// fonctions sont pures : elles ne créent ni produit, ni fournisseur, ni prix.

export const STOCK_EXPENSE_CATEGORIES = [
  'achats', 'achat', 'stock', 'fournitures', 'produits', 'consommables', 'shampoing',
];

export interface SupplierPayload {
  stationId: string;
  id?: string | null;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  active?: boolean;
}

export interface ProductPayload {
  stationId: string;
  id?: string | null;
  name: string;
  sku?: string;
  category?: string;
  unit?: string;
  reorderLevel?: number;
  active?: boolean;
}

export interface PurchaseOrderLinePayload {
  productId: string;
  qtyOrdered: number;
  unitCostMinor: number;
}

export interface CreatePurchaseOrderPayload {
  stationId: string;
  supplierId?: string | null;
  number: string;
  orderedAt: string;
  expectedAt?: string | null;
  lines: PurchaseOrderLinePayload[];
  idempotencyKey: string;
}

export interface ReceivePurchaseLinePayload {
  productId: string;
  qty: number;
  unitCostMinor?: number | null;
}

export interface ReceivePurchasePayload {
  orderId: string;
  receiptKey: string;
  lines: ReceivePurchaseLinePayload[];
}

export interface InventoryCountPayload {
  sessionId: string;
  productId: string;
  countedQty: number;
  reason?: string;
}

export interface ServiceConsumptionPayload {
  serviceId: string;
  productId: string;
  qtyPerWash: number;
  active?: boolean;
}

export interface CostCertificationPayload {
  start: string;
  end: string;
  attestation: string;
}

export interface StockSnapshot {
  productCategories: ProductCategory[];
  suppliers: Supplier[];
  products: Product[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderItems: PurchaseOrderItem[];
  stockLevels: StockLevel[];
  stockMovements: StockMovement[];
  inventorySessions: InventorySession[];
  inventoryItems: InventoryItem[];
  stockServices: StockService[];
  serviceConsumptions: ServiceProductConsumption[];
  receiptEvents: StockReceiptEvent[];
  consumptionRuns: StockConsumptionRun[];
  costCertifications: CostCertification[];
  alerts: StockAlert[];
  valuation: StockValuation;
  rules: Record<string, string>;
}

type Row = Record<string, unknown>;

function asRecord(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Ligne ${label} invalide reçue depuis my_stock_board().`);
  }
  return value as Row;
}

function arr(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`Collection ${label} invalide.`);
  return value.map((entry) => asRecord(entry, label));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function iso(value: unknown, fallback: string): string {
  return text(value) || fallback;
}

function dateOnly(value: unknown, fallback: string): string {
  return text(value) ? text(value).slice(0, 10) : fallback;
}

function lines(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const NOW = new Date().toISOString();

export const EMPTY_STOCK_VALUATION: StockValuation = {
  stockValueMinor: 0, productsValued: 0, consumptionCostMinor: 0,
  purchaseCostMinor: 0, openOrders: 0, lowStockAlerts: 0,
};

export const STOCK_RULES: Record<string, string> = {
  reception: 'Seule la réception incrémente le stock ; une commande ne le fait jamais.',
  immutability: 'Un mouvement n’est jamais modifié ni supprimé ; un écart crée un nouveau mouvement.',
  consumption: 'Une consommation théorique est générée au plus une fois par fiche et par produit.',
  costing: 'Coût moyen pondéré mis à jour à chaque réception, figé sur chaque mouvement de consommation.',
};

export function emptyStockCollections(): Pick<AppState,
  'productCategories' | 'suppliers' | 'products' | 'purchaseOrders' |
  'purchaseOrderItems' | 'stockLevels' | 'stockMovements' |
  'inventorySessions' | 'inventoryItems' | 'stockServices' |
  'serviceConsumptions' | 'receiptEvents' | 'consumptionRuns' |
  'costCertifications' | 'stockAlerts' | 'stockValuation'> {
  return {
    productCategories: [], suppliers: [], products: [],
    purchaseOrders: [], purchaseOrderItems: [], stockLevels: [],
    stockMovements: [], inventorySessions: [], inventoryItems: [],
    stockServices: [], serviceConsumptions: [], receiptEvents: [],
    consumptionRuns: [], costCertifications: [], stockAlerts: [],
    stockValuation: { ...EMPTY_STOCK_VALUATION },
  };
}

export function stockAlertsFrom(products: Product[], levels: StockLevel[]): StockAlert[] {
  const byProduct = new Map(levels.map((l) => [l.productId, l]));
  return products
    .filter((p) => p.active && p.reorderLevel > 0)
    .map((p) => {
      const qty = byProduct.get(p.id)?.qtyOnHand ?? 0;
      return {
        productId: p.id, stationId: p.stationId, name: p.name,
        qtyOnHand: qty, reorderLevel: p.reorderLevel,
        severity: (qty === 0 ? 'rupture' : 'seuil') as StockAlert['severity'],
      };
    })
    .filter((a) => a.qtyOnHand <= a.reorderLevel);
}

export function stockValuationFrom(state: Partial<AppState>): StockValuation {
  const products = state.products ?? [];
  const levels = state.stockLevels ?? [];
  const movements = state.stockMovements ?? [];
  const orders = state.purchaseOrders ?? [];
  const byProduct = new Map(levels.map((l) => [l.productId, l]));
  return {
    stockValueMinor: products.reduce(
      (sum, p) => sum + (byProduct.get(p.id)?.qtyOnHand ?? 0) * p.averageCostMinor, 0
    ),
    productsValued: products.filter((p) => p.averageCostMinor > 0).length,
    consumptionCostMinor: movements
      .filter((m) => m.kind === 'consumption')
      .reduce((sum, m) => sum + Math.max(0, -m.qtyDelta) * m.unitCostMinor, 0),
    purchaseCostMinor: movements
      .filter((m) => m.kind === 'purchase_receipt')
      .reduce((sum, m) => sum + Math.max(0, m.qtyDelta) * m.unitCostMinor, 0),
    openOrders: orders.filter((o) => o.status === 'sent' || o.status === 'partially_received').length,
    lowStockAlerts: stockAlertsFrom(products, levels).length,
  };
}

/** Normalise un état local ou serveur : aucune collection n'est undefined. */
export function withStockDefaults(state: AppState): AppState {
  const collections = emptyStockCollections();
  const next: AppState = {
    ...state,
    productCategories: state.productCategories ?? collections.productCategories,
    suppliers: state.suppliers ?? collections.suppliers,
    products: state.products ?? collections.products,
    purchaseOrders: state.purchaseOrders ?? collections.purchaseOrders,
    purchaseOrderItems: state.purchaseOrderItems ?? collections.purchaseOrderItems,
    stockLevels: state.stockLevels ?? collections.stockLevels,
    stockMovements: state.stockMovements ?? collections.stockMovements,
    inventorySessions: state.inventorySessions ?? collections.inventorySessions,
    inventoryItems: state.inventoryItems ?? collections.inventoryItems,
    stockServices: state.stockServices?.length
      ? state.stockServices
      : (state.services as Service[]).map((service) => ({
        id: service.id, stationId: service.stationId, name: service.name, active: service.active,
      })),
    serviceConsumptions: state.serviceConsumptions ?? collections.serviceConsumptions,
    receiptEvents: state.receiptEvents ?? collections.receiptEvents,
    consumptionRuns: state.consumptionRuns ?? collections.consumptionRuns,
    costCertifications: state.costCertifications ?? collections.costCertifications,
  };
  const productById = new Map(next.products.map((p) => [p.id, p]));
  const levels = next.products.map((p) => {
    const saved = next.stockLevels.find((l) => l.productId === p.id && l.stationId === p.stationId);
    return {
      productId: p.id, stationId: p.stationId, name: saved?.name ?? p.name,
      unit: saved?.unit ?? p.unit, reorderLevel: saved?.reorderLevel ?? p.reorderLevel,
      qtyOnHand: saved?.qtyOnHand ?? 0,
      averageCostMinor: saved?.averageCostMinor ?? productById.get(p.id)?.averageCostMinor ?? 0,
      valueMinor: (saved?.qtyOnHand ?? 0) * (saved?.averageCostMinor ?? productById.get(p.id)?.averageCostMinor ?? 0),
    };
  });
  next.stockLevels = levels;
  next.stockAlerts = stockAlertsFrom(next.products, levels);
  next.stockValuation = stockValuationFrom(next);
  return next;
}

/** Repli local : l'état navigateur est la source de vérité en mode local. */
export function stockBoardFromState(state: AppState): StockSnapshot {
  const s = withStockDefaults(state);
  const stockServices: StockService[] = (s.services as Service[]).map((service) => ({
    id: service.id, stationId: service.stationId, name: service.name, active: service.active,
  }));
  return {
    productCategories: s.productCategories, suppliers: s.suppliers, products: s.products,
    purchaseOrders: s.purchaseOrders, purchaseOrderItems: s.purchaseOrderItems,
    stockLevels: s.stockLevels, stockMovements: s.stockMovements,
    inventorySessions: s.inventorySessions, inventoryItems: s.inventoryItems,
    stockServices, serviceConsumptions: s.serviceConsumptions,
    receiptEvents: s.receiptEvents, consumptionRuns: s.consumptionRuns,
    costCertifications: s.costCertifications, alerts: s.stockAlerts,
    valuation: s.stockValuation, rules: { ...STOCK_RULES },
  };
}

/** `my_stock_board()` → collections typées, sans identifiant de tenant. */
export function mapStockBoard(value: unknown): StockSnapshot {
  const b = asRecord(value, 'my_stock_board');
  const valuation = asRecord(b.valuation ?? {}, 'valuation');
  const rulesRow = asRecord(b.rules ?? {}, 'rules');
  const rules: Record<string, string> = { ...STOCK_RULES };
  Object.entries(rulesRow).forEach(([key, v]) => {
    if (typeof v === 'string') rules[key] = v;
  });
  return {
    productCategories: arr(b.productCategories, 'productCategories').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), name: text(r.name), active: bool(r.active),
    })),
    suppliers: arr(b.suppliers, 'suppliers').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), name: text(r.name),
      phone: text(r.phone), email: text(r.email), address: text(r.address), active: bool(r.active),
    })),
    products: arr(b.products, 'products').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), categoryId: nullableText(r.categoryId),
      sku: text(r.sku), name: text(r.name), category: text(r.category),
      unit: text(r.unit) || 'unité', reorderLevel: number(r.reorderLevel),
      averageCostMinor: number(r.averageCostMinor), active: bool(r.active),
    })),
    purchaseOrders: arr(b.purchaseOrders, 'purchaseOrders').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), supplierId: nullableText(r.supplierId),
      number: text(r.number),
      status: (['draft', 'sent', 'partially_received', 'received', 'cancelled'].includes(text(r.status))
        ? text(r.status) : 'sent') as PurchaseOrder['status'],
      orderedAt: dateOnly(r.orderedAt, NOW.slice(0, 10)),
      expectedAt: nullableText(r.expectedAt), note: text(r.note),
    })),
    purchaseOrderItems: arr(b.purchaseOrderItems, 'purchaseOrderItems').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), orderId: text(r.orderId),
      productId: text(r.productId), qtyOrdered: number(r.qtyOrdered),
      qtyReceived: number(r.qtyReceived), unitCostMinor: number(r.unitCostMinor),
    })),
    stockLevels: arr(b.stockLevels, 'stockLevels').map((r) => ({
      productId: text(r.productId), stationId: text(r.stationId), name: text(r.name),
      unit: text(r.unit) || 'unité', reorderLevel: number(r.reorderLevel),
      qtyOnHand: number(r.qtyOnHand), averageCostMinor: number(r.averageCostMinor),
      valueMinor: number(r.valueMinor),
    })),
    stockMovements: arr(b.stockMovements, 'stockMovements').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), productId: text(r.productId),
      kind: (text(r.kind) || 'inventory_adjustment') as StockMovement['kind'],
      qtyDelta: number(r.qtyDelta), unitCostMinor: number(r.unitCostMinor),
      referenceType: nullableText(r.referenceType), referenceId: nullableText(r.referenceId),
      idempotencyKey: nullableText(r.idempotencyKey), note: text(r.note),
      createdAt: iso(r.createdAt, NOW),
    })),
    inventorySessions: arr(b.inventorySessions, 'inventorySessions').map((r) => ({
      id: text(r.id), stationId: text(r.stationId),
      status: text(r.status) === 'closed' ? 'closed' : 'open',
      startedAt: iso(r.startedAt, NOW), closedAt: nullableText(r.closedAt),
    })),
    inventoryItems: arr(b.inventoryItems, 'inventoryItems').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), sessionId: text(r.sessionId),
      productId: text(r.productId), expectedQty: number(r.expectedQty),
      countedQty: number(r.countedQty), difference: number(r.difference), reason: text(r.reason),
    })),
    stockServices: arr(b.services, 'services').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), name: text(r.name), active: bool(r.active),
    })),
    serviceConsumptions: arr(b.serviceConsumptions, 'serviceConsumptions').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), serviceId: text(r.serviceId),
      productId: text(r.productId), qtyPerWash: number(r.qtyPerWash), active: bool(r.active),
    })),
    receiptEvents: arr(b.receiptEvents, 'receiptEvents').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), orderId: text(r.orderId),
      receiptKey: text(r.receiptKey), lines: lines(r.lines), createdAt: iso(r.createdAt, NOW),
    })),
    consumptionRuns: arr(b.consumptionRuns, 'consumptionRuns').map((r) => ({
      id: text(r.id), stationId: text(r.stationId), washId: text(r.washId),
      movementCount: number(r.movementCount), valuedMinor: number(r.valuedMinor),
      createdAt: iso(r.createdAt, NOW),
    })),
    costCertifications: arr(b.costCertifications, 'costCertifications').map((r) => ({
      id: text(r.id), start: dateOnly(r.start, NOW.slice(0, 10)),
      end: dateOnly(r.end, NOW.slice(0, 10)),
      revenueMinor: number(r.revenueMinor), consumptionCostMinor: number(r.consumptionCostMinor),
      operatingExpenseMinor: number(r.operatingExpenseMinor),
      commissionCostMinor: number(r.commissionCostMinor),
      grossMarginMinor: number(r.grossMarginMinor), resultMinor: number(r.resultMinor),
      attestation: text(r.attestation), certifiedAt: iso(r.certifiedAt, NOW),
    })),
    alerts: arr(b.alerts, 'alerts').map((r) => ({
      productId: text(r.productId), stationId: text(r.stationId), name: text(r.name),
      qtyOnHand: number(r.qtyOnHand), reorderLevel: number(r.reorderLevel),
      severity: (text(r.severity) === 'rupture' ? 'rupture' : 'seuil') as StockAlert['severity'],
    })),
    valuation: {
      stockValueMinor: number(valuation.stockValueMinor),
      productsValued: number(valuation.productsValued),
      consumptionCostMinor: number(valuation.consumptionCostMinor),
      purchaseCostMinor: number(valuation.purchaseCostMinor),
      openOrders: number(valuation.openOrders),
      lowStockAlerts: number(valuation.lowStockAlerts),
    },
    rules,
  };
}
