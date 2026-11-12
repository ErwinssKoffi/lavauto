import { describe, expect, it } from 'vitest';
import {
  analyticsBoardFromState, emptyAnalyticsBoard, mapAnalyticsBoard,
  monthStartISO, previousPeriod,
} from '../../src/lib/analytics';
import type { AppState } from '../../src/types';

const now = new Date().toISOString();
const base = () => ({
  company: { id: 'co1', name: 'Clean Auto SARL', city: 'Abidjan', phone: '', createdAt: now, suspended: false },
  station: {
    id: 'st1', companyId: 'co1', name: 'Clean Auto Cocody', address: '', city: 'Abidjan', phone: '',
    currency: 'FCFA', logoPath: null, hours: [], paymentMethods: ['especes'], cashRequiresOpen: true,
    maxCashierDiscount: 2000, commissionRate: 10, monthlyTarget: 500000, activated: true, activatedAt: now,
  },
  users: [], vehicleCategories: [], services: [], clients: [],
  washes: [{
    id: 'w1', stationId: 'st1', number: 'L-0001', clientId: null, clientName: 'Client Test',
    vehicleCategoryId: 'c1', vehicleLabel: 'Berline', plate: '1234 AB 01', employeeId: 'u2',
    items: [{ serviceId: 's1', serviceName: 'Lavage extérieur', unitPrice: 3000, qty: 1 }],
    discount: 0, total: 3000, paid: 3000, status: 'ready', createdAt: now, finishedAt: now,
    cancelledReason: null, payments: [{ id: 'p1', amount: 3000, method: 'especes', at: now, byUserId: 'u2' }],
  }],
  washPosts: [], cashSessions: [], expenses: [],
  subscription: { id: 'sub1', companyId: 'co1', planId: 'essai', status: 'essai', startedAt: now, trialEndsAt: now, pendingPlanId: null },
  auditLogs: [], platformCompanies: [],
  session: { userId: 'u1', email: 'owner@test.invalid', name: 'Owner', role: 'proprietaire', companyId: 'co1', stationId: 'st1' },
  demoMode: true, washCounter: 1,
}) as unknown as AppState;

describe('Prompt 10 — règles analytics pures', () => {
  it('monthStartISO renvoie le premier jour du mois', () => {
    expect(monthStartISO(new Date('2026-11-11T10:00:00Z'))).toBe('2026-11-01');
  });

  it('previousPeriod conserve la même durée', () => {
    const previous = previousPeriod('2026-11-01', '2026-11-12');
    expect(previous.start).toBe('2026-10-20');
    expect(previous.end).toBe('2026-10-31');
  });

  it('emptyAnalyticsBoard ne fabrique aucune station ni tendance', () => {
    const board = emptyAnalyticsBoard();
    expect(board.stations).toEqual([]);
    expect(board.trend).toEqual([]);
    expect(board.compare).toBeNull();
  });

  it('analyticsBoardFromState calcule CA 3000 et delta 3000', () => {
    const start = monthStartISO();
    const end = new Date().toISOString().slice(0, 10);
    const previous = previousPeriod(start, end);
    const board = analyticsBoardFromState(base(), start, end, previous.start, previous.end);
    expect(board.period.revenue).toBe(3000);
    expect(board.compare?.revenue).toBe(0);
    expect(board.compareDelta).toBe(3000);
  });

  it('mapAnalyticsBoard préserve les résultats nets NULL', () => {
    const start = monthStartISO();
    const end = new Date().toISOString().slice(0, 10);
    const board = analyticsBoardFromState(base(), start, end, null, null);
    expect(board.stations[0].grossMargin).toBeNull();
    expect(board.stations[0].result).toBeNull();
    expect(mapAnalyticsBoard(board).stations[0].grossMargin).toBeNull();
  });
});
