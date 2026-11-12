import { z } from 'zod';
import { ApiError, PAY_METHOD_DB_KEY } from '../types';
import type { WashPayload } from './store';
import type {
  CostCertificationPayload, CreatePurchaseOrderPayload, InventoryCountPayload,
  ProductPayload, ReceivePurchasePayload, ServiceConsumptionPayload, SupplierPayload,
} from './stock';
import type {
  CustomerProfilePayload, FleetContractPayload, FleetPayload, FleetReceivablePayload,
  PackagePlanPayload, PromotionPayload,
} from './crm';

// Contrat partagé par les formulaires et les commandes du store. La migration
// 055 impose les mêmes bornes indépendamment du navigateur. Aucun arrondi ni
// remplacement silencieux d'un champ vide par zéro pour les saisies numériques.
export const MAX_MONEY = 1_000_000_000_000;
export const MAX_QUANTITY = 1_000_000;
export const readNumber = (value: string): number => value.trim() === '' ? NaN : Number(value);

const moneyMessage = 'Le montant doit être un entier en FCFA entre 0 et 1 000 000 000 000.';
const quantityMessage = 'La quantité doit être un entier entre 1 et 1 000 000.';
const money = z.number({ error: moneyMessage })
  .refine(Number.isSafeInteger, moneyMessage).min(0, moneyMessage).max(MAX_MONEY, moneyMessage);
const positiveMoney = money.refine((v) => v > 0, 'Le montant doit être supérieur à zéro.');
const quantity = z.number({ error: quantityMessage })
  .refine(Number.isSafeInteger, quantityMessage).min(1, quantityMessage).max(MAX_QUANTITY, quantityMessage);
const nonNegativeQuantity = z.number({ error: 'La quantité doit être un entier positif ou nul.' })
  .refine(Number.isSafeInteger, 'La quantité doit être un entier positif ou nul.')
  .min(0, 'La quantité doit être positive ou nulle.').max(MAX_QUANTITY, 'La quantité dépasse 1 000 000.');
const percentage = z.number({ error: 'La remise doit être un pourcentage entier de 0 à 100.' })
  .refine(Number.isSafeInteger, 'La remise doit être un pourcentage entier de 0 à 100.')
  .min(0, 'La remise doit être comprise entre 0 et 100 %.').max(100, 'La remise doit être comprise entre 0 et 100 %.');
const requiredId = z.string().trim().min(1, 'Sélectionnez une valeur.');
const name = z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères.').max(200, 'Le nom est trop long.');
const phone = z.string().trim().refine((value) => !value || (
  value.length <= 40 && /^\+?[0-9 ()-]+$/.test(value)
  && /^[0-9]{7,15}$/.test(value.replace(/[^0-9]/g, ''))
), 'Téléphone invalide : saisissez 7 à 15 chiffres, avec indicatif et séparateurs facultatifs.');
const email = z.string().trim().refine((value) => !value || (
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
), 'Adresse e-mail invalide.');
const method = z.string().refine((v) => Object.prototype.hasOwnProperty.call(PAY_METHOD_DB_KEY, v), 'Moyen de paiement invalide.');

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}
const date = z.string().refine(isDate, 'Date invalide : utilisez une date réelle au format AAAA-MM-JJ.');
const optionalDate = date.nullable().optional().or(z.literal(''));
const contact = z.object({ phone: phone.optional(), email: email.optional() });

