import { describe, expect, it } from 'vitest';
import { idempotencyKey, isRetryable, NetworkError, withRetry } from '../../src/lib/network';

describe('Prompt 10 — réseau et idempotence', () => {
  it('génère une clé d’idempotence préfixée', () => {
    expect(idempotencyKey('logo')).toMatch(/^logo-[A-Za-z0-9._-]{8,}$/);
  });

  it('distingue panne réseau et erreur métier', () => {
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
    expect(isRetryable(new Error('429 too many requests'))).toBe(true);
    expect(isRetryable(new Error('42501 permission refusée'))).toBe(false);
  });

  it('rejoue une panne réseau puis réussit', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error('fetch failed');
      return 'ok';
    }, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('indique le nombre réel de tentatives après épuisement du retry', async () => {
    try {
      await withRetry(async () => { throw new Error('fetch failed'); }, { retries: 2, baseDelayMs: 1 });
      throw new Error('une erreur réseau était attendue');
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).attempts).toBe(3);
    }
  });

  it('ne rejoue jamais une erreur de permission', async () => {
    let calls = 0;
    let failure: unknown;
    try {
      await withRetry(async () => {
        calls += 1;
        throw new Error('42501 permission refusée');
      }, { retries: 2, baseDelayMs: 1 });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(NetworkError);
    expect((failure as NetworkError).attempts).toBe(1);
    expect((failure as NetworkError).message).toContain('1 tentative');
    expect(calls).toBe(1);
  });
});
