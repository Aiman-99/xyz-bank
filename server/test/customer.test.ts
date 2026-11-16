import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, ledgerNet, storedBalance, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('deposit', () => {
  it('increases the balance and records a credit', async () => {
    const c = await ctx.newCustomer();
    const res = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/deposit`)
      .set(bearer(c.token))
      .send({ amount: '100.50' });

    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({ accountNumber: c.accountNumber, balance: '100.50', balanceMinor: 10050 });
    expect(res.body.transaction).toMatchObject({ type: 'credit', amount: '100.50', balanceAfter: '100.50' });
    expect(Date.parse(res.body.transaction.createdAt)).not.toBeNaN();
  });

  it('adds up exactly (no floating-point drift)', async () => {
    const c = await ctx.newCustomer();
    for (const amount of ['0.10', '0.20', '0.70']) {
      await request(ctx.app).post(`/api/accounts/${c.accountNumber}/deposit`).set(bearer(c.token)).send({ amount });
    }
    const res = await request(ctx.app).get(`/api/accounts/${c.accountNumber}`).set(bearer(c.token));
    expect(res.body.account.balance).toBe('1.00');
    expect(res.body.account.balanceMinor).toBe(100);
  });

  it.each([
    ['missing', {}],
    ['non-numeric', { amount: 'abc' }],
    ['negative', { amount: '-10' }],
    ['zero', { amount: 0 }],
    ['too many decimals', { amount: '1.999' }],
    ['absurdly large', { amount: '999999999999' }],
  ])('rejects a %s amount with 400 and no balance change', async (_label, body) => {
    const c = await ctx.newCustomer({ deposit: '50' });
    const res = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/deposit`)
      .set(bearer(c.token))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(5000);
  });

  it('ignores client-supplied balance / type / timestamp fields', async () => {
    const c = await ctx.newCustomer();
    const res = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/deposit`)
      .set(bearer(c.token))
      .send({ amount: '1', balance: '999999', type: 'debit', createdAt: '1999-01-01T00:00:00Z', currency: 'Pound' });
    expect(res.body.account.balance).toBe('1.00');
    expect(res.body.account.currency).toBe('Dollar');
    expect(res.body.transaction.type).toBe('credit');
    expect(new Date(res.body.transaction.createdAt).getFullYear()).toBeGreaterThan(2000);
  });
});

describe('withdraw', () => {
  it('decreases the balance and records a debit', async () => {
    const c = await ctx.newCustomer({ deposit: '100' });
    const res = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/withdraw`)
      .set(bearer(c.token))
      .send({ amount: '30.25' });
    expect(res.status).toBe(201);
    expect(res.body.account.balance).toBe('69.75');
    expect(res.body.transaction).toMatchObject({ type: 'debit', amount: '30.25', balanceAfter: '69.75' });
  });

  it('allows withdrawing the exact balance', async () => {
    const c = await ctx.newCustomer({ deposit: '100' });
    const res = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/withdraw`)
      .set(bearer(c.token))
      .send({ amount: '100.00' });
    expect(res.status).toBe(201);
    expect(res.body.account.balance).toBe('0.00');
  });

  it('rejects an over-balance withdrawal with 422, no balance change and no transaction', async () => {
    const c = await ctx.newCustomer({ deposit: '100' });
    const res = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/withdraw`)
      .set(bearer(c.token))
      .send({ amount: '100.01' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(10000);

    const history = await request(ctx.app).get(`/api/accounts/${c.accountNumber}/transactions`).set(bearer(c.token));
    expect(history.body.total).toBe(1); // only the opening deposit
  });

  it('rejects invalid amounts', async () => {
    const c = await ctx.newCustomer({ deposit: '100' });
    for (const amount of ['-1', '0', 'ten', '', null]) {
      const res = await request(ctx.app)
        .post(`/api/accounts/${c.accountNumber}/withdraw`)
        .set(bearer(c.token))
        .send({ amount });
      expect(res.status).toBe(400);
    }
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(10000);
  });
});

describe('transaction history', () => {
  it('lists every movement, newest first, and nets to the balance', async () => {
    const c = await ctx.newCustomer();
    const post = (kind: string, amount: string) =>
      request(ctx.app).post(`/api/accounts/${c.accountNumber}/${kind}`).set(bearer(c.token)).send({ amount });
    await post('deposit', '200');
    await post('withdraw', '50.50');
    await post('withdraw', '9999'); // rejected - must not appear
    await post('deposit', '0.25');

    const res = await request(ctx.app).get(`/api/accounts/${c.accountNumber}/transactions`).set(bearer(c.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.transactions.map((t: any) => [t.type, t.amount, t.balanceAfter])).toEqual([
      ['credit', '0.25', '149.75'],
      ['debit', '50.50', '149.50'],
      ['credit', '200.00', '200.00'],
    ]);
    expect(await ledgerNet(ctx.db, c.accountNumber)).toBe(14975);
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(14975);
  });

  it('supports pagination', async () => {
    const c = await ctx.newCustomer();
    for (const amount of ['1', '2', '3']) {
      await request(ctx.app).post(`/api/accounts/${c.accountNumber}/deposit`).set(bearer(c.token)).send({ amount });
    }
    const res = await request(ctx.app)
      .get(`/api/accounts/${c.accountNumber}/transactions?limit=1&offset=1`)
      .set(bearer(c.token));
    expect(res.body.total).toBe(3);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].amount).toBe('2.00');
  });

  it('is immutable: the database refuses to edit or delete ledger rows', async () => {
    const c = await ctx.newCustomer({ deposit: '10' });
    await expect(
      ctx.db.query('UPDATE transactions SET amount = 1 WHERE account_id = $1', [c.accountNumber]),
    ).rejects.toThrow(/immutable/);
    await expect(ctx.db.query('DELETE FROM transactions WHERE account_id = $1', [c.accountNumber])).rejects.toThrow(
      /immutable/,
    );
  });
});

