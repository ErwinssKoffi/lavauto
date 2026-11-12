import { describe, expect, it } from 'vitest';
import { formatDate, formatFCFA, todayISO } from '../../src/lib/format';
import { LOGO_MAX_EDGE, logoObjectName } from '../../src/lib/image';
import {
  mapPlatformBoard, platformBoardFromState, subscriptionUsageFromState,
} from '../../src/lib/analytics';
import type { AppState } from '../../src/types';

const now = new Date().toISOString();
const base = () => ({
  company: { id: 'co1', name: 'Clean Auto SARL', city: 'Abidjan', phone: '', createdAt: now, suspended: false },
  station: null,
  users: [], vehicleCategories: [], services: [], clients: [],
  washes: [{
    id: 'w1', stationId: 'st1', number: 'L-0001', clientId: null, clientName: 'Client Test',
    vehicleCategoryId: 'c1', vehicleLabel: 'Berline', plate: '1234 AB 01', employeeId: 'u2',
    items: [], discount: 0, total: 3000, paid: 3000, status: 'ready', createdAt: now,
    finishedAt: now, cancelledReason: null, payments: [],
  }],
  washPosts: [], cashSessions: [], expenses: [],
  subscription: { id: 'sub1', companyId: 'co1', planId: 'essai', status: 'essai', startedAt: now, trialEndsAt: now, pendingPlanId: null },
  auditLogs: [{ id: 'l1', at: now, actor: 'Owner', action: 'Ouverture', detail: '' }],
  platformCompanies: [{ id: 'co1', name: 'Clean Auto SARL', city: 'Abidjan', phone: '', planName: 'Essai', status: 'essai', stations: 1, monthlyRevenue: 0, createdAt: now }],
  session: null, demoMode: true, washCounter: 1,
}) as unknown as AppState;

describe('Prompt 10 — cohérence des règles pures', () => {
  it('formatFCFA groupe les milliers', () => {
    expect(formatFCFA(12500)).toBe('12 500 FCFA');
  });

  it('formatDate convertit une date ISO', () => {
    expect(formatDate('2026-11-11T10:00:00Z')).toBe('11/11/2026');
  });

  it('todayISO renvoie une date calendaire', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('optimisation image : 512 px maximum et extension WebP', () => {
    expect(LOGO_MAX_EDGE).toBe(512);
    expect(logoObjectName('Logo A.PNG')).toBe('Logo A.webp');
    expect(logoObjectName('sans_extension')).toBe('sans_extension.webp');
    expect(logoObjectName('.png')).toBe('logo.webp');
  });

  it('subscriptionUsageFromState lit la limite essai', () => {
    const usage = subscriptionUsageFromState(base());
    expect(usage.usage.washes).toBe(1);
    expect(usage.limits.washesPerMonth).toBe(100);
  });

  it('platformBoardFromState expose 3 formules et 1 entreprise', () => {
    const board = platformBoardFromState(base());
    expect(board.plans.length).toBe(3);
    expect(board.companies.length).toBe(1);
  });

  it('mapPlatformBoard ne renvoie aucun company_id brut', () => {
    const board = mapPlatformBoard(platformBoardFromState(base()));
    expect(JSON.stringify(board)).not.toContain('company_id');
    expect(board.rules.pricing).toContain('hypothèses commerciales');
  });
});
