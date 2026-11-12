import type { Client, Service, VehicleCategory } from '../types';
import type { CatalogSnapshot } from '../services/adapters/DataAdapter';

// ─── Projections serveur → état UI (Prompt 05) ──────────────────────────────
// Pures et synchrones : les UUID des tables Supabase deviennent les identifiants
// du domaine, sans jamais fabriquer de tarif ni de client local en mode branché.

export function mapCatalogToState(
  snapshot: CatalogSnapshot
): { vehicleCategories: VehicleCategory[]; services: Service[] } {
  const prices = new Map<string, Record<string, number>>();
  for (const price of snapshot.prices) {
    const byCategory = prices.get(price.serviceId) ?? {};
    byCategory[price.vehicleCategoryId] = price.priceMinor;
    prices.set(price.serviceId, byCategory);
  }
  return {
    vehicleCategories: snapshot.categories.map((c) => ({
      id: c.id,
      stationId: c.stationId,
      name: c.name,
      active: c.active,
    })),
    services: snapshot.services.map((s) => ({
      id: s.id,
      stationId: s.stationId,
      name: s.name,
      description: s.description,
      active: s.active,
      prices: prices.get(s.id) ?? {},
    })),
  };
}

/** `my_company_clients()` → fiches clients avec UUID serveur uniquement. */
export function mapClientRows(rows: unknown[]): Client[] {
  return rows.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('Ligne my_company_clients invalide.');
    }
    const r = entry as Record<string, unknown>;
    const str = (key: string): string => typeof r[key] === 'string' ? (r[key] as string).trim() : '';
    const id = str('id');
    if (!id) throw new Error('Identifiant client serveur absent.');
    return {
      id,
      stationId: str('stationId'),
      name: str('name'),
      phone: str('phone'),
      plate: str('plate'),
      notes: str('notes'),
      createdAt: str('createdAt') || new Date().toISOString(),
    };
  });
}
