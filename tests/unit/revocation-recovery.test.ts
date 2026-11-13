// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingRevocation, readPendingRevocation, savePendingRevocation, type PendingRevocation,
} from '../../src/lib/revocationAttempt';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const company = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const invitation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const pending: PendingRevocation = { version: 1, userId: user, companyId: company, invitationId: invitation, startedAt: '2026-11-12T12:00:00Z' };
const key = `washguard.pending-revocation.v1:${user}:${company}`;

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('reprise de révocation dans un onglet', () => {
  it('conserve uniquement la tentative pour le compte et l’entreprise et efface seulement la même', () => {
    expect(readPendingRevocation(user, company)).toBeNull();
    savePendingRevocation(pending);
    expect(readPendingRevocation(user, company)).toEqual(pending);
    expect(readPendingRevocation('dddddddd-dddd-4ddd-8ddd-dddddddddddd', company)).toBeNull();
    expect(readPendingRevocation(user, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBeNull();
    expect(() => savePendingRevocation({ ...pending, invitationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).toThrow(/précédente/);
    expect(() => clearPendingRevocation({ ...pending, startedAt: '2026-11-13T12:00:00Z' })).toThrow(/a changé/);
    expect(readPendingRevocation(user, company)).toEqual(pending);
    clearPendingRevocation(pending);
    expect(readPendingRevocation(user, company)).toBeNull();
  });
  it.each(['', '{tronqué', JSON.stringify({ ...pending, companyId: 'autre' })])('ne remplace pas une tentative illisible (%j)', (raw) => {
    sessionStorage.setItem(key, raw);
    expect(() => readPendingRevocation(user, company)).toThrow(/illisible/);
    expect(() => savePendingRevocation(pending)).toThrow(/illisible/);
    expect(sessionStorage.getItem(key)).toBe(raw);
  });
  it('refuse l’envoi si la sauvegarde du marqueur échoue', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(() => savePendingRevocation(pending)).toThrow(/aucune révocation envoyée/);
  });
  it('signale un stockage inaccessible sans le traiter comme une absence de tentative', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('interdit', 'SecurityError'); });
    expect(() => readPendingRevocation(user, company)).toThrow(/inaccessible/);
  });
  it('ne prétend pas avoir effacé un marqueur resté présent', () => {
    savePendingRevocation(pending);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    expect(() => clearPendingRevocation(pending)).toThrow(/non confirmé/);
    expect(readPendingRevocation(user, company)).toEqual(pending);
  });
  it('signale une tentative disparue ou une invitation invalide', () => {
    expect(() => clearPendingRevocation(pending)).toThrow(/a disparu/);
    expect(() => savePendingRevocation({ ...pending, invitationId: 'autre' })).toThrow(/aucune opération envoyée/);
  });
});
