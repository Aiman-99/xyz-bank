import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import type { Db } from './db/index.js';
import { forbidden, unauthorized } from './errors.js';
import { findActiveCustomer, type Customer } from './services/customers.js';

export type Role = 'customer' | 'manager';

export type AuthClaims = { role: 'manager' } | { role: 'customer'; customerId: number };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
      /** Set by requireCustomer: the logged-in, still-active customer. */
      customer?: Customer;
    }
  }
}

export function signToken(claims: AuthClaims): string {
  return jwt.sign(claims, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.tokenTtlSeconds });
}

function verifyToken(token: string): AuthClaims {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'object') {
      if (payload.role === 'manager') return { role: 'manager' };
      if (payload.role === 'customer' && Number.isInteger(payload.customerId)) {
        return { role: 'customer', customerId: payload.customerId };
      }
    }
  } catch {
    // fall through
  }
  throw unauthorized('Invalid or expired session - please log in again');
}

/** Requires a valid signed token. The role comes from the token, never from the request body. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  req.auth = verifyToken(header.slice('Bearer '.length));
  next();
};

export const requireManager: RequestHandler = (req, _res, next) => {
  if (req.auth?.role !== 'manager') throw forbidden('Bank manager access required');
  next();
};

/** Customer-only routes; also re-checks that the customer still exists (not deleted). */
export function requireCustomer(db: Db): RequestHandler {
  return async (req, _res, next) => {
    if (req.auth?.role !== 'customer') throw forbidden('Customer access required');
    const customer = await findActiveCustomer(db, req.auth.customerId);
    if (!customer) throw unauthorized('This customer no longer exists');
    req.customer = customer;
    next();
  };
}
