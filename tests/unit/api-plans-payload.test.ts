import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, HttpClientError } from '../../src/services/api/apiClient';
import { ApiDataAdapter } from '../../src/services/adapters/ApiDataAdapter';
import { getPlans, PLANS, resetPlansCache } from '../../src/lib/plans';

type FetchStub = (path: string) => Response;

function stubFetch(handler: FetchStub) {
  const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function html(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetPlansCache();
});

describe('réponses API non exploitables', () => {
  it('refuse un 200 non JSON au lieu de renvoyer null', async () => {
    // Cas réel : la route /api est absente et l'hébergeur sert le repli SPA
    // (index.html en 200). Avant ce garde-fou, `apiFetch` renvoyait `null` et
    // l'appelant plantait sur « Cannot read properties of null (reading 'plans') ».
    stubFetch(() => html('<!doctype html><title>WashGuard</title>'));
    await expect(apiFetch('/api/plans')).rejects.toMatchObject({
      name: 'HttpClientError',
      code: 'invalid_response',
      status: 200,
    });
  });

  it('laisse passer un 204 sans contenu', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(apiFetch('/api/whatever')).resolves.toBeNull();
  });

  it('signale une charge utile de formules illisible sans lever de TypeError', async () => {
    stubFetch(() => json(null));
    const adapter = new ApiDataAdapter();
    const failure = await adapter.listPlans().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpClientError);
    expect((failure as HttpClientError).code).toBe('invalid_payload');
    expect((failure as Error).message).not.toMatch(/Cannot read properties/);
    expect(getPlans()).toHaveLength(PLANS.length);
  });

  it('alimente le cache partagé quand la charge utile est valide', async () => {
    stubFetch(() => json({ plans: PLANS }));
    const adapter = new ApiDataAdapter();
    await expect(adapter.listPlans()).resolves.toHaveLength(PLANS.length);
    expect(getPlans().map((plan) => plan.id)).toEqual(PLANS.map((plan) => plan.id));
  });
});
