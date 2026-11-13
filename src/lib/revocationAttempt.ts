/** Une révocation peut avoir été enregistrée même si sa réponse est perdue.
 * Seul son identifiant est conservé, avant envoi, dans l'onglet et pour le
 * compte/entreprise vérifiés. Ce stockage n'est ni une preuve ni un verrou
 * entre appareils : la RPC serveur reste l'autorité. */
export interface PendingRevocation {
  version: 1;
  userId: string;
  companyId: string;
  invitationId: string;
  startedAt: string;
}

const PREFIX = 'washguard.pending-revocation.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor = (userId: string, companyId: string) => `${PREFIX}:${userId}:${companyId}`;

function valid(value: unknown, userId: string, companyId: string): value is PendingRevocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Partial<PendingRevocation>;
  return p.version === 1 && UUID.test(userId) && UUID.test(companyId)
    && p.userId === userId && p.companyId === companyId
    && typeof p.invitationId === 'string' && UUID.test(p.invitationId)
    && typeof p.startedAt === 'string' && Number.isFinite(Date.parse(p.startedAt));
}

export function readPendingRevocation(userId: string, companyId: string): PendingRevocation | null {
  if (!UUID.test(userId) || !UUID.test(companyId)) {
    throw new Error('Compte ou entreprise illisible : vérifiez les révocations avec le support avant de poursuivre.');
  }
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(keyFor(userId, companyId)); }
  catch { throw new Error('Stockage de session inaccessible : vérifiez les révocations avec le support avant toute action sur les comptes.'); }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!valid(value, userId, companyId)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Tentative de révocation illisible : vérifiez les comptes et invitations avec le support avant de poursuivre.');
  }
}

/** Ne remplace jamais une tentative existante, même pour une autre invitation. */
export function savePendingRevocation(pending: PendingRevocation): void {
  if (!valid(pending, pending.userId, pending.companyId)) throw new Error('Révocation invalide : aucune opération envoyée.');
  const previous = readPendingRevocation(pending.userId, pending.companyId);
  if (previous) throw new Error('Une révocation précédente doit d’abord être vérifiée.');
  try {
    const key = keyFor(pending.userId, pending.companyId);
    const raw = JSON.stringify(pending);
    window.sessionStorage.setItem(key, raw);
    if (window.sessionStorage.getItem(key) !== raw) throw new Error('storage');
  } catch { throw new Error('Stockage de session inaccessible : aucune révocation envoyée.'); }
}

/** Ne retire que la tentative exacte dont le résultat a été confirmé. */
export function clearPendingRevocation(pending: PendingRevocation): void {
  const previous = readPendingRevocation(pending.userId, pending.companyId);
  if (!previous) throw new Error('La tentative de révocation conservée a disparu : vérifiez avec le support.');
  if (JSON.stringify(previous) !== JSON.stringify(pending)) {
    throw new Error('La tentative de révocation conservée a changé : vérifiez avec le support.');
  }
  try {
    const key = keyFor(pending.userId, pending.companyId);
    window.sessionStorage.removeItem(key);
    if (window.sessionStorage.getItem(key) !== null) throw new Error('storage');
  } catch { throw new Error('Effacement de la tentative de révocation non confirmé : vérifiez avec le support.'); }
}
