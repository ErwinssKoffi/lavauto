import { defineConfig } from 'vitest/config';

// Tests unitaires des règles pures : aucune base, aucun navigateur, aucun réseau.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
  },
});
