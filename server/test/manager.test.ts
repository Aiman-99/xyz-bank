import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

const asManager = () => bearer(ctx.managerToken);

describe('add customer', () => {
  it('creates a customer and returns the new id', async () => {
    const res = await request(ctx.app)
      .post('/api/manager/customers')
      .set(asManager())
      .send({ firstName: '  Grace ', lastName: "O'Neil-Smith", postCode: 'SW1A 1AA' });
    expect(res.status).toBe(201);
    expect(res.body.customer).toMatchObject({ firstName: 'Grace', lastName: "O'Neil-Smith", postCode: 'SW1A 1AA' });
    expect(Number.isInteger(res.body.customer.id)).toBe(true);
  });

  it.each([
    ['missing first name', { lastName: 'Lee', postCode: '123' }, /first name/i],
    ['empty last name', { firstName: 'Ann', lastName: '   ', postCode: '123' }, /last name/i],
    ['missing post code', { firstName: 'Ann', lastName: 'Lee' }, /post code/i],
    ['non-string name', { firstName: 42, lastName: 'Lee', postCode: '123' }, /first name/i],
    ['markup in name', { firstName: '<script>', lastName: 'Lee', postCode: '123' }, /first name/i],
    ['over-long name', { firstName: 'A'.repeat(51), lastName: 'Lee', postCode: '123' }, /first name/i],
  ])('rejects %s with a meaningful 400', async (_label, body, message) => {
    const res = await request(ctx.app).post('/api/manager/customers').set(asManager()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(message);
  });

  it('stores SQL-looking input literally (parameterised queries)', async () => {
    const res = await request(ctx.app)
      .post('/api/manager/customers')
      .set(asManager())
      .send({ firstName: 'Robert', lastName: "O'; DROP TABLE x", postCode: '123' });
    // rejected by the name whitelist; and the customers table is still there
    expect(res.status).toBe(400);
    expect((await request(ctx.app).get('/api/manager/customers').set(asManager())).status).toBe(200);
  });
});

describe('open account', () => {
  it('opens an account in the chosen currency and returns the account number', async () => {
    const created = await request(ctx.app)
      .post('/api/manager/customers')
      .set(asManager())
      .send({ firstName: 'Omar', lastName: 'Haddad', postCode: '10001' });
    const res = await request(ctx.app)
      .post('/api/manager/accounts')
      .set(asManager())
      .send({ customerId: created.body.customer.id, currency: 'Pound' });
    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({
      customerId: created.body.customer.id,
      currency: 'Pound',
      balance: '0.00',
    });
    expect(res.body.account.accountNumber).toBeGreaterThanOrEqual(1001);
  });

  it.each([
    ['unsupported currency', { customerId: 1, currency: 'Euro' }, 400],
    ['malformed currency', { customerId: 1, currency: 'dollar ' }, 400],
    ['missing currency', { customerId: 1 }, 400],
    ['missing customer', { currency: 'Dollar' }, 400],
    ['non-numeric customer', { customerId: 'abc', currency: 'Dollar' }, 400],
    ['unknown customer', { customerId: 987654, currency: 'Dollar' }, 404],
  ])('rejects %s', async (_label, body, status) => {
    const res = await request(ctx.app).post('/api/manager/accounts').set(asManager()).send(body);
    expect(res.status).toBe(status);
    expect(res.body.error.message).toBeTruthy();
  });
});

describe('customer list, search and delete', () => {
  it('lists customers with their accounts and filters by name', async () => {
    const c = await ctx.newCustomer({ deposit: '12.34' });
    await request(ctx.app)
      .post('/api/manager/customers')
      .set(asManager())
      .send({ firstName: 'Zebedee', lastName: 'Quix', postCode: 'ZZ9' });

    const all = await request(ctx.app).get('/api/manager/customers').set(asManager());
    expect(all.status).toBe(200);
    const withAccount = all.body.customers.find((x: any) => x.id === c.customerId);
    expect(withAccount.accounts).toMatchObject([{ accountNumber: c.accountNumber, balance: '12.34' }]);

    const filtered = await request(ctx.app).get('/api/manager/customers?search=zebed').set(asManager());
    expect(filtered.body.customers.map((x: any) => x.firstName)).toEqual(['Zebedee']);

    // LIKE wildcards are matched literally, not as "match everything"
    const wildcard = await request(ctx.app).get('/api/manager/customers?search=%25').set(asManager());
    expect(wildcard.body.customers).toEqual([]);
  });

  it('deletes a customer: gone from lists and login, but the ledger is kept', async () => {
    const c = await ctx.newCustomer({ deposit: '40' });
    const del = await request(ctx.app).delete(`/api/manager/customers/${c.customerId}`).set(asManager());
    expect(del.status).toBe(204);

    const list = await request(ctx.app).get('/api/manager/customers').set(asManager());
    expect(list.body.customers.some((x: any) => x.id === c.customerId)).toBe(false);

    // existing token stops working, and they cannot log in again
    expect((await request(ctx.app).get('/api/accounts').set(bearer(c.token))).status).toBe(401);
    const login = await request(ctx.app).post('/api/auth/login').send({ role: 'customer', customerId: c.customerId });
    expect(login.status).toBe(401);

    const [row] = await ctx.db.query('SELECT count(*) AS n FROM transactions WHERE account_id = $1', [c.accountNumber]);
    expect(Number(row.n)).toBe(1);

    const again = await request(ctx.app).delete(`/api/manager/customers/${c.customerId}`).set(asManager());
    expect(again.status).toBe(404);
  });
});
