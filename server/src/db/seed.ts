import type { Db } from './index.js';
import type { Currency } from '../money.js';
import { deposit, openAccount } from '../services/accounts.js';
import { createCustomer } from '../services/customers.js';

const DEMO: { first: string; last: string; postCode: string; accounts: [Currency, number][] }[] = [
  { first: 'Aisha', last: 'Rahman', postCode: 'E1 6AN', accounts: [['Dollar', 150_000], ['Pound', 42_050]] },
  { first: 'Daniel', last: 'Lee', postCode: '50450', accounts: [['Dollar', 20_000]] },
  { first: 'Priya', last: 'Nair', postCode: '682001', accounts: [['Rupee', 7_500_000]] },
];

/**
 * Insert demo data on first boot only (when there are no customers), so the
 * deployed app is usable on arrival. Opening balances go through the normal
 * deposit path, so they appear in the ledger like any other credit.
 */
export async function seedIfEmpty(db: Db): Promise<boolean> {
  const [{ count }] = await db.query('SELECT count(*) AS count FROM customers');
  if (Number(count) > 0) return false;

  // Two instances can boot at once on serverless hosting. Only the one that
  // inserts this marker row seeds; the primary key makes the other a no-op.
  const claimed = await db.query(
    `INSERT INTO app_meta (key) VALUES ('demo_seeded') ON CONFLICT (key) DO NOTHING RETURNING key`,
  );
  if (claimed.length === 0) return false;

  for (const demo of DEMO) {
    const customer = await createCustomer(db, {
      firstName: demo.first,
      lastName: demo.last,
      postCode: demo.postCode,
    });
    for (const [currency, openingMinor] of demo.accounts) {
      const account = await openAccount(db, customer.id, currency);
      await deposit(db, customer.id, account.accountNumber, openingMinor);
    }
  }
  return true;
}
