import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './create-app.js';
import { config } from './config.js';
import { createEmbeddedDb, createPostgresDb, lazyDb } from './db/index.js';
import { migrate } from './db/schema.js';
import { seedIfEmpty } from './db/seed.js';

/**
 * Entry point for both ways of running:
 *  - Vercel: this module's default export (the Express app) becomes one Vercel
 *    Function. Nothing listens on a port; the database is set up on first use.
 *  - Anywhere else (local, Render, Docker...): a normal long-running server.
 */

if (config.isProduction && !config.databaseUrl) {
  throw new Error('DATABASE_URL must be set in production');
}

const db = lazyDb(async () => {
  const connection = config.databaseUrl
    ? createPostgresDb(config.databaseUrl)
    : await createEmbeddedDb(config.pgliteDir);
  try {
    await migrate(connection);
    if (await seedIfEmpty(connection)) console.log('Seeded demo customers');
  } catch (err) {
    await connection.close().catch(() => {});
    throw err;
  }
  console.log(config.databaseUrl ? 'Database: PostgreSQL' : `Database: embedded PGlite (${config.pgliteDir})`);
  return connection;
});

// The built frontend (client build output). On Vercel these files are served by
// its CDN directly; elsewhere Express serves them.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../public');

const app = createApp(db, { staticDir });

if (!config.isVercel) {
  db.ready()
    .then(() => {
      const server = app.listen(config.port, () => {
        console.log(`XYZ Bank listening on http://localhost:${config.port}`);
      });
      const shutdown = () => {
        server.close(() => {
          db.close().finally(() => process.exit(0));
        });
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default app;
