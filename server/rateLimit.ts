// ─── Limitation de débit en mémoire (API WashGuard) ─────────────────────────
// Protège la connexion, l'inscription et la récupération de mot de passe sans
// dépendance externe. Le compteur vit dans le processus : il protège un
// déploiement mono-instance et ne remplace pas un limiteur partagé (Redis/WAF)
// en production multi-instances. Aucune donnée personnelle n'est journalisée.

interface Bucket {
  /** Horodatages (ms) des tentatives encore dans la fenêtre. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Secondes avant nouvelle tentative (0 si autorisé). */
  retryAfterSeconds: number;
  /** Tentatives restantes dans la fenêtre. */
  remaining: number;
}

export interface RateLimitPolicy {
  /** Nombre maximal de tentatives par fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
}

function prune(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    const last = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (now - last > 24 * 3600 * 1000) buckets.delete(key);
  }
}

/**
 * Enregistre une tentative et indique si elle est autorisée.
 * `consume` compte AVANT l'opération : un refus consomme aussi le quota.
 */
export function consume(key: string, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  prune(now);
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < policy.windowMs);
  if (bucket.hits.length >= policy.limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((policy.windowMs - (now - oldest)) / 1000)),
      remaining: 0,
    };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, policy.limit - bucket.hits.length),
  };
}

/** Lecture seule : ne consomme pas de tentative. */
export function peek(key: string, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  const hits = (bucket?.hits ?? []).filter((at) => now - at < policy.windowMs);
  if (hits.length >= policy.limit) {
    const oldest = hits[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((policy.windowMs - (now - oldest)) / 1000)),
      remaining: 0,
    };
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: policy.limit - hits.length };
}

/** Efface un compteur après une authentification réussie. */
export function reset(key: string): void {
  buckets.delete(key);
}

/** Réservé aux tests : vide tous les compteurs. */
export function resetAll(): void {
  buckets.clear();
}

export const POLICIES = {
  /** 8 échecs par compte et par quart d'heure. */
  signInPerAccount: { limit: 8, windowMs: 15 * 60 * 1000 },
  /** 25 tentatives par adresse IP et par quart d'heure (plusieurs comptes). */
  signInPerIp: { limit: 25, windowMs: 15 * 60 * 1000 },
  /** 10 inscriptions par heure et par IP. */
  signUpPerIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** 5 demandes de réinitialisation par heure et par compte. */
  passwordResetPerAccount: { limit: 5, windowMs: 60 * 60 * 1000 },
  /** 15 demandes de réinitialisation par heure et par IP. */
  passwordResetPerIp: { limit: 15, windowMs: 60 * 60 * 1000 },
  /** 10 essais de jeton (vérification ou consommation) par quart d'heure. */
  tokenPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RateLimitPolicy>;

/** Message homogène, sans révéler l'existence d'un compte. */
export function rateLimitMessage(scope: 'signin' | 'signup' | 'reset' | 'token', retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  if (scope === 'signin') {
    return `Trop de tentatives de connexion. Réessayez dans ${minutes} minute(s).`;
  }
  if (scope === 'signup') {
    return `Trop d’inscriptions depuis cette connexion. Réessayez dans ${minutes} minute(s).`;
  }
  if (scope === 'reset') {
    return `Trop de demandes de réinitialisation. Réessayez dans ${minutes} minute(s).`;
  }
  return `Trop d’essais sur ce lien. Réessayez dans ${minutes} minute(s).`;
}
