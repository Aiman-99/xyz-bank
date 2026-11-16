import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, ledgerNet, storedBalance, type TestContext } from './helpers.js';

/**
 * Section 4 of the brief: simultaneous withdrawals must never overdraw.
 *
 * By default this runs on embedded Postgres (PGlite), which executes statements
 * one at a time - so it proves the request handling has no read-then-write gap.
 * Set TEST_DATABASE_URL to run it against a real multi-connection PostgreSQL
 * (as CI does), which exercises true row-lock contention.
 */
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('concurrent money movements', () => {
  it('20 simultaneous withdrawals of 10.00 from a 100.00 balance: exactly 10 succeed', async () => {
    const c = await ctx.newCustomer({ deposit: '100' });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(ctx.app).post(`/api/accounts/${c.accountNumber}/withdraw`).set(bearer(c.token)).send({ amount: '10' }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(10);

    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(0);
    expect(await ledgerNet(ctx.db, c.accountNumber)).toBe(0);
    const history = await request(ctx.app).get(`/api/accounts/${c.accountNumber}/transactions`).set(bearer(c.token));
    expect(history.body.total).toBe(11); // 1 deposit + exactly 10 debits
  });

  it('two simultaneous withdrawals of the full balance: only one wins', async () => {
    const c = await ctx.newCustomer({ deposit: '75.50' });
    const [a, b] = await Promise.all([
      request(ctx.app).post(`/api/accounts/${c.accountNumber}/withdraw`).set(bearer(c.token)).send({ amount: '75.50' }),
      request(ctx.app).post(`/api/accounts/${c.accountNumber}/withdraw`).set(bearer(c.token)).send({ amount: '75.50' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(0);
  });

  it('mixed concurrent deposits and withdrawals lose no updates', async () => {
    const c = await ctx.newCustomer({ deposit: '1000' });
    const post = (kind: string, amount: string) =>
      request(ctx.app).post(`/api/accounts/${c.accountNumber}/${kind}`).set(bearer(c.token)).send({ amount });
    const results = await Promise.all([
      ...Array.from({ length: 15 }, () => post('deposit', '3.33')),
      ...Array.from({ length: 15 }, () => post('withdraw', '1.11')),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);

    const expected = 100_000 + 15 * 333 - 15 * 111;
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(expected);
    expect(await ledgerNet(ctx.db, c.accountNumber)).toBe(expected);
  });
});
