import { Router } from 'express';
import { authenticate, signToken } from '../auth.js';
import type { Db } from '../db/index.js';
import { unauthorized } from '../errors.js';
import { findActiveCustomer, listCustomerNames } from '../services/customers.js';
import { loginSchema } from '../validation.js';

export function authRoutes(db: Db): Router {
  const router = Router();

  // Public: names for the "Your Name" login picker (ids and names only).
  router.get('/auth/customers', async (_req, res) => {
    res.json({ customers: await listCustomerNames(db) });
  });

  // Lightweight login, mirroring the reference app: pick a role (and a customer).
  // The server issues a signed token; the role is never taken from the client again.
  router.post('/auth/login', async (req, res) => {
    const body = loginSchema.parse(req.body);
    if (body.role === 'manager') {
      res.json({ token: signToken({ role: 'manager' }), role: 'manager' });
      return;
    }
    const customer = await findActiveCustomer(db, body.customerId);
    if (!customer) throw unauthorized('Unknown customer');
    res.json({
      token: signToken({ role: 'customer', customerId: customer.id }),
      role: 'customer',
      customer,
    });
  });

  router.get('/me', authenticate, async (req, res) => {
    if (req.auth!.role === 'manager') {
      res.json({ role: 'manager' });
      return;
    }
    const customer = await findActiveCustomer(db, req.auth!.customerId);
    if (!customer) throw unauthorized('This customer no longer exists');
    res.json({ role: 'customer', customer });
  });

  return router;
}