describe('account ownership', () => {
  it("a customer cannot see or touch another customer's account", async () => {
    const alice = await ctx.newCustomer({ deposit: '500' });
    const mallory = await ctx.newCustomer({ deposit: '1' });
    const asMallory = bearer(mallory.token);
    const target = `/api/accounts/${alice.accountNumber}`;

    expect((await request(ctx.app).get(target).set(asMallory)).status).toBe(404);
    expect((await request(ctx.app).get(`${target}/transactions`).set(asMallory)).status).toBe(404);
    expect((await request(ctx.app).post(`${target}/withdraw`).set(asMallory).send({ amount: '100' })).status).toBe(404);
    expect((await request(ctx.app).post(`${target}/deposit`).set(asMallory).send({ amount: '100' })).status).toBe(404);
    expect(await storedBalance(ctx.db, alice.accountNumber)).toBe(50000);

    const own = await request(ctx.app).get('/api/accounts').set(asMallory);
    expect(own.body.accounts.map((a: any) => a.accountNumber)).toEqual([mallory.accountNumber]);
  });

  it('returns 404 for a non-existent account and 400 for a malformed account number', async () => {
    const c = await ctx.newCustomer();
    expect((await request(ctx.app).get('/api/accounts/999999').set(bearer(c.token))).status).toBe(404);
    expect(
      (await request(ctx.app).post('/api/accounts/999999/deposit').set(bearer(c.token)).send({ amount: '1' })).status,
    ).toBe(404);
    expect((await request(ctx.app).get('/api/accounts/abc').set(bearer(c.token))).status).toBe(400);
    expect((await request(ctx.app).get('/api/accounts/1001%20OR%201=1').set(bearer(c.token))).status).toBe(400);
  });

  it('supports multiple accounts per customer, each with its own balance and currency', async () => {
    const c = await ctx.newCustomer({ deposit: '10' });
    const second = await request(ctx.app)
      .post('/api/manager/accounts')
      .set(bearer(ctx.managerToken))
      .send({ customerId: c.customerId, currency: 'Rupee' });
    const secondNumber = second.body.account.accountNumber;
    await request(ctx.app).post(`/api/accounts/${secondNumber}/deposit`).set(bearer(c.token)).send({ amount: '777' });

    const res = await request(ctx.app).get('/api/accounts').set(bearer(c.token));
    expect(res.body.accounts).toMatchObject([
      { accountNumber: c.accountNumber, currency: 'Dollar', balance: '10.00' },
      { accountNumber: secondNumber, currency: 'Rupee', balance: '777.00' },
    ]);
  });
});

describe('limits', () => {
  const BILLION = '1000000000';

  it('accepts a deposit of exactly one billion and rejects anything above it', async () => {
    const c = await ctx.newCustomer();
    const ok = await request(ctx.app).post(`/api/accounts/${c.accountNumber}/deposit`).set(bearer(c.token)).send({ amount: BILLION });
    expect(ok.status).toBe(201);
    expect(ok.body.account).toMatchObject({ balance: '1000000000.00', balanceMinor: 100_000_000_000 });

    const over = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/deposit`)
      .set(bearer(c.token))
      .send({ amount: '1000000000.01' });
    expect(over.status).toBe(400);
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(100_000_000_000);
  });

  it('rejects a deposit that would take the balance over the account limit (422), changing nothing', async () => {
    const c = await ctx.newCustomer();
    // Put the account just under the limit directly, rather than making 1000 deposits.
    await ctx.db.query('UPDATE accounts SET balance = $1 WHERE id = $2', [100_000_000_000_000 - 50, c.accountNumber]);

    const over = await request(ctx.app).post(`/api/accounts/${c.accountNumber}/deposit`).set(bearer(c.token)).send({ amount: '0.51' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('BALANCE_LIMIT');
    expect(await storedBalance(ctx.db, c.accountNumber)).toBe(100_000_000_000_000 - 50);

    const exact = await request(ctx.app).post(`/api/accounts/${c.accountNumber}/deposit`).set(bearer(c.token)).send({ amount: '0.50' });
    expect(exact.status).toBe(201);
    expect(exact.body.account.balance).toBe('1000000000000.00');
  });
});
