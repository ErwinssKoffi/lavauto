// ─── Prompt 10 : erreurs réseau, retry exponentiel et idempotence ─────────────
// Aucun secret, aucun token, aucun identifiant de tenant dans ce module.
// Les clés d'idempotence sont générées côté client pour être réutilisées
// telles quelles si une requête est rejouée après une panne réseau.

export class NetworkError extends Error {
  readonly cause?: unknown;
  readonly attempts: number;

  constructor(message: string, cause?: unknown, attempts = 1) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
    this.attempts = attempts;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.name, record.message, record.code, record.status]
      .filter(Boolean).map(String).join(' ');
  }
  return String(error);
}

/** Ne rejoue JAMAIS une erreur métier (RLS, validation, permission). */
export function isRetryable(error: unknown): boolean {
  // \b evite qu'un code metier comme 42501 contienne par hasard « 501 ».
  return /fetch failed|network|timeout|timed out|ECONNRESET|ECONNABORTED|too many requests|\b(?:5\d{2}|429)\b/i
    .test(errorText(error));
}

export function idempotencyKey(prefix = 'wg'): string {
  const uuid = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, (options.retries ?? 2) + 1);
  const baseDelay = Math.max(0, options.baseDelayMs ?? 200);
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (index === attempts - 1 || !isRetryable(error)) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** index));
    }
  }
  throw new NetworkError(
    `${options.label ?? 'Opération réseau'} indisponible après ${attempts} tentative(s)`,
    lastError,
    attempts,
  );
}
