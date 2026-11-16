import { Router } from 'express';
import { authenticate, requireCustomer } from '../auth.js';
import type { Db } from '../db/index.js';
import { parseAmount } from '../money.js';
import { deposit, getAccount, listAccounts, listTransactions, withdraw } from '../services/accounts.js';
import { pageSchema, parseIdParam } from '../validation.js';

/**
 * Customer-only endpoints. Every query is scoped to req.customer.id (from the
 * signed token), so a customer can never read or move money on another
 * customer's account, whatever account id they put in the URL.
 */
export function customerRoutes(db: Db): Router {
  const router = Router();
  router.use('/accounts', authenticate, requireCustomer(db));

  router.get('/accounts', async (req, res) => {
    res.json({ accounts: await listAccounts(db, req.customer!.id) });
  });

  router.get('/accounts/:id', async (req, res) => {
    const accountId = parseIdParam(req.params.id, 'Account number');
    res.json({ account: await getAccount(db, req.customer!.id, accountId) });
  });

  router.post('/accounts/:id/deposit', async (req, res) => {
    const accountId = parseIdParam(req.params.id, 'Account number');
    const amount = parseAmount(req.body?.amount);
    res.status(201).json(await deposit(db, req.customer!.id, accountId, amount));
  });

  router.post('/accounts/:id/withdraw', async (req, res) => {
    const accountId = parseIdParam(req.params.id, 'Account number');
    const amount = parseAmount(req.body?.amount);
    res.status(201).json(await withdraw(db, req.customer!.id, accountId, amount));
  });

  router.get('/accounts/:id/transactions', async (req, res) => {
    const accountId = parseIdParam(req.params.id, 'Account number');
    const page = pageSchema.parse(req.query);
    const result = await listTransactions(db, req.customer!.id, accountId, page);
    res.json({ ...result, ...page });
  });

  return router;
}
