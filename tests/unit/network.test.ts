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

  it('ne rejoue jamais une erreur de permission', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw new Error('42501 permission refusée');
    }, { retries: 2, baseDelayMs: 1 })).rejects.toBeInstanceOf(NetworkError);
    expect(calls).toBe(1);
  });
});
