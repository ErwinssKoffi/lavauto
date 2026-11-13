import { describe, expect, it } from 'vitest';
import { mapStationSetup } from '../../src/services/adapters/SupabaseDataAdapter';

const station = 'station-1';
const company = 'company-1';
function setup(): Record<string, any> {
  return {
    company: { id: company, name: 'Entreprise test', city: 'Abidjan', phone: '', createdAt: '2026-01-01T00:00:00Z', suspended: false },
    station: { id: station, companyId: company, name: 'Station test', address: '', city: 'Abidjan', phone: '', hours: [],
      logoPath: null, paymentMethods: ['wave'], commissionRate: 10, monthlyTarget: 15000, activated: true, activatedAt: null },
    categories: [{ id: 'category-1', station_id: station, name: 'Berline', active: true }],
    services: [{ id: 'service-1', station_id: station, name: 'Lavage', description: '', active: true }],
    prices: [{ station_id: station, service_id: 'service-1', vehicle_category_id: 'category-1', price_minor: 3000, currency_code: 'XOF' }],
  };
}

describe('lecture serveur de la configuration station', () => {
  it('conserve les prix et les moyens effectivement reçus', () => {
    const result = mapStationSetup(setup(), station);
    expect(result.station.paymentMethods).toEqual(['wave']);
    expect(result.station.commissionRate).toBe(10);
    expect(result.catalog.prices[0].priceMinor).toBe(3000);
  });

  it.each([
    ['station différente', (v: ReturnType<typeof setup>) => { v.station.id = 'other'; }],
    ['entreprise différente', (v: ReturnType<typeof setup>) => { v.station.companyId = 'other'; }],
    ['activation absente', (v: ReturnType<typeof setup>) => { delete v.station.activated; }],
    ['horaires illisibles', (v: ReturnType<typeof setup>) => { v.station.hours = [{ day: 'Lundi', open: '08:00', close: '18:00', closed: 'non' }]; }],
    ['canal inconnu', (v: ReturnType<typeof setup>) => { v.station.paymentMethods = ['wave', 'inconnu']; }],
    ['canal dupliqué', (v: ReturnType<typeof setup>) => { v.station.paymentMethods = ['wave', 'wave']; }],
    ['commission négative', (v: ReturnType<typeof setup>) => { v.station.commissionRate = -1; }],
    ['commission fractionnaire', (v: ReturnType<typeof setup>) => { v.station.commissionRate = 1.5; }],
    ['objectif excessif', (v: ReturnType<typeof setup>) => { v.station.monthlyTarget = 1_000_000_000_001; }],
    ['catégorie dupliquée', (v: ReturnType<typeof setup>) => { v.categories.push({ ...v.categories[0] }); }],
    ['prestation dupliquée', (v: ReturnType<typeof setup>) => { v.services.push({ ...v.services[0] }); }],
    ['prix dupliqué', (v: ReturnType<typeof setup>) => { v.prices.push({ ...v.prices[0] }); }],
    ['prix fractionnaire', (v: ReturnType<typeof setup>) => { v.prices[0].price_minor = 100.5; }],
    ['prix texte', (v: ReturnType<typeof setup>) => { v.prices[0].price_minor = '3000'; }],
    ['devise absente', (v: ReturnType<typeof setup>) => { delete v.prices[0].currency_code; }],
    ['catégorie inexistante', (v: ReturnType<typeof setup>) => { v.prices[0].vehicle_category_id = 'other'; }],
    ['prestation inexistante', (v: ReturnType<typeof setup>) => { v.prices[0].service_id = 'other'; }],
    ['ligne hors station', (v: ReturnType<typeof setup>) => { v.services[0].station_id = 'other'; }],
    ['état de catégorie absent', (v: ReturnType<typeof setup>) => { delete v.categories[0].active; }],
    ['description absente', (v: ReturnType<typeof setup>) => { delete v.services[0].description; }],
  ])('rejette %s sans inventer de configuration', (_name, change) => {
    const value = setup(); change(value);
    expect(() => mapStationSetup(value, station)).toThrow();
  });
});
