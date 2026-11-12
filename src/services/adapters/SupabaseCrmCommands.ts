import { validateCustomer, validatePackage, validatePromotion, validateFleet, validateFleetContract, validateFleetReceivable, validateQuantity, validateDate, validatePlate } from '../../lib/validation';
import type {
  AttachFleetVehiclePayload, CustomerProfilePayload, CustomerVehiclePayload,
  FleetContractPayload, FleetPayload, FleetReceivablePayload,
  LoyaltyAccrualResult, LoyaltyEnrollmentPayload, LoyaltyProgramPayload,
  LoyaltyTransactionPayload, NotificationPayload, PackageConsumptionResult,
  PackagePlanPayload, PackageSalePayload, PromotionApplicationPayload,
  PromotionApplicationResult, PromotionPayload,
} from '../../lib/crm';
import { todayISO } from '../../lib/format';
import type { CrmCommands } from './DataAdapter';
import type { SupabaseReader, SupabaseResult } from './SupabaseDataAdapter';

// ─── Prompt 08 : 17 commandes CRM via RPC SECURITY DEFINER ───────────────────
// Aucun identifiant de tenant n'est envoyé : le serveur le déduit du JWT.
// Aucune écriture directe de table, aucun fournisseur de communication, aucun
// envoi simulé : la notification reste une ligne `pending` dans l'outbox.

