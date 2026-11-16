import { badRequest } from './errors.js';

/**
 * Money is handled as integer minor units (cents / pence / paise) everywhere:
 * BIGINT in the database, integers in code. Decimal strings are only parsed
 * and produced at the API boundary, using string/integer arithmetic - never floats.
 */

export const CURRENCIES = ['Dollar', 'Pound', 'Rupee'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Largest single deposit / withdrawal: 1,000,000,000.00 (one billion). */
export const MAX_AMOUNT_MINOR = 100_000_000_000;

/**
 * Largest balance an account may hold: 1,000,000,000,000.00 (one trillion).
 * Far below Number.MAX_SAFE_INTEGER (about 90 trillion in minor units), so a
 * balance is always an exact integer in JavaScript as well as in the database.
 */
export const MAX_BALANCE_MINOR = 100_000_000_000_000;

const AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/**
 * Parse a client-supplied amount ("12.34", "12", 12.5) into minor units.
 * Rejects missing, non-numeric, negative, zero, >2 decimal places and absurdly large values.
 */
export function parseAmount(input: unknown): number {
  if (input === undefined || input === null || input === '') {
    throw badRequest('Amount is required');
  }
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw badRequest('Amount must be a number');
  }
  // A JSON number is only accepted if its exact decimal text is a valid amount;
  // it is never used in floating-point arithmetic.
  const text = typeof input === 'number' ? String(input) : input.trim();
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) {
    throw badRequest('Amount must be a positive number with at most 2 decimal places');
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = whole * 100 + fraction;
  if (minor <= 0) throw badRequest('Amount must be greater than zero');
  if (minor > MAX_AMOUNT_MINOR) {
    throw badRequest(`Amount must not exceed ${formatMinor(MAX_AMOUNT_MINOR)}`);
  }
  return minor;
}

/** 123456 -> "1234.56" */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
