import { ApiError } from '../../types';

export class HttpClientError extends ApiError {
  readonly status: number;
  readonly outcome: 'rejected' | 'unknown';

  constructor(
    status: number,
    code: string,
    message: string,
    missing?: string[],
    outcome: 'rejected' | 'unknown' = 'rejected',
  ) {
    super(code, message, missing);
    this.name = 'HttpClientError';
    this.status = status;
    this.outcome = outcome;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof Uint8Array) && !(init.body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Serveur inaccessible.';
    throw new HttpClientError(0, 'network_error', `Erreur réseau : ${msg}`, undefined, 'unknown');
  }

  const contentType = res.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (contentType.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      if (!res.ok) {
        throw new HttpClientError(res.status, 'invalid_response', `Réponse serveur invalide (${res.status}).`, undefined, res.status >= 500 ? 'unknown' : 'rejected');
      }
      throw new HttpClientError(res.status, 'invalid_json', 'Réponse JSON illisible.', undefined, 'unknown');
    }
  } else if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpClientError(res.status, 'http_error', text || `Erreur serveur (${res.status}).`, undefined, res.status >= 500 ? 'unknown' : 'rejected');
  }

  if (!res.ok) {
    const rec = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const code = typeof rec.code === 'string' ? rec.code : `http_${res.status}`;
    const message = typeof rec.message === 'string' ? rec.message : `Erreur serveur (${res.status}).`;
    const missing = Array.isArray(rec.missing) ? rec.missing.filter((x): x is string => typeof x === 'string') : undefined;
    throw new HttpClientError(res.status, code, message, missing, res.status >= 500 ? 'unknown' : 'rejected');
  }

  return payload as T;
}
