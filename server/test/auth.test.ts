import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('authentication', () => {
  it('rejects requests with no token (401)', async () => {
    expect((await request(ctx.app).get('/api/accounts')).status).toBe(401);
    expect((await request(ctx.app).get('/api/manager/customers')).status).toBe(401);
    expect((await request(ctx.app).get('/api/me')).status).toBe(401);
  });

  it('rejects forged, tampered and unsigned tokens (401)', async () => {
    const forged = jwt.sign({ role: 'manager' }, 'not-the-server-secret');
    const unsigned = jwt.sign({ role: 'manager' }, '', { algorithm: 'none' });
    for (const token of [forged, unsigned, 'garbage']) {
      const res = await request(ctx.app).get('/api/manager/customers').set(bearer(token));
      expect(res.status).toBe(401);
    }
  });

  it('validates the login request', async () => {
    const login = (body: object) => request(ctx.app).post('/api/auth/login').send(body);
    expect((await login({})).status).toBe(400);
    expect((await login({ role: 'admin' })).status).toBe(400);
    expect((await login({ role: 'customer' })).status).toBe(400);
    expect((await login({ role: 'customer', customerId: 424242 })).status).toBe(401);
  });

  it('GET /me reports the role held by the token', async () => {
    const c = await ctx.newCustomer();
    const me = await request(ctx.app).get('/api/me').set(bearer(c.token));
    expect(me.body).toMatchObject({ role: 'customer', customer: { id: c.customerId } });
    const manager = await request(ctx.app).get('/api/me').set(bearer(ctx.managerToken));
    expect(manager.body).toEqual({ role: 'manager' });
  });
});

describe('role enforcement (server-side)', () => {
  it('a customer cannot call manager-only endpoints, even with a hand-crafted request (403)', async () => {
    const c = await ctx.newCustomer();
    const auth = bearer(c.token);
    const attempts = [
      request(ctx.app).get('/api/manager/customers').set(auth),
      request(ctx.app)
        .post('/api/manager/customers')
        .set(auth)
        .send({ firstName: 'Evil', lastName: 'Twin', postCode: '123', role: 'manager' }),
      request(ctx.app).post('/api/manager/accounts').set(auth).send({ customerId: c.customerId, currency: 'Dollar' }),
      request(ctx.app).delete(`/api/manager/customers/${c.customerId}`).set(auth),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // nothing was created or deleted
    const list = await request(ctx.app).get('/api/manager/customers').set(bearer(ctx.managerToken));
    expect(list.body.customers.some((x: any) => x.firstName === 'Evil')).toBe(false);
    expect(list.body.customers.some((x: any) => x.id === c.customerId)).toBe(true);
  });

  it('a manager cannot call customer money endpoints (403)', async () => {
    const c = await ctx.newCustomer({ deposit: '100' });
    const auth = bearer(ctx.managerToken);
    expect((await request(ctx.app).get('/api/accounts').set(auth)).status).toBe(403);
    const withdraw = await request(ctx.app)
      .post(`/api/accounts/${c.accountNumber}/withdraw`)
      .set(auth)
      .send({ amount: '1' });
    expect(withdraw.status).toBe(403);
  });

  it('the public login picker exposes names only', async () => {
    await ctx.newCustomer({ deposit: '100' });
    const res = await request(ctx.app).get('/api/auth/customers');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.customers[0]).sort()).toEqual(['id', 'name']);
  });
});
