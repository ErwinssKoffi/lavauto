import { describe, expect, it } from 'vitest';
import { emptyAnalyticsBoard, mapAnalyticsBoard, redactStockAnalytics } from '../../src/lib/analytics';
import { mapProfitability, redactStockProfitability } from '../../src/lib/finance';

const premiumReport = {
  periodStart: '2026-11-01', periodEnd: '2026-11-12',
  revenue: 12000, collected: 9000, receivables: 3000, expenses: 4000,
  purchases: 2468, consumptions: 1234, operatingExpenses: 3500, commissions: 500, fixedCosts: 1000,
  partialBalance: 5000, grossMargin: 10766, result: 6766, costsMissing: false, certified: true,
  certifiedAt: '2026-11-12T09:00:00Z', attestation: 'Attestation confidentielle',
  label: 'Certifié', missing: [], definitions: {},
};

describe('coûts exclus d’une formule', () => {
  it('préserve les valeurs masquées ou absentes au mapping sans fabriquer zéro', () => {
    const raw = { ...premiumReport, purchases: null, consumptions: null,
      operatingExpenses: null, fixedCosts: null, grossMargin: null, result: null };
    const report = mapProfitability(raw);
    expect(report).toMatchObject({ purchases: null, consumptions: null, operatingExpenses: null,
      fixedCosts: null, grossMargin: null, result: null, revenue: 12000, expenses: 4000 });
    expect(mapProfitability({ ...raw, purchases: undefined, consumptions: 'non-numérique' }).purchases).toBeNull();
    expect(mapProfitability({ ...raw, purchases: '0' }).purchases).toBe(0);
  });

  it('occulte la copie affichée en local sans détruire les données conservées', () => {
    const original = mapProfitability(premiumReport);
    const masked = redactStockProfitability(original);
    expect(masked).toMatchObject({ purchases: null, consumptions: null, operatingExpenses: null,
      fixedCosts: null, grossMargin: null, result: null, certified: false, costsMissing: true,
      certifiedAt: null, attestation: null, revenue: 12000, partialBalance: 5000 });
    expect(original).toMatchObject({ purchases: 2468, consumptions: 1234, result: 6766,
      certified: true, attestation: 'Attestation confidentielle' });
  });

  it('occulte les deux périodes et chaque station sans détruire le board conservé', () => {
    const original = mapAnalyticsBoard({ ...emptyAnalyticsBoard('2026-11-01', '2026-11-12'),
      period: premiumReport, compare: premiumReport, stats: { certified: true, revenue: 12000 }, stations: [{
        rank: 1, stationId: 'st', name: 'Station', city: 'Abidjan', revenue: 12000,
        collected: 9000, receivables: 3000, expenses: 4000, consumptions: 1234,
        partialBalance: 5000, washCount: 3, grossMargin: 10766, result: 6766, certified: true,
      }] });
    const masked = redactStockAnalytics(original);
    expect(masked.period).toMatchObject({ purchases: null, consumptions: null, result: null, certified: false, attestation: null, revenue: 12000 });
    expect(masked.compare).toMatchObject({ consumptions: null, result: null, certified: false, attestation: null });
    expect(masked.stations[0]).toMatchObject({ consumptions: null, grossMargin: null, result: null, certified: false, revenue: 12000 });
    expect(masked.stats.certified).toBe(false);
    expect(original.period).toMatchObject({ consumptions: 1234, result: 6766, certified: true, attestation: 'Attestation confidentielle' });
    expect(original.stations[0].consumptions).toBe(1234);
    expect(original.stats.certified).toBe(true);
  });

  it('préserve également NULL dans la consolidation par station', () => {
    const board = emptyAnalyticsBoard('2026-11-01', '2026-11-12');
    const mapped = mapAnalyticsBoard({ ...board, period: { ...premiumReport, consumptions: null }, stations: [{
      rank: 1, stationId: 'st', name: 'Station', city: 'Abidjan', revenue: 12000,
      collected: 9000, receivables: 3000, expenses: 4000, consumptions: null,
      partialBalance: 5000, washCount: 3, grossMargin: null, result: null, certified: false,
    }] });
    expect(mapped.period.consumptions).toBeNull();
    expect(mapped.stations[0].consumptions).toBeNull();
  });
});
