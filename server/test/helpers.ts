import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/create-app.js';
import { createEmbeddedDb, createPostgresDb, type Db } from '../src/db/index.js';
import { migrate } from '../src/db/schema.js';

export interface TestContext {
  app: Express;
  db: Db;
  managerToken: string;
  /** Create a customer with one account (optionally funded) and log them in. */
  newCustomer(opts?: { currency?: string; deposit?: string }): Promise<{
    customerId: number;
    accountNumber: number;
    token: string;
  }>;
  close(): Promise<void>;
}

/**
 * A fresh, empty database per test file.
 *  - default: in-memory embedded Postgres (PGlite) - no setup needed
 *  - TEST_DATABASE_URL set: a real PostgreSQL server (used in CI). ALL TABLES ARE TRUNCATED.
 */
export async function createTestContext(): Promise<TestContext> {
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? createPostgresDb(url) : await createEmbeddedDb();
  await migrate(db);
  if (url) await db.exec('TRUNCATE transactions, accounts, customers RESTART IDENTITY CASCADE');

  const app = createApp(db, { rateLimit: false });
  const managerToken = (await request(app).post('/api/auth/login').send({ role: 'manager' })).body.token;

  let counter = 0;
  return {
    app,
    db,
    managerToken,
    async newCustomer(opts = {}) {
      counter += 1;
      const created = await request(app)
        .post('/api/manager/customers')
        .set(bearer(managerToken))
        .send({ firstName: 'Test', lastName: `User${'abcdefghij'[counter % 10]}`, postCode: 'AB1 2CD' });
      const customerId: number = created.body.customer.id;
      const opened = await request(app)
        .post('/api/manager/accounts')
        .set(bearer(managerToken))
        .send({ customerId, currency: opts.currency ?? 'Dollar' });
      const accountNumber: number = opened.body.account.accountNumber;
      const login = await request(app).post('/api/auth/login').send({ role: 'customer', customerId });
      const token: string = login.body.token;
      if (opts.deposit) {
        await request(app)
          .post(`/api/accounts/${accountNumber}/deposit`)
          .set(bearer(token))
          .send({ amount: opts.deposit })
          .expect(201);
      }
      return { customerId, accountNumber, token };
    },
    close: () => db.close(),
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The invariant from the brief: stored balance == net of recorded transactions. */
export async function ledgerNet(db: Db, accountNumber: number): Promise<number> {
  const [row] = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS net
       FROM transactions WHERE account_id = $1`,
    [accountNumber],
  );
  return Number(row.net);
}

export async function storedBalance(db: Db, accountNumber: number): Promise<number> {
  const [row] = await db.query('SELECT balance FROM accounts WHERE id = $1', [accountNumber]);
  return Number(row.balance);
}
