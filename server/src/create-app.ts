import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Db } from './db/index.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customer.js';
import { managerRoutes } from './routes/manager.js';

export interface AppOptions {
  /** Directory of the built frontend to serve (production). */
  staticDir?: string;
  /** Disabled in tests so the concurrency test can fire many requests. */
  rateLimit?: boolean;
}

export function createApp(db: Db, options: AppOptions = {}, app: Express = express()): Express {
  app.set('trust proxy', 1); // behind the hosting provider's proxy
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  const api = express.Router();
  if (options.rateLimit !== false) {
    api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  }
  api.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  api.use(authRoutes(db));
  api.use(customerRoutes(db));
  api.use(managerRoutes(db));
  api.use(notFoundHandler);
  app.use('/api', api);

  // In production the same service serves the built React app.
  const { staticDir } = options;
  if (staticDir && existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        setHeaders: (res, file) => {
          // Always re-check the page itself, so a new deploy is picked up at once.
          if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      // Fall back to the app page for page-like URLs only. A missing file (for example
      // a script from an older deploy) must be a 404 - answering it with HTML would make
      // the browser load a page as JavaScript and show a blank screen.
      if (req.method !== 'GET' || path.extname(req.path) !== '') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
