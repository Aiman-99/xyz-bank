import { mkdirSync } from 'node:fs';
import pg from 'pg';

export type Row = Record<string, any>;

/** Minimal database interface, implemented by node-postgres and by embedded PGlite. */
export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run one or more statements with no parameters (schema setup). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Real PostgreSQL via a connection pool - used in production and CI. */
export function createPostgresDb(connectionString: string): Db {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    // Kept small: on serverless hosting several instances may each hold a pool.
    max: 5,
    // Release idle connections quickly so a paused serverless instance does not hold them.
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    // Hosted Postgres (Neon, Supabase, ...) requires TLS.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  // An idle client dropping its connection must not crash the process.
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

/**
 * Embedded PostgreSQL (PGlite - Postgres compiled to WASM) for zero-install local dev and tests.
 * Pass a directory to persist to disk, or nothing for an in-memory database.
 */
export async function createEmbeddedDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await db.query(text, params as any[])).rows as T[];
    },
    async exec(sql) {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

export interface LazyDb extends Db {
  /** Resolves once the database is connected and initialised. */
  ready(): Promise<void>;
}

/**
 * A Db whose connection + setup (migrate, seed) runs once, on first use.
 *
 * On a long-running server we call ready() before listening. On serverless
 * hosting there is no "before listening": the module just exports the app, so
 * the first query on a fresh instance triggers the setup and later queries
 * wait for it. If setup fails, the next request tries again.
 */
export function lazyDb(init: () => Promise<Db>): LazyDb {
  let pending: Promise<Db> | undefined;
  const get = () => {
    pending ??= init().catch((err) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
  return {
    query: async (text, params) => (await get()).query(text, params),
    exec: async (sql) => (await get()).exec(sql),
    close: async () => {
      if (pending) await (await pending).close();
    },
    ready: async () => {
      await get();
    },
  };
}
