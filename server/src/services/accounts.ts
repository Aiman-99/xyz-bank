import type { Db, Row } from '../db/index.js';
import { AppError, notFound } from '../errors.js';
import { formatMinor, type Currency } from '../money.js';

export interface Account {
  accountNumber: number;
  customerId: number;
  currency: Currency;
  /** Decimal string, e.g. "1500.00" */
  balance: string;
  /** Integer minor units, e.g. 150000 */
  balanceMinor: number;
}

export interface Transaction {
  id: number;
  accountNumber: number;
  type: 'credit' | 'debit';
  amount: string;
  amountMinor: number;
  balanceAfter: string;
  createdAt: string;
}

export const toAccount = (row: Row): Account => {
  const balanceMinor = Number(row.balance);
  return {
    accountNumber: Number(row.id),
    customerId: Number(row.customer_id),
    currency: row.currency,
    balance: formatMinor(balanceMinor),
    balanceMinor,
  };
};

const toTransaction = (row: Row): Transaction => {
  const amountMinor = Number(row.amount);
  return {
    id: Number(row.id),
    accountNumber: Number(row.account_id),
    type: row.type,
    amount: formatMinor(amountMinor),
    amountMinor,
    balanceAfter: formatMinor(Number(row.balance_after)),
    createdAt: new Date(row.created_at).toISOString(),
  };
};

export async function openAccount(db: Db, customerId: number, currency: Currency): Promise<Account> {
  // INSERT ... SELECT so the "customer exists and is active" check and the insert are one statement.
  const [row] = await db.query(
    `INSERT INTO accounts (customer_id, currency)
     SELECT id, $2 FROM customers WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, customer_id, currency, balance`,
    [customerId, currency],
  );
  if (!row) throw notFound('Customer');
  return toAccount(row);
}

export async function listAccounts(db: Db, customerId: number): Promise<Account[]> {
  const rows = await db.query(
    `SELECT id, customer_id, currency, balance FROM accounts WHERE customer_id = $1 ORDER BY id`,
    [customerId],
  );
  return rows.map(toAccount);
}

/**
 * Fetch an account, scoped to its owner. Someone else's account is reported as
 * "not found" (not "forbidden") so account numbers cannot be probed.
 */
export async function getAccount(db: Db, customerId: number, accountId: number): Promise<Account> {
  const [row] = await db.query(
    `SELECT id, customer_id, currency, balance FROM accounts WHERE id = $1 AND customer_id = $2`,
    [accountId, customerId],
  );
  if (!row) throw notFound('Account');
  return toAccount(row);
}

export interface MoneyMovement {
  account: Account;
  transaction: Transaction;
}

/**
 * Deposits and withdrawals are each ONE SQL statement: a conditional UPDATE of the
 * balance whose result feeds the INSERT of the ledger row.
 *
 *  - Atomic: a single statement either fully happens or not at all, so the balance
 *    can never change without its transaction record (or vice versa).
 *  - Race-safe: the UPDATE takes a row lock. A concurrent withdrawal waits, then
 *    Postgres re-evaluates `balance >= amount` against the freshly committed row,
 *    so two withdrawals can never both spend the same money (no lost update).
 *  - Ownership is part of the WHERE clause, so it is checked in the same step.
 */
async function moveMoney(
  db: Db,
  type: 'credit' | 'debit',
  customerId: number,
  accountId: number,
  amountMinor: number,
): Promise<MoneyMovement | undefined> {
  const change =
    type === 'credit'
      ? `SET balance = balance + $1::bigint WHERE id = $2 AND customer_id = $3`
      : `SET balance = balance - $1::bigint WHERE id = $2 AND customer_id = $3 AND balance >= $1::bigint`;
  const [row] = await db.query(
    `WITH moved AS (
       UPDATE accounts ${change}
       RETURNING id, customer_id, currency, balance
     ), entry AS (
       INSERT INTO transactions (account_id, type, amount, balance_after)
       SELECT id, $4, $1::bigint, balance FROM moved
       RETURNING id AS tx_id, account_id, type, amount, balance_after, created_at
     )
     SELECT moved.id, moved.customer_id, moved.currency, moved.balance,
            entry.tx_id, entry.account_id, entry.type, entry.amount,
            entry.balance_after, entry.created_at
       FROM moved, entry`,
    [amountMinor, accountId, customerId, type],
  );
  if (!row) return undefined;
  return { account: toAccount(row), transaction: toTransaction({ ...row, id: row.tx_id }) };
}

export async function deposit(
  db: Db,
  customerId: number,
  accountId: number,
  amountMinor: number,
): Promise<MoneyMovement> {
  const result = await moveMoney(db, 'credit', customerId, accountId, amountMinor);
  if (!result) throw notFound('Account');
  return result;
}

export async function withdraw(
  db: Db,
  customerId: number,
  accountId: number,
  amountMinor: number,
): Promise<MoneyMovement> {
  const result = await moveMoney(db, 'debit', customerId, accountId, amountMinor);
  if (result) return result;
  // Nothing was changed. Work out why, purely to give a precise error:
  // getAccount throws 404 if the account is missing / not the caller's.
  const account = await getAccount(db, customerId, accountId);
  throw new AppError(
    422,
    'INSUFFICIENT_FUNDS',
    `Insufficient funds: cannot withdraw ${formatMinor(amountMinor)} from a balance of ${account.balance}`,
  );
}

export async function listTransactions(
  db: Db,
  customerId: number,
  accountId: number,
  page: { limit: number; offset: number },
): Promise<{ transactions: Transaction[]; total: number }> {
  await getAccount(db, customerId, accountId); // ownership check
  const rows = await db.query(
    `SELECT id, account_id, type, amount, balance_after, created_at
       FROM transactions WHERE account_id = $1
      ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [accountId, page.limit, page.offset],
  );
  const [{ count }] = await db.query(`SELECT count(*) AS count FROM transactions WHERE account_id = $1`, [
    accountId,
  ]);
  return { transactions: rows.map(toTransaction), total: Number(count) };
}
