import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
const ignore = readFileSync(new URL('../../supabase/.gitignore', import.meta.url), 'utf8');

function section(name: string): string {
  const header = `[${name}]\n`;
  const start = config.indexOf(header);
  expect(start, `section ${name} absente`).toBeGreaterThanOrEqual(0);
  return config.slice(start + header.length).split(/^\[/m, 1)[0];
}

describe('configuration locale de la CLI Supabase', () => {
  it('ne lance ni migrations ni seed automatiquement avant réconciliation', () => {
    expect(config).toMatch(/^project_id\s*=\s*"lavauto"\s*$/m);
    expect(section('db')).toMatch(/^major_version\s*=\s*17\s*$/m);
    expect(section('db.migrations')).toMatch(/^enabled\s*=\s*false\s*$/m);
    expect(section('db.seed')).toMatch(/^enabled\s*=\s*false\s*$/m);
  });

  it('exclut du dépôt les métadonnées locales de liaison et les clés dotenvx', () => {
    expect(ignore).toMatch(/^\.temp\s*$/m);
    expect(ignore).toMatch(/^\.branches\s*$/m);
    expect(ignore).toMatch(/^\.env\.keys\s*$/m);
  });
});
