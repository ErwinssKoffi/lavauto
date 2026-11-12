import { validateSupplier, validateProduct, validateOrder, validateReceipt, validateInventory, validateConsumption, validateCertification } from '../../lib/validation';
import type { StockCommands } from './DataAdapter';
import type {
  CostCertificationPayload, CreatePurchaseOrderPayload,
  InventoryCountPayload, ProductPayload, ReceivePurchasePayload,
  ServiceConsumptionPayload, SupplierPayload,
} from '../../lib/stock';
import type { SupabaseReader, SupabaseResult } from './SupabaseDataAdapter';

// Toutes les mutations P07 passent par les RPC SECURITY DEFINER 030–033.
// Aucun INSERT/UPDATE/DELETE de table, aucun identifiant de tenant fourni par
// l'UI : le tenant et l'utilisateur sont déduits du JWT côté serveur.

export class SupabaseStockCommands implements StockCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error }: SupabaseResult<unknown> = await this.client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }

  async saveSupplier(p: SupplierPayload): Promise<string> {
    validateSupplier(p);
    const data = await this.rpc('save_supplier', {
      p_station_id: p.stationId,
      p_name: p.name.trim(),
      p_phone: p.phone ?? '',
      p_email: p.email ?? '',
      p_address: p.address ?? '',
      p_active: p.active ?? true,
      p_id: p.id ?? null,
    });
    return String(data);
  }

  async saveProduct(p: ProductPayload): Promise<string> {
    validateProduct(p);
    const data = await this.rpc('save_product', {
      p_station_id: p.stationId,
      p_name: p.name.trim(),
      p_sku: (p.sku ?? '').trim(),
      p_category: (p.category ?? '').trim(),
      p_unit: (p.unit ?? '').trim() || 'unité',
      p_reorder_level: p.reorderLevel ?? 0,
      p_active: p.active ?? true,
      p_id: p.id ?? null,
    });
    return String(data);
  }

  async createPurchaseOrder(p: CreatePurchaseOrderPayload): Promise<string> {
    validateOrder(p);
    const data = await this.rpc('create_purchase_order', {
      p_station_id: p.stationId,
      p_number: p.number.trim(),
      p_lines: p.lines.map((l) => ({
        product_id: l.productId,
        qty_ordered: l.qtyOrdered,
        unit_cost_minor: l.unitCostMinor,
      })),
      p_supplier_id: p.supplierId ?? null,
      p_ordered_at: p.orderedAt.slice(0, 10),
      p_expected_at: p.expectedAt ? p.expectedAt.slice(0, 10) : null,
      p_idempotency_key: p.idempotencyKey,
    });
    return String(data);
  }

  async receivePurchaseLines(p: ReceivePurchasePayload): Promise<void> {
    validateReceipt(p);
    await this.rpc('receive_purchase_lines', {
      p_order_id: p.orderId,
      p_lines: p.lines.map((l) => ({
        product_id: l.productId,
        qty: l.qty,
        ...(l.unitCostMinor === null || l.unitCostMinor === undefined
          ? {} : { unit_cost_minor: l.unitCostMinor }),
      })),
      p_receipt_key: p.receiptKey,
    });
  }

  async startInventory(stationId: string): Promise<string> {
    const data = await this.rpc('start_inventory_session', { p_station_id: stationId });
    return String(data);
  }

  async recordInventoryCount(p: InventoryCountPayload): Promise<void> {
    validateInventory(p);
    await this.rpc('record_inventory_count', {
      p_session_id: p.sessionId,
      p_product_id: p.productId,
      p_counted_qty: p.countedQty,
      p_reason: p.reason ?? '',
    });
  }

  async closeInventory(sessionId: string): Promise<void> {
    await this.rpc('close_inventory_session', { p_session_id: sessionId });
  }

  async saveServiceConsumption(p: ServiceConsumptionPayload): Promise<string> {
    validateConsumption(p);
    const data = await this.rpc('save_service_consumption', {
      p_service_id: p.serviceId,
      p_product_id: p.productId,
      p_qty_per_wash: p.qtyPerWash,
      p_active: p.active ?? true,
    });
    return String(data);
  }

  async consumeWash(washId: string): Promise<void> {
    await this.rpc('consume_products_for_wash', { p_wash_id: washId });
  }

  async linkExpenseToOrder(expenseId: string, orderId: string): Promise<void> {
    await this.rpc('link_expense_to_purchase_order', {
      p_expense_id: expenseId,
      p_order_id: orderId,
    });
  }

  async certifyCosts(p: CostCertificationPayload): Promise<void> {
    validateCertification(p);
    await this.rpc('certify_profitability_period', {
      p_start: p.start.slice(0, 10),
      p_end: p.end.slice(0, 10),
      p_attestation: p.attestation.trim(),
    });
  }
}