export const schemas = {
  money, positiveMoney, quantity, nonNegativeQuantity, percentage, phone, email, date,
  contact,
  expense: z.object({ amount: positiveMoney, category: name, reason: z.string().trim().min(2, 'Le motif doit contenir au moins 2 caractères.'),
    supplier: z.string().trim().max(200, 'Le fournisseur est trop long.'), date, method }),
  wash: z.object({ categoryId: requiredId, plate: z.string().max(100, 'La plaque est trop longue.'),
    clientName: z.string().max(200, 'Le nom du client est trop long.'),
    items: z.array(z.object({ serviceId: requiredId, qty: quantity })).min(1, 'Ajoutez au moins une prestation.'),
    discount: money, payment: z.object({ amount: money, method }).nullable().optional() }),
  customer: contact.extend({ stationId: requiredId, name }),
  plate: z.string().trim().max(100, 'La plaque est trop longue.'),
  supplier: contact.extend({ stationId: requiredId, name }),
  product: z.object({ stationId: requiredId, name, reorderLevel: nonNegativeQuantity.optional() }),
  order: z.object({ stationId: requiredId, number: name, orderedAt: date, expectedAt: optionalDate,
    lines: z.array(z.object({ productId: requiredId, qtyOrdered: quantity, unitCostMinor: money })).min(1, 'Ajoutez une ligne de commande.') }),
  receipt: z.object({ orderId: requiredId, lines: z.array(z.object({ productId: requiredId, qty: quantity,
    unitCostMinor: money.nullable().optional() })).min(1, 'Ajoutez une ligne de réception.') }),
  inventory: z.object({ sessionId: requiredId, productId: requiredId, countedQty: nonNegativeQuantity }),
  consumption: z.object({ serviceId: requiredId, productId: requiredId, qtyPerWash: z.number({ error: 'Quantité de consommation invalide.' })
    .min(0.001, 'La consommation doit être positive.').max(MAX_QUANTITY, 'Quantité de consommation trop élevée.')
    .refine((v) => Number.isSafeInteger(Math.round(v * 1000)) && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-7,
      'La consommation accepte au maximum trois décimales.') }),
  package: z.object({ stationId: requiredId, name, priceMinor: money, washCount: quantity, validityDays: quantity,
    startsAt: date.optional(), endsAt: optionalDate }),
  promotion: z.object({ stationId: requiredId, name, code: name, kind: z.enum(['percent', 'amount']),
    value: quantity, startsAt: date.optional(), endsAt: date.optional(), maxUsages: quantity.nullable().optional(),
    minAmountMinor: money.optional() }),
  fleet: contact.extend({ stationId: requiredId, name, creditLimitMinor: money.optional() }),
  fleetContract: z.object({ stationId: requiredId, fleetId: requiredId, number: name,
    startDate: date.optional(), endDate: date.optional(), discountPercent: percentage.optional(), creditLimitMinor: money.optional() }),
  fleetReceivable: z.object({ stationId: requiredId, fleetId: requiredId, contractId: requiredId,
    amountMinor: positiveMoney, dueDate: date.optional() }),
  certification: z.object({ start: date, end: date, attestation: z.string().trim().min(15, 'L’attestation doit contenir au moins 15 caractères.') }),
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError('invalid_form', result.error.issues[0]?.message ?? 'Formulaire invalide.');
  return result.data;
}

export const validateMoney = (value: number, positive = false): number => parse(positive ? positiveMoney : money, value);
export const validateQuantity = (value: number, allowZero = false): number => parse(allowZero ? nonNegativeQuantity : quantity, value);
export const validatePhone = (value: string): string => parse(phone, value);
export const validateEmail = (value: string): string => parse(email, value);
export const validatePercentage = (value: number): number => parse(percentage, value);
export const validateDate = (value: string): string => parse(date, value);
export const validatePlate = (value: string): string => parse(schemas.plate, value);

export function validatePeriod(start: string, end: string, maxDays?: number): void {
  validateDate(start); validateDate(end);
  if (end < start) throw new ApiError('invalid_period', 'La date de fin doit suivre la date de début.');
  if (maxDays !== undefined && (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 > maxDays) {
    throw new ApiError('invalid_period', `La période ne doit pas dépasser ${maxDays} jours d’écart.`);
  }
}
export function validateWash(p: WashPayload, gross: number): void {
  parse(schemas.wash, p);
  validateMoney(gross);
  if (p.discount > gross) throw new ApiError('invalid_discount', 'La remise ne peut pas dépasser le total des prestations.');
  if (p.payment && p.payment.amount > gross - p.discount) throw new ApiError('overpayment', 'L’encaissement dépasse le total de la fiche.');
}
export function validateExpense(p: unknown): void { parse(schemas.expense, p); }
export function validateCustomer(p: CustomerProfilePayload): void { parse(schemas.customer, p); }
export function validateSupplier(p: SupplierPayload): void { parse(schemas.supplier, p); }
export function validateProduct(p: ProductPayload): void { parse(schemas.product, p); }
export function validateOrder(p: CreatePurchaseOrderPayload): void {
  parse(schemas.order, p);
  if (p.expectedAt) validatePeriod(p.orderedAt, p.expectedAt);
}
export function validateReceipt(p: ReceivePurchasePayload): void { parse(schemas.receipt, p); }
export function validateInventory(p: InventoryCountPayload): void { parse(schemas.inventory, p); }
export function validateConsumption(p: ServiceConsumptionPayload): void { parse(schemas.consumption, p); }
export function validatePackage(p: PackagePlanPayload): void {
  parse(schemas.package, p);
  if (p.startsAt && p.endsAt) validatePeriod(p.startsAt, p.endsAt);
}
export function validatePromotion(p: PromotionPayload): void {
  parse(schemas.promotion, p);
  if (p.kind === 'percent' && p.value > 100) throw new ApiError('invalid_discount', 'La remise ne peut pas dépasser 100 %.');
  if (p.startsAt && p.endsAt) validatePeriod(p.startsAt, p.endsAt);
}
export function validateFleet(p: FleetPayload): void { parse(schemas.fleet, p); }
export function validateFleetContract(p: FleetContractPayload): void {
  parse(schemas.fleetContract, p);
  if (p.startDate && p.endDate) validatePeriod(p.startDate, p.endDate);
}
export function validateFleetReceivable(p: FleetReceivablePayload): void { parse(schemas.fleetReceivable, p); }
export function validateCertification(p: CostCertificationPayload): void {
  parse(schemas.certification, p); validatePeriod(p.start, p.end);
}
