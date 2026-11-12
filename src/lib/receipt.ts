import type { Company, PaymentCancellation, Station, Wash } from '../types';
import type { StationSummary } from '../services/auth/authTypes';
import { WASH_STATUS_LABELS, PAY_METHOD_LABELS } from '../types';

/** Instantané explicite : les modifications ultérieures exigent un nouveau reçu. */
export interface WashReceipt {
  number: string;
  issuedAt: string;
  createdAt: string;
  companyName: string | null;
  stationName: string;
  stationCity: string | null;
  stationAddress: string | null;
  stationPhone: string | null;
  clientName: string | null;
  vehicleLabel: string;
  plate: string;
  status: string;
  isCancelled: boolean;
  items: { name: string; unitPrice: number; quantity: number; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  payments: { id: string; amount: number; method: string; at: string; cancelled: boolean; cancelledAt: string | null }[];
  inconsistencies: string[];
}

export function buildWashReceipt(
  wash: Wash,
  company: Company | null,
  selectedStation: Station | null,
  accessibleStations: StationSummary[] = [],
  cancellations: PaymentCancellation[] = [],
  issuedAt = new Date().toISOString(),
): WashReceipt {
  // Le board connecté peut couvrir plusieurs stations : ne jamais attribuer à
  // une fiche les coordonnées de la station actuellement sélectionnée à tort.
  const selectedMatches = selectedStation?.id === wash.stationId;
  const summary = accessibleStations.find((station) => station.id === wash.stationId);
  const stationName = selectedMatches ? selectedStation.name : summary?.name ?? 'Station non renseignée';
  const items = wash.items.map((item) => ({
    name: item.serviceName, unitPrice: item.unitPrice, quantity: item.qty,
    amount: item.unitPrice * item.qty,
  }));
  const payments = wash.payments.map((payment) => {
    const cancellation = cancellations.find((entry) => entry.paymentId === payment.id);
    return {
      id: payment.id, amount: payment.amount, method: PAY_METHOD_LABELS[payment.method],
      at: payment.at, cancelled: Boolean(payment.cancelledAt || cancellation),
      cancelledAt: payment.cancelledAt ?? cancellation?.at ?? null,
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const activePaid = payments.filter((payment) => !payment.cancelled).reduce((sum, payment) => sum + payment.amount, 0);
  const inconsistencies: string[] = [];
  if (subtotal - wash.discount !== wash.total) {
    inconsistencies.push('Les prestations et la remise ne concordent pas avec le total enregistré. Vérifier la fiche avant remise au client.');
  }
  if (activePaid !== wash.paid) {
    inconsistencies.push('Les paiements actifs ne concordent pas avec le montant encaissé enregistré. Vérifier la fiche avant remise au client.');
  }
  return {
    number: wash.number, issuedAt, createdAt: wash.createdAt,
    companyName: company?.name || null,
    stationName,
    stationCity: (selectedMatches ? selectedStation.city : summary?.city) || null,
    stationAddress: selectedMatches ? selectedStation.address || null : null,
    stationPhone: selectedMatches ? selectedStation.phone || null : null,
    clientName: wash.clientName || null, vehicleLabel: wash.vehicleLabel,
    plate: wash.plate, status: WASH_STATUS_LABELS[wash.status], isCancelled: wash.status === 'cancelled',
    items, subtotal, discount: wash.discount, total: wash.total, paid: wash.paid,
    balance: Math.max(0, wash.total - wash.paid), payments, inconsistencies,
  };
}

export function receiptFilename(number: string): string {
  const slug = number.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return `recu-${slug || 'lavage'}.pdf`;
}
