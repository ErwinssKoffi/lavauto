import type {
  AppState, CostCertification, Expense, InventoryItem, Product, ProductCategory,
  PurchaseOrder, PurchaseOrderItem, ServiceProductConsumption, StockLevel,
  StockMovement, Supplier,
} from '../types';
import { buildProfitability } from './finance';
import { withFinanceDefaults } from './financeState';
import {
  STOCK_EXPENSE_CATEGORIES, withStockDefaults,
  type CostCertificationPayload, type CreatePurchaseOrderPayload,
  type InventoryCountPayload, type ProductPayload, type ReceivePurchasePayload,
  type ServiceConsumptionPayload, type SupplierPayload,
} from './stock';

// ─── Prompt 07 : transformations locales pures, miroir des RPC serveur ───────
// Aucune donnée préremplie. Les mouvements ne sont jamais modifiés/supprimés :
// une régularisation ajoute une ligne. Le stock ne descend jamais sous zéro.

function localId(prefix: string): string {
  const raw = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${raw}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function stationOf(state: AppState, requested?: string): string {
  const stationId = requested || state.station?.id || '';
  if (!stationId) throw new Error('Station absente : activez d’abord la station.');
  return stationId;
}

function inPeriod(date: string, start: string, end: string): boolean {
  const day = date.slice(0, 10);
  return day >= start && day <= end;
}

export function saveSupplierLocal(
  state: AppState, p: SupplierPayload
): { state: AppState; id: string } {
  const s = withStockDefaults(state);
  const stationId = stationOf(s, p.stationId);
  const name = p.name.trim();
  if (name.length < 2) throw new Error('Nom de fournisseur invalide.');
  const id = p.id || localId('sup');
  const existing = s.suppliers.find((x) => x.id === id && x.stationId === stationId);
  const supplier: Supplier = {
    id, stationId, name, phone: p.phone ?? '', email: p.email ?? '',
    address: p.address ?? '', active: p.active ?? true,
  };
  const suppliers = existing
    ? s.suppliers.map((x) => x.id === id ? supplier : x)
    : [...s.suppliers, supplier];
  return { state: withStockDefaults({ ...s, suppliers }), id };
}

export function saveProductLocal(
  state: AppState, p: ProductPayload
): { state: AppState; id: string } {
  const s = withStockDefaults(state);
  const stationId = stationOf(s, p.stationId);
  const name = p.name.trim();
  const category = (p.category ?? '').trim();
  if (name.length < 2 || (p.reorderLevel ?? 0) < 0) throw new Error('Produit invalide.');
  let categories = [...s.productCategories];
  let categoryId: string | null = null;
  if (category) {
    const found = categories.find((c) => c.stationId === stationId && c.name.toLowerCase() === category.toLowerCase());
    if (found) categoryId = found.id;
    else {
      const created: ProductCategory = { id: localId('cat'), stationId, name: category, active: true };
      categories = [...categories, created];
      categoryId = created.id;
    }
  }
  const id = p.id || localId('prod');
  const existing = s.products.find((x) => x.id === id && x.stationId === stationId);
  const product: Product = {
    id, stationId, categoryId, sku: (p.sku ?? '').trim(), name, category,
    unit: (p.unit ?? '').trim() || 'unité', reorderLevel: Math.max(0, p.reorderLevel ?? 0),
    averageCostMinor: existing?.averageCostMinor ?? 0, active: p.active ?? true,
  };
  const products = existing
    ? s.products.map((x) => x.id === id ? product : x)
    : [...s.products, product];
  return { state: withStockDefaults({ ...s, productCategories: categories, products }), id };
}

export function createPurchaseOrderLocal(
  state: AppState, p: CreatePurchaseOrderPayload
): { state: AppState; id: string } {
  const s = withStockDefaults(state);
  const stationId = stationOf(s, p.stationId);
  const existing = s.purchaseOrders.find((o) => o.note === p.idempotencyKey);
  if (existing) return { state: s, id: existing.id };
  if (p.number.trim().length < 2 || p.lines.length === 0) throw new Error('Commande incomplète.');
  if (p.lines.some((l) => l.qtyOrdered <= 0 || l.unitCostMinor < 0
    || !s.products.some((x) => x.id === l.productId && x.stationId === stationId))) {
    throw new Error('Ligne de commande invalide.');
  }
  const id = localId('order');
  const order: PurchaseOrder = {
    id, stationId, supplierId: p.supplierId ?? null, number: p.number.trim(),
    status: 'sent', orderedAt: p.orderedAt.slice(0, 10),
    expectedAt: p.expectedAt ? p.expectedAt.slice(0, 10) : null,
    note: p.idempotencyKey,
  };
  const items: PurchaseOrderItem[] = p.lines.map((l) => ({
    id: localId('item'), stationId, orderId: id, productId: l.productId,
    qtyOrdered: Math.round(l.qtyOrdered), qtyReceived: 0,
    unitCostMinor: Math.round(l.unitCostMinor),
  }));
  // Aucun mouvement de stock : la création de commande n'incrémente rien.
  return {
    state: withStockDefaults({
      ...s,
      purchaseOrders: [...s.purchaseOrders, order],
      purchaseOrderItems: [...s.purchaseOrderItems, ...items],
    }),
    id,
  };
}

export function receivePurchaseLinesLocal(state: AppState, p: ReceivePurchasePayload): AppState {
  const s = withStockDefaults(state);
  const receiptKey = p.receiptKey.trim();
  if (receiptKey.length < 3 || p.lines.length === 0) throw new Error('Réception incomplète.');
  const event = s.receiptEvents.find((r) => r.receiptKey === receiptKey);
  if (event) {
    if (event.orderId !== p.orderId || JSON.stringify(event.lines) !== JSON.stringify(p.lines)) {
      throw new Error('Clé de réception déjà utilisée avec un autre contenu.');
    }
    return s;
  }
  const order = s.purchaseOrders.find((o) => o.id === p.orderId);
  if (!order || order.status === 'cancelled') throw new Error('Commande introuvable ou annulée.');
  const byProduct = new Map<string, { qty: number; unitCostMinor: number | null }>();
  p.lines.forEach((l) => {
    const current = byProduct.get(l.productId) ?? { qty: 0, unitCostMinor: null };
    current.qty += Math.round(l.qty);
    if (l.unitCostMinor !== null && l.unitCostMinor !== undefined) current.unitCostMinor = Math.round(l.unitCostMinor);
    byProduct.set(l.productId, current);
  });
  const at = nowISO();
  let products = [...s.products];
  let items = [...s.purchaseOrderItems];
  const levels = new Map(s.stockLevels.map((l) => [l.productId, { ...l }]));
  const movements = [...s.stockMovements];
  for (const [productId, line] of byProduct) {
    if (line.qty <= 0 || (line.unitCostMinor ?? 0) < 0) throw new Error('Ligne de réception invalide.');
    const key = `receipt:${receiptKey}:${productId}`;
    if (movements.some((m) => m.idempotencyKey === key)) continue;
    const item = items.find((i) => i.orderId === p.orderId && i.productId === productId);
    if (!item) throw new Error('Ligne de commande inconnue.');
    if (line.qty > item.qtyOrdered - item.qtyReceived) throw new Error('Quantité reçue supérieure au reste à recevoir.');
    const product = products.find((x) => x.id === productId);
    if (!product) throw new Error('Produit introuvable.');
    const unitCostMinor = line.unitCostMinor ?? item.unitCostMinor;
    const before = levels.get(productId);
    const oldQty = before?.qtyOnHand ?? 0;
    const oldAvg = before?.averageCostMinor ?? product.averageCostMinor;
    const newAvg = Math.round((oldQty * oldAvg + line.qty * unitCostMinor) / (oldQty + line.qty));
    products = products.map((x) => x.id === productId ? { ...x, averageCostMinor: newAvg } : x);
    items = items.map((x) => x === item ? { ...x, qtyReceived: x.qtyReceived + line.qty } : x);
    levels.set(productId, {
      productId, stationId: order.stationId, name: product.name, unit: product.unit,
      reorderLevel: product.reorderLevel, qtyOnHand: oldQty + line.qty,
      averageCostMinor: newAvg, valueMinor: (oldQty + line.qty) * newAvg,
    });
    movements.push({
      id: localId('mv'), stationId: order.stationId, productId,
      kind: 'purchase_receipt', qtyDelta: line.qty, unitCostMinor,
      referenceType: 'purchase_order', referenceId: order.id,
      idempotencyKey: key, note: `Réception ${receiptKey}`, createdAt: at,
    });
  }
  const remaining = items.filter((i) => i.orderId === p.orderId && i.qtyReceived < i.qtyOrdered).length;
  const orders = s.purchaseOrders.map((o) => o.id === p.orderId
    ? { ...o, status: (remaining === 0 ? 'received' : 'partially_received') as PurchaseOrder['status'] }
    : o);
  const receiptEvents = [...s.receiptEvents, {
    id: localId('receipt'), stationId: order.stationId, orderId: order.id,
    receiptKey, lines: p.lines as unknown[], createdAt: at,
  }];
  return withStockDefaults({
    ...s, products, purchaseOrderItems: items, purchaseOrders: orders,
    stockLevels: Array.from(levels.values()), stockMovements: movements, receiptEvents,
  });
}

export function startInventoryLocal(
  state: AppState, stationId?: string
): { state: AppState; id: string } {
  const s = withStockDefaults(state);
  const station = stationOf(s, stationId);
  if (s.inventorySessions.some((x) => x.stationId === station && x.status === 'open')) {
    throw new Error('Un inventaire est déjà ouvert sur cette station.');
  }
  const id = localId('inv');
  const at = nowISO();
  const items: InventoryItem[] = s.products
    .filter((p) => p.stationId === station && p.active)
    .map((p) => {
      const qty = s.stockLevels.find((l) => l.productId === p.id)?.qtyOnHand ?? 0;
      return {
        id: localId('inv-item'), stationId: station, sessionId: id, productId: p.id,
        expectedQty: qty, countedQty: qty, difference: 0, reason: '',
      };
    });
  return {
    state: withStockDefaults({
      ...s,
      inventorySessions: [...s.inventorySessions, {
        id, stationId: station, status: 'open', startedAt: at, closedAt: null,
      }],
      inventoryItems: [...s.inventoryItems, ...items],
    }),
    id,
  };
}

export function recordInventoryCountLocal(state: AppState, p: InventoryCountPayload): AppState {
  const s = withStockDefaults(state);
  const session = s.inventorySessions.find((x) => x.id === p.sessionId && x.status === 'open');
  if (!session) throw new Error('Inventaire ouvert introuvable.');
  if (p.countedQty < 0) throw new Error('Comptage négatif interdit.');
  const item = s.inventoryItems.find((x) => x.sessionId === p.sessionId && x.productId === p.productId);
  if (!item) throw new Error('Produit hors inventaire.');
  const inventoryItems = s.inventoryItems.map((x) => x === item ? {
    ...x, countedQty: Math.round(p.countedQty), difference: Math.round(p.countedQty) - x.expectedQty,
    reason: p.reason ?? '',
  } : x);
  return withStockDefaults({ ...s, inventoryItems });
}

export function closeInventoryLocal(state: AppState, sessionId: string): AppState {
  const s = withStockDefaults(state);
  const session = s.inventorySessions.find((x) => x.id === sessionId && x.status === 'open');
  if (!session) throw new Error('Inventaire ouvert introuvable.');
  const at = nowISO();
  const levels = new Map(s.stockLevels.map((l) => [l.productId, { ...l }]));
  const movements = [...s.stockMovements];
  for (const item of s.inventoryItems.filter((x) => x.sessionId === sessionId)) {
    if (item.difference === 0) continue;
    const before = levels.get(item.productId);
    const qty = before?.qtyOnHand ?? 0;
    if (qty + item.difference < 0) throw new Error('Ajustement refusé : stock négatif interdit.');
    const product = s.products.find((p) => p.id === item.productId);
    const avg = before?.averageCostMinor ?? product?.averageCostMinor ?? 0;
    levels.set(item.productId, {
      productId: item.productId, stationId: session.stationId,
      name: product?.name ?? before?.name ?? '', unit: product?.unit ?? before?.unit ?? 'unité',
      reorderLevel: product?.reorderLevel ?? before?.reorderLevel ?? 0,
      qtyOnHand: qty + item.difference, averageCostMinor: avg,
      valueMinor: (qty + item.difference) * avg,
    });
    movements.push({
      id: localId('mv'), stationId: session.stationId, productId: item.productId,
      kind: 'inventory_adjustment', qtyDelta: item.difference, unitCostMinor: avg,
      referenceType: 'inventory_session', referenceId: sessionId,
      idempotencyKey: `inventory:${sessionId}:${item.productId}`,
      note: item.reason || 'Écart d’inventaire', createdAt: at,
    });
  }
  const inventorySessions = s.inventorySessions.map((x) => x.id === sessionId
    ? { ...x, status: 'closed' as const, closedAt: at } : x);
  return withStockDefaults({
    ...s, inventorySessions, stockLevels: Array.from(levels.values()), stockMovements: movements,
  });
}

export function saveServiceConsumptionLocal(
  state: AppState, p: ServiceConsumptionPayload
): { state: AppState; id: string } {
  const s = withStockDefaults(state);
  if (p.qtyPerWash <= 0) throw new Error('Consommation théorique invalide.');
  const service = s.services.find((x) => x.id === p.serviceId);
  const product = s.products.find((x) => x.id === p.productId);
  if (!service || !product || service.stationId !== product.stationId) {
    throw new Error('Prestation ou produit hors station.');
  }
  const id = localId('cons-rule');
  const existing = s.serviceConsumptions.find((x) => x.serviceId === p.serviceId && x.productId === p.productId);
  const rule: ServiceProductConsumption = {
    id: existing?.id ?? id, stationId: service.stationId,
    serviceId: p.serviceId, productId: p.productId,
    qtyPerWash: p.qtyPerWash, active: p.active ?? true,
  };
  const serviceConsumptions = existing
    ? s.serviceConsumptions.map((x) => x === existing ? rule : x)
    : [...s.serviceConsumptions, rule];
  return { state: withStockDefaults({ ...s, serviceConsumptions }), id: rule.id };
}

export function consumeWashLocal(state: AppState, washId: string): AppState {
  const s = withStockDefaults(state);
  if (s.consumptionRuns.some((r) => r.washId === washId)) return s;
  const wash = s.washes.find((w) => w.id === washId);
  if (!wash || !['ready', 'delivered'].includes(wash.status)) {
    throw new Error('Consommation réservée aux fiches terminées ou livrées.');
  }
  const byProduct = new Map<string, number>();
  wash.items.forEach((item) => {
    s.serviceConsumptions
      .filter((r) => r.active && r.serviceId === item.serviceId && r.stationId === wash.stationId)
      .forEach((r) => {
        const qty = Math.ceil(r.qtyPerWash * item.qty);
        byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + qty);
      });
  });
  if (byProduct.size === 0) return s;
  const at = nowISO();
  const levels = new Map(s.stockLevels.map((l) => [l.productId, { ...l }]));
  const movements = [...s.stockMovements];
  let valuedMinor = 0;
  for (const [productId, qty] of byProduct) {
    const key = `wash:${washId}:${productId}`;
    if (movements.some((m) => m.idempotencyKey === key)) continue;
    const product = s.products.find((p) => p.id === productId);
    if (!product) throw new Error('Produit introuvable.');
    const before = levels.get(productId);
    if ((before?.qtyOnHand ?? 0) < qty) throw new Error(`Stock insuffisant pour ${product.name}.`);
    const cost = before?.averageCostMinor ?? product.averageCostMinor;
    levels.set(productId, {
      ...(before as StockLevel), qtyOnHand: (before?.qtyOnHand ?? 0) - qty,
      averageCostMinor: cost, valueMinor: ((before?.qtyOnHand ?? 0) - qty) * cost,
    });
    movements.push({
      id: localId('mv'), stationId: wash.stationId, productId,
      kind: 'consumption', qtyDelta: -qty, unitCostMinor: cost,
      referenceType: 'wash', referenceId: washId, idempotencyKey: key,
      note: 'Consommation théorique', createdAt: at,
    });
    valuedMinor += qty * cost;
  }
  const consumptionRuns = [...s.consumptionRuns, {
    id: localId('run'), stationId: wash.stationId, washId,
    movementCount: byProduct.size, valuedMinor, createdAt: at,
  }];
  return withStockDefaults({
    ...s, stockLevels: Array.from(levels.values()), stockMovements: movements, consumptionRuns,
  });
}

