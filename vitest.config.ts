import { defineConfig } from 'vitest/config';

// Tests unitaires et PostgreSQL isolé en mémoire ; aucun réseau ni projet distant.
export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    reporters: ['default'],
  },
});
