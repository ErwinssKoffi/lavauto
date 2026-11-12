// ─── Mots de passe de la démonstration locale UNIQUEMENT ────────────────────
// Prompt 04 : `AppState.passwords` est supprimé. Le mode `local` reste
// reversible pour la démo, mais ses mots de passe ne sont plus mêlés à l'état
// métier ni stockés en clair : ils vivent dans une clé séparée, sous forme
// d'empreinte non réversible. Ce n'est PAS une sécurité de production ;
// le mode `supabase` n'utilise jamais ce fichier.

const DEMO_PASSWORDS_KEY = 'washguard.demo-passwords.v1';
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

function read(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DEMO_PASSWORDS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, string>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(DEMO_PASSWORDS_KEY, JSON.stringify(map)); } catch { /* quota plein */ }
}

export function setDemoPassword(email: string, password: string): void {
  const key = email.trim().toLowerCase();
  write({ ...read(), [key]: fingerprint(key, password) });
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