export function linkExpenseToOrderLocal(state: AppState, expenseId: string, orderId: string): AppState {
  const s = withFinanceDefaults(withStockDefaults(state));
  const expense = s.expenses.find((e) => e.id === expenseId && e.status === 'enregistree');
  const order = s.purchaseOrders.find((o) => o.id === orderId);
  if (!expense || !order || expense.stationId !== order.stationId) {
    throw new Error('Rattachement hors périmètre.');
  }
  if (expense.purchaseOrderId && expense.purchaseOrderId !== orderId) {
    throw new Error('Dépense déjà rattachée à une autre commande.');
  }
  const expenses: Expense[] = s.expenses.map((e) => e.id === expenseId ? { ...e, purchaseOrderId: orderId } : e);
  return withStockDefaults({ ...s, expenses });
}

export function certifyCostsLocal(state: AppState, p: CostCertificationPayload): AppState {
  const s = withFinanceDefaults(withStockDefaults(state));
  const start = p.start.slice(0, 10);
  const end = p.end.slice(0, 10);
  const attestation = p.attestation.trim();
  if (!start || !end || end < start || attestation.length < 15) {
    throw new Error('Période ou attestation invalide.');
  }
  if (s.costCertifications.some((c) => c.start === start && c.end === end)) {
    throw new Error('Période déjà certifiée : relevé immuable.');
  }
  const ambiguous = s.expenses.filter((e) => e.status === 'enregistree'
    && inPeriod(e.date, start, end)
    && STOCK_EXPENSE_CATEGORIES.includes(e.category.trim().toLowerCase())
    && !e.purchaseOrderId).length;
  const unvalued = s.stockMovements.filter((m) => inPeriod(m.createdAt, start, end)
    && ((['purchase_receipt', 'consumption'].includes(m.kind) && m.unitCostMinor <= 0)
      || (m.kind === 'inventory_adjustment' && m.qtyDelta > 0 && m.unitCostMinor <= 0))).length;
  const draft = (s.commissionPeriods ?? []).filter((c) => c.status === 'draft'
    && c.start <= end && c.end >= start).length;
  if (ambiguous || unvalued || draft) {
    throw new Error(`Coûts incomplets : ${ambiguous} achat(s) non rattaché(s), ${unvalued} mouvement(s) non valorisé(s), ${draft} période(s) brouillon.`);
  }
  const base = buildProfitability(s, new Date(`${start}T00:00:00`), new Date(`${end}T23:59:59`));
  const operatingExpenses = base.operatingExpenses ?? base.expenses;
  const grossMarginMinor = base.revenue - base.consumptions;
  const resultMinor = grossMarginMinor - operatingExpenses - base.commissions;
  const certification: CostCertification = {
    id: localId('cert'), start, end,
    revenueMinor: base.revenue, consumptionCostMinor: base.consumptions,
    operatingExpenseMinor: operatingExpenses, commissionCostMinor: base.commissions,
    grossMarginMinor, resultMinor, attestation, certifiedAt: nowISO(),
  };
  const next: AppState = { ...s, costCertifications: [...s.costCertifications, certification] };
  next.profitability = buildProfitability(withStockDefaults(next),
    new Date(`${start}T00:00:00`), new Date(`${end}T23:59:59`));
  return withStockDefaults(next);
}

