import type { AppState } from '../types';

/** Clés strictement locales : ce fichier ne lit jamais de jeton Supabase. */
export const DEMO_STATE_KEY = 'washguard.state.v1';
export const DEMO_PASSWORDS_KEY = 'washguard.demo-passwords.v1';
const DEMO_STORAGE_LOCK = 'washguard.demo-storage.v1';

/** Même verrou inter-onglets pour l'inscription, les écritures et l'effacement.
 * Sans Web Locks, aucune écriture n'est présumée sûre. */
export async function withDemoStorageLock<T>(action: () => T | Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    throw new Error('Protection multi-onglets indisponible : utilisez un navigateur récent avant de modifier les données locales.');
  }
  return navigator.locks.request(DEMO_STORAGE_LOCK, { mode: 'exclusive' }, action);
}

/** La session locale ne figure jamais dans la copie enregistrée. */
export function serializeDemoState(state: AppState): string {
  const { session: _ignored, ...withoutSession } = state;
  return JSON.stringify(withoutSession);
}

/** Vérifie aussi le résultat, afin de ne pas annoncer une conservation fictive. */
export function writeDemoState(raw: string): void {
  localStorage.setItem(DEMO_STATE_KEY, raw);
  if (localStorage.getItem(DEMO_STATE_KEY) !== raw) throw new Error('Écriture locale non confirmée.');
}

const collectionKeys: (keyof AppState)[] = [
  'users', 'vehicleCategories', 'services', 'clients', 'washes', 'washPosts', 'cashSessions',
  'cashMovements', 'cashClosures', 'expenses', 'paymentMethods', 'reconciliations',
  'commissionPeriods', 'commissionLines', 'commissionPayouts', 'paymentCancellations',
  'productCategories', 'suppliers', 'products', 'purchaseOrders', 'purchaseOrderItems',
  'stockLevels', 'stockMovements', 'inventorySessions', 'inventoryItems', 'stockServices',
  'serviceConsumptions', 'receiptEvents', 'consumptionRuns', 'costCertifications', 'stockAlerts',
  'vehicles', 'loyaltyPrograms', 'loyaltyCards', 'loyaltyTransactions', 'packagePlans',
  'customerPackages', 'packageUsages', 'promotions', 'promotionUsages', 'fleets',
  'fleetContracts', 'fleetVehicles', 'fleetReceivables', 'notificationOutbox', 'auditLogs',
  'platformCompanies',
];

// Si une ancienne structure passe le contrôle superficiel mais échoue pendant
// sa normalisation, conserver sa version exacte au lieu de la remplacer par {}.
let protectedRaw: string | null = null;
export function protectDemoState(raw: string): void { protectedRaw = raw; }

type DemoStateRead =
  | { status: 'empty'; raw: null; value: null }
  | { status: 'ok'; raw: string; value: Partial<AppState> }
  | { status: 'unreadable'; raw: string; value: null }
  | { status: 'unavailable'; raw: null; value: null };

export function readDemoState(storage?: Pick<Storage, 'getItem'>): DemoStateRead {
  let raw: string | null;
  // Le getter window.localStorage lui-même peut lever SecurityError.
  try { raw = (storage ?? window.localStorage).getItem(DEMO_STATE_KEY); } catch { return { status: 'unavailable', raw: null, value: null }; }
  if (raw === null) return { status: 'empty', raw: null, value: null };
  if (raw === protectedRaw) return { status: 'unreadable', raw, value: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid state');
    const record = value as Record<string, unknown>;
    for (const key of collectionKeys) {
      if (record[key] != null && !Array.isArray(record[key])) throw new Error('invalid collection');
    }
    for (const key of ['company', 'station'] as const) {
      const part = record[key];
      if (part != null && (typeof part !== 'object' || Array.isArray(part))) throw new Error('invalid record');
    }
    return { status: 'ok', raw, value: record as Partial<AppState> };
  } catch {
    return { status: 'unreadable', raw, value: null };
  }
}

export interface DemoBackup {
  format: 'washguard-local-backup-v1';
  exportedAt: string;
  origin: string;
  /** Valeurs brutes, y compris lorsqu'elles sont illisibles. Null signifie clé absente. */
  entries: Record<typeof DEMO_STATE_KEY | typeof DEMO_PASSWORDS_KEY, string | null>;
}

export function createDemoBackup(
  storage?: Pick<Storage, 'getItem'>,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
): DemoBackup {
  // Ne pas masquer une erreur de lecture : une copie partielle ne doit jamais
  // être présentée comme une sauvegarde complète.
  const source = storage ?? window.localStorage;
  return {
    format: 'washguard-local-backup-v1',
    exportedAt: new Date().toISOString(),
    origin,
    entries: {
      [DEMO_STATE_KEY]: source.getItem(DEMO_STATE_KEY),
      [DEMO_PASSWORDS_KEY]: source.getItem(DEMO_PASSWORDS_KEY),
    },
  };
}

export function downloadDemoBackup(): void {
  const backup = createDemoBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `washguard-demonstration-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
