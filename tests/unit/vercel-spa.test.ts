import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('configuration Vercel de la SPA', () => {
  it('conserve une destination HTML accessible quand la route est réécrite', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      cleanUrls?: boolean; outputDirectory?: string; rewrites?: { source: string; destination: string }[];
    };
    expect(config.outputDirectory).toBe('dist');
    // cleanUrls=true supprime l'extension .html de la table de routage Vercel :
    // /(.*) -> /index.html échoue alors malgré un index.html présent dans dist.
    expect(config.cleanUrls).not.toBe(true);
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });
});
