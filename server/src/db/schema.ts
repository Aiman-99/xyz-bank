import type { Db } from './index.js';

/**
 * Idempotent schema - safe to run on every boot, including several instances
 * booting at the same moment (serverless cold starts): the whole script is one
 * implicit transaction that first takes an advisory lock, so only one instance
 * runs it at a time, and it changes nothing once the schema exists.
 *
 * Integrity is enforced by the database itself, not only by application code:
 *  - balance and amount are BIGINT minor units (no floats)
 *  - CHECK (balance >= 0) makes an overdraft impossible to store
 *  - a trigger rejects any UPDATE / DELETE on the transactions ledger
 */
const SCHEMA = `
SELECT pg_advisory_xact_lock(727274);

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  post_code   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 1001) PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  currency    TEXT NOT NULL CHECK (currency IN ('Dollar', 'Pound', 'Rupee')),
  balance     BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_customer_idx ON accounts(customer_id);

CREATE TABLE IF NOT EXISTS transactions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  type          TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions(account_id, id DESC);

-- One-off markers (e.g. "demo data has been seeded").
CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION transactions_are_immutable() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'transactions are immutable';
END;
$fn$ LANGUAGE plpgsql;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'transactions_immutable' AND tgrelid = 'transactions'::regclass
  ) THEN
    CREATE TRIGGER transactions_immutable
      BEFORE UPDATE OR DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION transactions_are_immutable();
  END IF;
END;
$do$;
`;

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA);
}
