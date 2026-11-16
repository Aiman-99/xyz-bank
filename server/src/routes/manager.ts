import { Router } from 'express';
import { authenticate, requireManager } from '../auth.js';
import type { Db } from '../db/index.js';
import { openAccount } from '../services/accounts.js';
import { createCustomer, deleteCustomer, listCustomers } from '../services/customers.js';
import { createCustomerSchema, openAccountSchema, parseIdParam, searchSchema } from '../validation.js';

/** Bank-manager-only endpoints. */
export function managerRoutes(db: Db): Router {
  const router = Router();
  router.use('/manager', authenticate, requireManager);

  router.get('/manager/customers', async (req, res) => {
    const { search } = searchSchema.parse(req.query);
    res.json({ customers: await listCustomers(db, search || undefined) });
  });

  router.post('/manager/customers', async (req, res) => {
    const input = createCustomerSchema.parse(req.body ?? {});
    res.status(201).json({ customer: await createCustomer(db, input) });
  });

  router.delete('/manager/customers/:id', async (req, res) => {
    await deleteCustomer(db, parseIdParam(req.params.id, 'Customer id'));
    res.status(204).end();
  });

  router.post('/manager/accounts', async (req, res) => {
    const { customerId, currency } = openAccountSchema.parse(req.body ?? {});
    res.status(201).json({ account: await openAccount(db, customerId, currency) });
  });

  return router;
}
