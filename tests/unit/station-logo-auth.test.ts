// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChange } from '../../src/services/auth/AuthPort';
import type { AuthIdentity } from '../../src/services/auth/authTypes';

const fake = vi.hoisted(() => ({
  emit: null as ((change: import('../../src/services/auth/AuthPort').AuthChange) => void) | null,
  listUsers: vi.fn(),
  listInvitations: vi.fn(),
}));

vi.mock('../../src/services/auth/getAuthPort', () => ({
  getAuthPort: () => ({
    kind: 'supabase',
    onAuthStateChange: (handler: (change: AuthChange) => void) => {
      fake.emit = handler;
      return { unsubscribe: () => { fake.emit = null; } };
    },
    listUsers: fake.listUsers,
    listInvitations: fake.listInvitations,
  }),
}));
vi.mock('../../src/services/adapters/DataAdapter', () => ({
  getDataSource: () => 'supabase',
  getDataAdapter: () => ({ listPlans: async () => [] }),
}));

import { StoreProvider, useStore } from '../../src/lib/store';

const company = '11111111-1111-4111-8111-111111111111';
const stationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pathA = `${company}/logo-a.webp`;
const pathB = `${company}/logo-b.webp`;
const identity: AuthIdentity = {
  userId, email: 'owner@test.invalid', fullName: 'Propriétaire', role: 'proprietaire', roleKey: 'owner',
  permissions: ['settings.manage'], companyId: company, stationIds: [stationId],
  stations: [{ id: stationId, name: 'Station', city: 'Abidjan', activated: true, logoPath: null }],
  company: { id: company, name: 'Entreprise', city: 'Abidjan', phone: '', currencyCode: 'XOF', suspended: false, createdAt: '2026-01-01T00:00:00Z' },
  isPlatformAdmin: false, active: true, emailConfirmed: true, profileReady: true,
};

let container: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof useStore>;

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }

function Probe() { store = useStore(); return null; }
function send(change: AuthChange) {
  if (!fake.emit) throw new Error('Abonnement Auth absent');
  fake.emit(change);
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  fake.listUsers.mockResolvedValue({ identity, users: [] });
  fake.listInvitations.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(StoreProvider, null, React.createElement(Probe))); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  localStorage.clear();
});

describe('logo et rafraîchissement Auth', () => {
  it('ignore le contexte en cache et préserve un logo enregistré pendant une lecture', async () => {
    await act(async () => { send({ type: 'SIGNED_IN', identity }); });
    expect(store.authReady).toBe(true);
    expect(store.state.station?.logoPath).toBeNull();
    await act(async () => { store.updateStation({ address: 'Adresse locale', cashRequiresOpen: false }); });
    await act(async () => { store.setStationLogoPath(stationId, userId, pathA); });

    // Supabase peut réémettre SIGNED_IN avec le contexte initial en cache.
    await act(async () => { send({ type: 'SIGNED_IN', identity }); });
    expect(fake.listUsers).toHaveBeenCalledTimes(1);
    expect(store.state.station?.logoPath).toBe(pathA);

    // Une lecture du contexte mise à jour arrive pendant une autre écriture.
    let finish!: (value: unknown) => void;
    fake.listUsers.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const refreshed = { ...identity, stations: [{ ...identity.stations[0], logoPath: pathA }] };
    await act(async () => { send({ type: 'TOKEN_REFRESHED', identity: refreshed }); });
    expect(store.authReady).toBe(true); // pas de démontage des formulaires
    await act(async () => { store.setStationLogoPath(stationId, userId, pathB); });
    await act(async () => { finish({ identity: refreshed, users: [] }); });
    expect(store.state.station?.logoPath).toBe(pathB);
    expect(store.state.station?.address).toBe('Adresse locale');
    expect(store.state.station?.cashRequiresOpen).toBe(false);
    await act(async () => { store.setStationLogoPath(stationId, 'autre-utilisateur', pathA); });
    await act(async () => { store.setStationLogoPath(stationId, userId, 'https://example.invalid/logo.png'); });
    await act(async () => { store.setStationLogoPath(stationId, userId, '22222222-2222-4222-8222-222222222222/logo.webp'); });
    expect(store.state.station?.logoPath).toBe(pathB);
  });

  it('ignore une ancienne lecture après déconnexion puis reconnexion à la même identité', async () => {
    let finishOld!: (value: unknown) => void;
    fake.listUsers.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    await act(async () => { send({ type: 'SIGNED_IN', identity }); });
    expect(store.authReady).toBe(false);
    await act(async () => { send({ type: 'SIGNED_OUT', identity: null }); });
    await act(async () => { send({ type: 'SIGNED_IN', identity }); });
    await act(async () => { store.setStationLogoPath(stationId, userId, pathA); });
    await act(async () => { finishOld({ identity, users: [] }); });
    expect(store.authReady).toBe(true);
    expect(store.state.station?.logoPath).toBe(pathA);
  });

  it('efface la station précédente si le nouveau contexte n’en fournit aucune', async () => {
    await act(async () => { send({ type: 'SIGNED_IN', identity }); });
    await act(async () => { store.setStationLogoPath(stationId, userId, pathA); });
    const other = { ...identity, userId: 'autre', stationIds: [], stations: [], companyId: null, company: null };
    await act(async () => { send({ type: 'SIGNED_IN', identity: other }); });
    expect(store.state.station).toBeNull();
    expect(store.state.company).toBeNull();
  });
});
