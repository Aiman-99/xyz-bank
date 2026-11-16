import { z } from 'zod';
import { badRequest } from './errors.js';
import { CURRENCIES } from './money.js';

const name = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(50, `${label} must be at most 50 characters`)
    .regex(/^[\p{L}][\p{L} '.-]*$/u, `${label} may only contain letters, spaces, apostrophes and hyphens`);

const id = (label: string) =>
  z
    .number({ error: `${label} is required and must be a number` })
    .int(`${label} must be a whole number`)
    .positive(`${label} must be positive`)
    .max(2_147_483_647, `${label} is out of range`);

export const loginSchema = z.discriminatedUnion(
  'role',
  [
    z.object({ role: z.literal('manager') }),
    z.object({ role: z.literal('customer'), customerId: id('customerId') }),
  ],
  { error: 'role must be "customer" or "manager"' },
);

export const createCustomerSchema = z.object({
  firstName: name('First name'),
  lastName: name('Last name'),
  postCode: z
    .string({ error: 'Post code is required' })
    .trim()
    .min(1, 'Post code is required')
    .max(12, 'Post code must be at most 12 characters')
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]*$/, 'Post code may only contain letters, digits, spaces and hyphens'),
});

export const openAccountSchema = z.object({
  customerId: id('Customer id'),
  currency: z.enum(CURRENCIES, { error: `Currency must be one of: ${CURRENCIES.join(', ')}` }),
});

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const searchSchema = z.object({
  search: z.string().trim().max(50).optional(),
});

/** Parse a numeric id from the URL path, e.g. /accounts/:id */
export function parseIdParam(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2_147_483_647) {
    throw badRequest(`${label} must be a positive whole number`);
  }
  return Number(value);
}
