import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Garde-fous de non-régression sur `server/routes.ts` et `server/db.ts`.
//
// Le backend « api » n'a pas de suite d'intégration HTTP (voir
// docs/complete-analysis.md §3). Ces contrôles statiques empêchent au moins de
// réintroduire les deux défauts critiques corrigés au P0 : le renvoi du jeton de
// réinitialisation à un appelant anonyme, et le repli mémoire silencieux.
//
// La version fusionnée de `main` a remplacé le drapeau `WASHGUARD_DEMO_RESET`
// par `authLinksExposed` / `WASHGUARD_EXPOSE_AUTH_LINKS`, avec limitation de
// débit et révocation de session : les assertions visent ce mécanisme-là.

const routes = readFileSync('server/routes.ts', 'utf8');
const db = readFileSync('server/db.ts', 'utf8');

/** Corps d'une route, du `router.<verbe>('<chemin>'` jusqu'à la route suivante. */
function routeBody(signature: string): string {
  const start = routes.indexOf(signature);
  expect(start, `route absente : ${signature}`).toBeGreaterThanOrEqual(0);
  const next = routes.indexOf('\n  router.', start + signature.length);
  return routes.slice(start, next === -1 ? undefined : next);
}

describe('durcissement Auth du serveur api', () => {
  it('ne renvoie le lien de réinitialisation que sous condition explicite', () => {
    const forgot = routeBody("router.post('/auth/forgot-password'");
    // Le drapeau est calculé hors production ou sur activation explicite.
    expect(routes).toContain('const authLinksExposed');
    expect(routes).toContain('WASHGUARD_EXPOSE_AUTH_LINKS');
    expect(forgot).toContain('resetUrl: authLinksExposed');
    // Réponse constante pour un compte inexistant : pas d'énumération.
    expect(forgot).toContain('res.json({ ok: true, linkExposed: false })');
    // Limitation de débit sur l'IP ET sur l'adresse visée.
    expect(forgot).toContain("'reset', `reset:ip:");
    expect(forgot).toContain("'reset', `reset:email:");
    // `authLinksExposed` doit être faux par défaut en production.
    expect(routes).toContain("process.env.NODE_ENV !== 'production'");
  });

  it('révoque les sessions et consomme les jetons après un changement de mot de passe', () => {
    const reset = routeBody("router.post('/auth/reset-password'");
    expect(reset).toContain('revokeUserSessions');
    // Hors jeton, la session courante peut survivre ; par jeton, tout tombe.
    expect(reset).toContain('viaToken ? undefined : req.sessionTokenHash');
    expect(reset).toContain('UPDATE action_tokens SET used_at = NOW()');
    expect(reset).toContain('consumeActionToken');
  });

  it('expose l’état de la base et ne masque pas un repli mémoire', () => {
    expect(db).toContain('export function getDatabaseStatus()');
    expect(db).toContain("mode: 'disk'");
    expect(db).toContain("mode: 'memory'");
    expect(routes).toContain('getDatabaseStatus');
    // Le repli doit être visible : code 503 et motif exposé.
    expect(routes).toContain("status.mode === 'memory' ? 503 : 200");
  });

  it('limite le débit des points d’entrée d’authentification', () => {
    expect(routes).toContain("from './rateLimit'");
    for (const signature of [
      "router.post('/auth/signin'",
      "router.post('/auth/signup'",
      "router.post('/auth/forgot-password'",
      "router.post('/auth/reset-password'",
    ]) {
      expect(routeBody(signature), `${signature} sans limitation`).toContain('enforceLimit(');
    }
  });
});
