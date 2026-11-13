// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { computeOnboarding, emptyState, load } from '../../src/lib/store';
import { serializeDemoState, writeDemoState } from '../../src/lib/demoStorage';
import { mapIdentityToAppState, mapMyContext } from '../../src/services/auth/authTypes';
import type { Station } from '../../src/types';

const company = '11111111-1111-4111-8111-111111111111';
const logoPath = `${company}/logo-example.webp`;

function station(): Station {
  return {
    id: 'station-a', companyId: company, name: 'Station A', address: '', city: '', phone: '',
    currency: 'FCFA', logoPath: null, hours: [], paymentMethods: [], cashRequiresOpen: true,
    maxCashierDiscount: 0, commissionRate: 0, monthlyTarget: 0, activated: false, activatedAt: null,
  };
}

afterEach(() => localStorage.clear());

describe('chemin du logo dans l’état', () => {
  it('relit le chemin depuis my_context pour une nouvelle session', () => {
    const identity = mapMyContext({
      authenticated: true, userId: 'user-a', roleKey: 'owner', companyId: company,
      company: { id: company, name: 'Entreprise A', city: 'Abidjan' },
      stations: [{ id: 'station-a', name: 'Station A', city: 'Abidjan', activated: true, logoPath }],
      permissions: ['settings.manage'],
    }, true)!;
    expect(identity.stations[0].logoPath).toBe(logoPath);
    expect(mapIdentityToAppState(identity, []).station?.logoPath).toBe(logoPath);
  });

  it('ne reprend jamais une ancienne URL ou une URL signée comme chemin', () => {
    const state = emptyState();
    state.station = station();
    localStorage.setItem('washguard.state.v1', JSON.stringify({
      ...state, station: { ...state.station, logoUrl: 'https://example.com/logo.png', logoPath: 'https://example.com/signed?token=old' },
    }));
    const restored = load();
    expect(restored.station?.logoPath).toBeNull();
    expect(restored.station).not.toHaveProperty('logoUrl');
    expect(computeOnboarding(restored).find((step) => step.id === 'logo')?.done).toBe(false);
    writeDemoState(serializeDemoState(restored));
    expect(localStorage.getItem('washguard.state.v1')).not.toContain('token=old');
    expect(localStorage.getItem('washguard.state.v1')).not.toContain('example.com');
  });

  it('persiste seulement le chemin et constate l’étape facultative', () => {
    const state = emptyState();
    state.station = { ...station(), logoPath };
    writeDemoState(serializeDemoState(state));
    const restored = load();
    expect(restored.station?.logoPath).toBe(logoPath);
    expect(computeOnboarding(restored).find((step) => step.id === 'logo')?.done).toBe(true);
    expect(localStorage.getItem('washguard.state.v1')).not.toContain('https://');
  });

  it('rejette un chemin valide mais situé dans le dossier d’une autre entreprise', () => {
    const otherPath = '22222222-2222-4222-8222-222222222222/logo.webp';
    const identity = mapMyContext({
      authenticated: true, userId: 'user-a', roleKey: 'owner', companyId: company,
      stations: [{ id: 'station-a', name: 'Station A', logoPath: otherPath }],
    }, true)!;
    expect(identity.stations[0].logoPath).toBeNull();
    const state = emptyState();
    state.station = { ...station(), logoPath: otherPath };
    writeDemoState(serializeDemoState(state));
    expect(load().station?.logoPath).toBeNull();
  });

  it('ignore également une URL mal formée reçue dans le contexte serveur', () => {
    const identity = mapMyContext({
      authenticated: true, userId: 'user-a', roleKey: 'owner', companyId: company,
      stations: [{ id: 'station-a', name: 'Station A', logoPath: 'https://example.com/logo.png' }],
    }, true)!;
    expect(identity.stations[0].logoPath).toBeNull();
  });
});