export function updateProductThresholdLocal(
  state: AppState, productId: string, reorderLevel: number
): AppState {
  const s = withStockDefaults(state);
  const threshold = Math.max(0, Math.round(reorderLevel));
  const products = s.products.map((p) =>
    p.id === productId ? { ...p, reorderLevel: threshold } : p
  );
  const stockLevels = s.stockLevels.map((level) =>
    level.productId === productId ? { ...level, reorderLevel: threshold } : level
  );
  return withStockDefaults({ ...s, products, stockLevels });
}

export function adjustProductStockQtyLocal(
  state: AppState, productId: string, qtyOnHand: number
): AppState {
  const s = withStockDefaults(state);
  const level = s.stockLevels.find((l) => l.productId === productId);
  const current = level?.qtyOnHand ?? 0;
  const target = Math.max(0, Math.round(qtyOnHand));
  const diff = target - current;
  if (diff === 0) return s;

  const movement: StockMovement = {
    id: localId('mvt'),
    stationId: level?.stationId ?? s.station?.id ?? '',
    productId,
    kind: diff > 0 ? 'inventory_adjustment' : 'consumption',
    qtyDelta: diff,
    unitCostMinor: level?.averageCostMinor ?? 0,
    referenceType: 'quick_adjustment',
    referenceId: null,
    idempotencyKey: localId('adj'),
    note: diff > 0 ? `Réapprovisionnement (+${diff})` : `Consommation / Ajustement (${diff})`,
    createdAt: nowISO(),
  };

  const nextLevels = s.stockLevels.map((l) =>
    l.productId === productId ? { ...l, qtyOnHand: target, valueMinor: target * l.averageCostMinor } : l
  );

  return withStockDefaults({
    ...s,
    stockLevels: nextLevels,
    stockMovements: [movement, ...s.stockMovements],
  });
}

