// ─── Mots de passe de la démonstration locale UNIQUEMENT ────────────────────
// Prompt 04 : `AppState.passwords` est supprimé. Le mode `local` reste
// reversible pour la démo, mais ses mots de passe ne sont plus mêlés à l'état
// métier ni stockés en clair : ils vivent dans une clé séparée, sous forme
// d'empreinte non réversible. Ce n'est PAS une sécurité de production ;
// le mode `supabase` n'utilise jamais ce fichier.

import { DEMO_PASSWORDS_KEY } from './demoStorage';
const SALT = 'washguard-demo-v1';

function fingerprint(email: string, password: string): string {
  const input = `${SALT}:${email.trim().toLowerCase()}:${password}`;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = (Math.imul(b ^ code, 2246822519) + i) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function read(strict = false): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') throw new Error('stockage indisponible');
    const raw = localStorage.getItem(DEMO_PASSWORDS_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('empreintes illisibles');
    return parsed as Record<string, string>;
  } catch {
    if (strict) throw new Error('Stockage des accès de démonstration illisible ou indisponible. Sauvegardez les données avant récupération.');
    return {};
  }
}

export function setDemoPassword(email: string, password: string): void {
  const key = email.trim().toLowerCase();
  // Une ancienne liste illisible ne doit pas être écrasée par une inscription.
  const next = { ...read(true), [key]: fingerprint(key, password) };
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(DEMO_PASSWORDS_KEY, raw);
    if (localStorage.getItem(DEMO_PASSWORDS_KEY) !== raw) throw new Error('écriture non confirmée');
  } catch { throw new Error('Impossible de conserver les accès de démonstration dans ce navigateur.'); }
}

export function verifyDemoPassword(email: string, password: string): boolean {
  const key = email.trim().toLowerCase();
  return read()[key] === fingerprint(key, password);
}

export function hasDemoPassword(email: string): boolean {
  return Boolean(read()[email.trim().toLowerCase()]);
}

export function clearDemoPasswords(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(DEMO_PASSWORDS_KEY); } catch { /* ignoré */ }
}

export function demoPasswordFingerprint(email: string, password: string): string {
  return fingerprint(email, password);
}
