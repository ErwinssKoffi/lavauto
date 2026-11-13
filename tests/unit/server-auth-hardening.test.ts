import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Garde-fous de non-régression sur `server/routes.ts` et `server/db.ts`.
//
// Le backend « api » n'a pas de suite d'intégration HTTP (voir
// docs/complete-analysis.md §3). Ces contrôles statiques empêchent au moins de
// réintroduire les deux défauts critiques corrigés au P0 : le renvoi du jeton de
// réinitialisation à un appelant anonyme, et le repli mémoire silencieux.

const routes = readFileSync('server/routes.ts', 'utf8');
const db = readFileSync('server/db.ts', 'utf8');

describe('durcissement Auth du serveur api', () => {
  it('ne renvoie le lien de réinitialisation que sous WASHGUARD_DEMO_RESET explicite', () => {
    expect(routes).toContain('function demoResetEnabled()');
    expect(routes).toContain("process.env.WASHGUARD_DEMO_RESET === '1'");
    expect(routes).toContain("process.env.NODE_ENV !== 'production'");
    // Le jeton ne doit jamais être renvoyé hors de la branche de démonstration.
    const forgot = routes.slice(
      routes.indexOf("router.post('/auth/forgot-password'"),
      routes.indexOf("router.post('/auth/reset-password'"),
    );
    expect(forgot).toContain('if (!demoResetEnabled())');
    expect(forgot).toContain('res.json({ ok: true });');
    expect(forgot.indexOf('if (!demoResetEnabled())')).toBeLessThan(forgot.indexOf('resetUrl'));
  });

  it('révoque les sessions et consomme les jetons après un changement de mot de passe', () => {
    const start = routes.indexOf("router.post('/auth/reset-password'");
    // La route suivante dans le fichier est `/employees` : la tranche couvre
    // exactement le corps de `/auth/reset-password`.
    const reset = routes.slice(start, routes.indexOf("router.get('/employees'", start));
    expect(reset).toContain('DELETE FROM sessions WHERE user_id = $1');
    expect(reset).toContain('clearSessionCookie(res)');
    expect(reset).toContain("kind = $2'");
  });

  it('expose l’état de la base et ne masque pas un repli mémoire', () => {
    expect(db).toContain('export function getDatabaseStatus()');
    expect(db).toContain("mode: 'disk'");
    expect(db).toContain("mode: 'memory'");
    expect(routes).toContain('getDatabaseStatus');
    // Le repli doit être visible : code 503 et motif exposé.
    expect(routes).toContain("status.mode === 'memory' ? 503 : 200");
  });
});
