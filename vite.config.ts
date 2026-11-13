import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const defaultApiSource =
  !process.env.VITE_DATA_SOURCE && process.env.VITEST !== 'true'
    ? { 'import.meta.env.VITE_DATA_SOURCE': JSON.stringify('api') }
    : undefined;

const enablePwa = process.env.VITEST !== 'true';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    ...(enablePwa
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: [
              'favicon.ico',
              'apple-touch-icon.png',
              'icon.svg',
              'pwa-192x192.png',
              'pwa-512x512.png',
              'pwa-maskable-512x512.png',
            ],
            manifest: {
              id: '/',
              name: 'WashGuard — Gestion de station de lavage',
              short_name: 'WashGuard',
              description:
                'Gestion complète de station de lavage : lavages, caisse, employés, commissions, stocks et rapports en FCFA.',
              lang: 'fr',
              theme_color: '#080f1d',
              background_color: '#080f1d',
              display: 'standalone',
              start_url: '/',
              scope: '/',
              icons: [
                {
                  src: '/pwa-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: '/pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: '/pwa-maskable-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
              maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
              cleanupOutdatedCaches: true,
              clientsClaim: true,
              skipWaiting: true,
              navigateFallback: '/index.html',
              navigateFallbackDenylist: [/^\/api\//],
              runtimeCaching: [
                {
                  urlPattern: ({ url, request }) =>
                    request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'washguard-pages-cache',
                    networkTimeoutSeconds: 3,
                    cacheableResponse: { statuses: [200] },
                    expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
                  },
                },
                {
                  urlPattern: ({ url, request }) =>
                    request.method === 'GET' &&
                    /^\/api\/(auth\/me|plans|setup|washes|finance|analytics|stock|crm|employees|subscription)/.test(
                      url.pathname,
                    ),
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'washguard-api-cache',
                    networkTimeoutSeconds: 3,
                    cacheableResponse: { statuses: [200] },
                    expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 },
                  },
                },
                {
                  urlPattern: ({ url, request }) =>
                    url.origin === self.location.origin &&
                    ['script', 'style', 'font', 'image'].includes(request.destination),
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'washguard-assets-cache',
                    networkTimeoutSeconds: 2,
                    cacheableResponse: { statuses: [200] },
                    expiration: { maxEntries: 180, maxAgeSeconds: 60 * 60 * 24 * 7 },
                  },
                },
                {
                  urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                  handler: 'CacheFirst',
                  options: {
                    cacheName: 'google-fonts-cache',
                    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                    cacheableResponse: { statuses: [0, 200] },
                  },
                },
                {
                  urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                  handler: 'CacheFirst',
                  options: {
                    cacheName: 'gstatic-fonts-cache',
                    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                    cacheableResponse: { statuses: [0, 200] },
                  },
                },
              ],
            },
            devOptions: {
              enabled: true,
              type: 'module',
              navigateFallback: '/',
              navigateFallbackAllowlist: [/^\/($|app|connexion|inscription|mot-de-passe-oublie|reinitialiser-mot-de-passe)/],
            },
          }),
        ]
      : []),
  ],
  ...(defaultApiSource ? { define: defaultApiSource } : {}),
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
