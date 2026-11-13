import { describe, expect, it } from 'vitest';
import { baseState } from '../../e2e/fixtures/state';
import { mapPlatformBoard, platformBoardFromState, quotaMonthStartISO, subscriptionUsageFromState } from '../../src/lib/analytics';
import { clonePlans } from '../../src/lib/plans';
import type { AppState } from '../../src/types';

describe('quotas et tableau plateforme', () => {
  it('utilise un mois calendaire UTC, même pour des dates munies d’un fuseau', () => {
    expect(quotaMonthStartISO(new Date('2026-12-01T13:59:59.999+14:00'))).toBe('2026-11-01');
    expect(quotaMonthStartISO(new Date('2026-12-01T14:00:00+14:00'))).toBe('2026-12-01');
    const state = baseState() as unknown as AppState;
    const wash = state.washes[0];
    state.washes = [
      { ...wash, id: 'before', createdAt: '2026-11-30T23:59:59.999Z' },
      { ...wash, id: 'first', createdAt: '2026-12-01T14:00:00+14:00' },
      { ...wash, id: 'last', createdAt: '2026-12-31T23:59:59.999Z' },
      { ...wash, id: 'after', createdAt: '2027-01-01T00:00:00Z' },
      { ...wash, id: 'cancelled', createdAt: '2026-12-15T00:00:00Z', status: 'cancelled' },
    ];
    expect(subscriptionUsageFromState(state, '2026-12-01').usage.washes).toBe(2);
  });

  it('détecte également le dépassement de comptes dans la plateforme locale', () => {
    const state = baseState() as unknown as AppState;
    state.platformCompanies[0] = { ...state.platformCompanies[0], planId: 'essai', employeeCount: 4 };
    const board = platformBoardFromState(state, clonePlans());
    expect(board.companies[0].quota.quotaExceeded).toBe(true);
    expect(board.stats.quotasExceeded).toBe(1);
  });

  it('conserve le motif serveur et une limite manquante sans la remplacer par zéro', () => {
    const board = mapPlatformBoard({
      companies: [{ companyId: 'co1', name: 'Test', city: '', phone: '', suspended: false,
        status: 'lecture seule', planId: 'standard', planName: 'Standard', subscriptionStatus: 'active',
        subscriptionStartedAt: '2026-11-01', subscriptionReason: 'period_expired',
        stationCount: 1, employeeCount: 3, washesMonth: 2, monthlyRevenue: 2000,
        companyCreatedAt: '2026-11-01', limits: { stations: 1, employees: null, washesPerMonth: 1000 },
        quota: { stationsUsed: 1, employeesUsed: 3, washesMonthUsed: 2, quotaExceeded: false } }],
      plans: [], planLimits: [], subscriptionUsage: [], auditLogs: [], stats: {}, rules: {},
    });
    expect(board.companies[0].subscriptionReason).toBe('period_expired');
    expect(board.companies[0].limits.employees).toBeNull();
    expect(board.companies[0].employeeCount).toBe(3);
  });
});
