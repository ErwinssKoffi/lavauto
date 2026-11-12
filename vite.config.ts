import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // L'aperçu Arena est servi sous un hôte proxy *.e2b.app.
    // Liste explicite plutôt que `true` : évite d'accepter n'importe quel
    // en-tête Host (protection contre le DNS rebinding en développement).
    allowedHosts: ['localhost', '127.0.0.1', '.e2b.app'],
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', '.e2b.app'],
  },
});
