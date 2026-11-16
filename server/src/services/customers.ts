import type { Db, Row } from '../db/index.js';
import { notFound } from '../errors.js';
import { toAccount, type Account } from './accounts.js';

export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  postCode: string;
}

export interface CustomerWithAccounts extends Customer {
  accounts: Account[];
}

const toCustomer = (row: Row): Customer => ({
  id: Number(row.id),
  firstName: row.first_name,
  lastName: row.last_name,
  postCode: row.post_code,
});

export async function createCustomer(
  db: Db,
  input: { firstName: string; lastName: string; postCode: string },
): Promise<Customer> {
  const [row] = await db.query(
    `INSERT INTO customers (first_name, last_name, post_code)
     VALUES ($1, $2, $3)
     RETURNING id, first_name, last_name, post_code`,
    [input.firstName, input.lastName, input.postCode],
  );
  return toCustomer(row);
}

/** Returns the customer, or undefined if unknown or deleted. */
export async function findActiveCustomer(db: Db, id: number): Promise<Customer | undefined> {
  const [row] = await db.query(
    `SELECT id, first_name, last_name, post_code
       FROM customers WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return row ? toCustomer(row) : undefined;
}

/** Names only - used by the public login picker, so no post codes or balances. */
export async function listCustomerNames(db: Db): Promise<{ id: number; name: string }[]> {
  const rows = await db.query(
    `SELECT id, first_name, last_name FROM customers
      WHERE deleted_at IS NULL ORDER BY first_name, last_name, id`,
  );
  return rows.map((r) => ({ id: Number(r.id), name: `${r.first_name} ${r.last_name}` }));
}

/** All active customers with their accounts, optionally filtered by name / post code. */
export async function listCustomers(db: Db, search?: string): Promise<CustomerWithAccounts[]> {
  // Escape LIKE wildcards so the search term is matched literally.
  const pattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;
  const rows = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.post_code,
            a.id AS account_id, a.customer_id, a.currency, a.balance
       FROM customers c
       LEFT JOIN accounts a ON a.customer_id = c.id
      WHERE c.deleted_at IS NULL
        AND ($1::text IS NULL
             OR c.first_name ILIKE $1 OR c.last_name ILIKE $1 OR c.post_code ILIKE $1
             OR (c.first_name || ' ' || c.last_name) ILIKE $1)
      ORDER BY c.id, a.id`,
    [pattern],
  );
  const byId = new Map<number, CustomerWithAccounts>();
  for (const row of rows) {
    const id = Number(row.id);
    let customer = byId.get(id);
    if (!customer) {
      customer = { ...toCustomer(row), accounts: [] };
      byId.set(id, customer);
    }
    if (row.account_id !== null) {
      customer.accounts.push(toAccount({ ...row, id: row.account_id }));
    }
  }
  return [...byId.values()];
}

/**
 * Soft delete: the customer disappears from the app and can no longer log in,
 * but their accounts and the immutable transaction ledger are retained.
 */
export async function deleteCustomer(db: Db, id: number): Promise<void> {
  const rows = await db.query(
    `UPDATE customers SET deleted_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
  );
  if (rows.length === 0) throw notFound('Customer');
}