function rpcData(result: SupabaseResult<unknown>, name: string): unknown {
  if (result.error) throw new Error(`RPC ${name} : ${result.error.message}`);
  return result.data;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Réponse ${name} invalide.`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function flag(value: unknown): boolean {
  return value === true;
}

function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class SupabaseCrmCommands implements CrmCommands {
  constructor(private readonly client: SupabaseReader) {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return rpcData(await this.client.rpc(name, args), name);
  }

  private async callId(name: string, args: Record<string, unknown>): Promise<string> {
    return id(await this.call(name, args));
  }

  async saveCustomerProfile(p: CustomerProfilePayload): Promise<string> {
    validateCustomer(p);
    return this.callId('save_customer_profile', {
      p_station_id: p.stationId, p_name: p.name,
      p_phone: p.phone ?? '', p_email: p.email ?? '', p_notes: p.notes ?? '',
      p_channel: p.channel ?? 'none', p_loyalty_opt_in: p.loyaltyOptIn ?? false,
      p_customer_id: p.customerId ?? null, p_fleet_id: p.fleetId ?? null,
    });
  }

  async saveCustomerVehicle(p: CustomerVehiclePayload): Promise<string> {
    validatePlate(p.plate);
    return this.callId('save_customer_vehicle', {
      p_station_id: p.stationId, p_customer_id: p.customerId, p_plate: p.plate,
      p_brand: p.brand ?? '', p_model: p.model ?? '', p_color: p.color ?? '',
      p_category_id: p.categoryId ?? null, p_vehicle_id: p.vehicleId ?? null,
    });
  }

  async createLoyaltyProgram(p: LoyaltyProgramPayload): Promise<string> {
    validateQuantity(p.pointsPer1000Minor); validateQuantity(p.redemptionThreshold);
    return this.callId('create_loyalty_program', {
      p_station_id: p.stationId, p_name: p.name,
      p_points_per_1000_minor: p.pointsPer1000Minor,
      p_redemption_threshold: p.redemptionThreshold,
      p_active: p.active ?? true,
    });
  }

  async enrollLoyaltyCustomer(p: LoyaltyEnrollmentPayload): Promise<string> {
    return this.callId('enroll_loyalty_customer', {
      p_station_id: p.stationId, p_customer_id: p.customerId,
      p_program_id: p.programId, p_card_number: p.cardNumber ?? '',
    });
  }

  async recordLoyaltyTransaction(p: LoyaltyTransactionPayload): Promise<string> {
    return this.callId('record_loyalty_transaction', {
      p_card_id: p.cardId, p_kind: p.kind, p_points_delta: p.pointsDelta,
      p_reason: p.reason ?? '', p_wash_id: p.washId ?? null,
      p_idempotency_key: p.idempotencyKey ?? null,
    });
  }

  async accrueLoyaltyForWash(washId: string, idempotencyKey?: string | null): Promise<LoyaltyAccrualResult> {
    const data = record(await this.call('accrue_loyalty_for_wash', {
      p_wash_id: washId, p_idempotency_key: idempotencyKey ?? null,
    }), 'accrue_loyalty_for_wash');
    return {
      points: num(data.points), duplicate: flag(data.duplicate),
      applied: !flag(data.duplicate) && num(data.points) > 0,
      reason: typeof data.reason === 'string' ? data.reason : null,
    };
  }

  async savePackagePlan(p: PackagePlanPayload): Promise<string> {
    validatePackage(p);
    return this.callId('save_package_plan', {
      p_station_id: p.stationId, p_name: p.name,
      p_price_minor: p.priceMinor, p_wash_count: p.washCount,
      p_validity_days: p.validityDays,
      p_starts_at: p.startsAt ?? todayISO(), p_ends_at: p.endsAt ?? null,
      p_active: p.active ?? true,
    });
  }

  async sellPackageToCustomer(p: PackageSalePayload): Promise<string> {
    if (p.purchasedAt) validateDate(p.purchasedAt);
    return this.callId('sell_package_to_customer', {
      p_station_id: p.stationId, p_customer_id: p.customerId,
      p_package_id: p.packageId, p_purchased_at: p.purchasedAt ?? null,
      p_idempotency_key: p.idempotencyKey ?? null,
    });
  }

  async consumePackageForWash(washId: string): Promise<PackageConsumptionResult> {
    const data = record(await this.call('consume_package_for_wash', {
      p_wash_id: washId,
    }), 'consume_package_for_wash');
    return {
      consumed: flag(data.consumed), duplicate: flag(data.duplicate),
      remaining: num(data.remaining),
      reason: typeof data.reason === 'string' ? data.reason : null,
      customerPackageId: typeof data.customerPackageId === 'string' ? data.customerPackageId : null,
    };
  }

  async savePromotion(p: PromotionPayload): Promise<string> {
    validatePromotion(p);
    return this.callId('save_promotion', {
      p_station_id: p.stationId, p_name: p.name, p_code: p.code,
      p_kind: p.kind, p_value: p.value,
      p_starts_at: p.startsAt ?? todayISO(),
      p_ends_at: p.endsAt ?? plusDays(p.startsAt ?? todayISO(), 30),
      p_max_usages: p.maxUsages ?? null,
      p_min_amount_minor: p.minAmountMinor ?? 0,
      p_active: p.active ?? true,
    });
  }

  async applyPromotionToWash(p: PromotionApplicationPayload): Promise<PromotionApplicationResult> {
    const data = record(await this.call('apply_promotion_to_wash', {
      p_wash_id: p.washId, p_code: p.code,
      p_idempotency_key: p.idempotencyKey ?? null,
    }), 'apply_promotion_to_wash');
    return {
      applied: flag(data.applied), duplicate: flag(data.duplicate),
      discountMinor: num(data.discountMinor),
      promotionId: typeof data.promotionId === 'string' ? data.promotionId : null,
    };
  }

  async saveFleet(p: FleetPayload): Promise<string> {
    validateFleet(p);
    return this.callId('save_fleet', {
      p_station_id: p.stationId, p_name: p.name,
      p_contact_name: p.contactName ?? '', p_phone: p.phone ?? '',
      p_email: p.email ?? '', p_credit_limit_minor: p.creditLimitMinor ?? 0,
      p_channel: p.channel ?? 'none', p_active: p.active ?? true,
    });
  }

  async saveFleetContract(p: FleetContractPayload): Promise<string> {
    validateFleetContract(p);
    return this.callId('save_fleet_contract', {
      p_station_id: p.stationId, p_fleet_id: p.fleetId, p_number: p.number,
      p_start_date: p.startDate ?? todayISO(),
      p_end_date: p.endDate ?? plusDays(p.startDate ?? todayISO(), 365),
      p_discount_percent: p.discountPercent ?? 0,
      p_credit_limit_minor: p.creditLimitMinor ?? 0,
      p_status: p.status ?? 'active',
    });
  }

  async attachFleetVehicle(p: AttachFleetVehiclePayload): Promise<string> {
    return this.callId('attach_fleet_vehicle', {
      p_station_id: p.stationId, p_fleet_id: p.fleetId,
      p_vehicle_id: p.vehicleId, p_contract_id: p.contractId ?? null,
    });
  }

  async recordFleetReceivable(p: FleetReceivablePayload): Promise<string> {
    validateFleetReceivable(p);
    return this.callId('record_fleet_receivable', {
      p_station_id: p.stationId, p_fleet_id: p.fleetId,
      p_contract_id: p.contractId, p_amount_minor: p.amountMinor,
      p_wash_id: p.washId ?? null, p_due_date: p.dueDate ?? null,
      p_idempotency_key: p.idempotencyKey ?? null,
    });
  }

  async enqueueNotification(p: NotificationPayload): Promise<string> {
    return this.callId('enqueue_notification', {
      p_station_id: p.stationId, p_template_key: p.templateKey,
      p_customer_id: p.customerId ?? null, p_fleet_id: p.fleetId ?? null,
      p_payload: p.payload ?? {}, p_idempotency_key: p.idempotencyKey ?? null,
    });
  }

  async cancelPendingNotification(notificationId: string): Promise<void> {
    await this.call('cancel_pending_notification', { p_notification_id: notificationId });
  }
}
