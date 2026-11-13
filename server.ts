import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createApiRouter } from './server/routes';
import { getDb } from './server/db';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  await getDb();

  const app = express();
  app.set('trust proxy', 1);

  app.use('/api', createApiRouter());

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      const message = err instanceof Error ? err.message : 'Erreur serveur inattendue.';
      res.status(500).json({ code: 'internal_error', message });
      return;
    }
    next(err);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
        return;
      }
      res.status(404).send('Build frontend introuvable. Exécutez npm run build.');
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WashGuard] Serveur prêt sur http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'développement'})`);
  });
}

startServer().catch((err) => {
  console.error('[WashGuard] Démarrage impossible :', err);
  process.exit(1);
});
