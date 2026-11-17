# Architecture and decisions

## Data model

```
customers     id, first_name, last_name, post_code, created_at, deleted_at
accounts      id (account number, from 1001), customer_id -> customers,
              currency  CHECK IN ('Dollar','Pound','Rupee'),
              balance   BIGINT  CHECK (balance >= 0)
transactions  id, account_id -> accounts, type CHECK IN ('credit','debit'),
              amount BIGINT CHECK (amount > 0), balance_after BIGINT, created_at DEFAULT now()
```

- **Money is integer minor units** (cents / pence / paise) in `BIGINT` columns
  and plain integers in code. Decimal text is converted at the API boundary by
  a regex + integer arithmetic (`server/src/money.ts`); no float ever takes
  part in a calculation. A JSON number is accepted only if its exact decimal
  text is a valid amount, so `0.1 + 0.2` is rejected rather than rounded.
- **Balance is stored, and every change writes a ledger row in the same
  statement.** Reading a balance is O(1), and the invariant
  `balance == sum(credits) - sum(debits)` is asserted in the tests. The
  alternative (deriving the balance from the ledger on every read) removes the
  duplicated state but makes the overdraft check a read-then-write that needs
  explicit locking anyway.
- **Transactions are immutable at the database level**: a trigger raises on
  any `UPDATE` or `DELETE` of `transactions`. Timestamps are `now()` on the
  server; the client cannot supply them.
- **Deleting a customer is a soft delete** (`deleted_at`). The customer
  disappears from lists and can no longer log in (existing tokens stop working
  too), but accounts and history are kept - a hard delete would mean deleting
  ledger rows.

## Balance correctness under concurrency

A deposit or withdrawal is a single SQL statement (`services/accounts.ts`):

```sql
WITH moved AS (
  UPDATE accounts SET balance = balance - $amount
   WHERE id = $account AND customer_id = $owner AND balance >= $amount
  RETURNING id, balance
)
INSERT INTO transactions (account_id, type, amount, balance_after)
SELECT id, 'debit', $amount, balance FROM moved
RETURNING ...
```

- **Atomic:** one statement either fully applies or not at all, so the balance
  can never move without its ledger row, and there is no partial update to
  roll back.
- **No lost updates / no overdraft race:** the `UPDATE` takes a row lock. A
  second concurrent withdrawal blocks on it; when the first commits, Postgres
  re-evaluates `balance >= $amount` against the new row version (READ COMMITTED
  semantics), so it either succeeds against the reduced balance or matches no
  row. There is no separate "read balance, then write" step in application
  code to race on.
- **Ownership** is in the same `WHERE`, so the authorisation check cannot be
  separated from the write.
- **Backstop:** `CHECK (balance >= 0)` means that even a bug in this logic
  could not persist a negative balance.

If no row is returned, a follow-up read distinguishes "account not found / not
yours" (404) from "insufficient funds" (422). That read only chooses the error
message; no money decision depends on it.

Tested in `server/test/concurrency.test.ts`. Locally the suite runs on
embedded Postgres, which serialises statements, so it proves the handler has no
read-modify-write gap; the CI workflow (GitHub Actions) runs the same tests
against a real PostgreSQL with a connection pool, where genuine lock contention
occurs, and passes.

**Verified on the live deployment (16 Nov 2026).** A manual check against the
production site (Vercel + Neon PostgreSQL) sent real simultaneous requests to
demo account 1003:

| Check | Requests | Result |
| ----- | -------- | ------ |
| Two at once | 2 x withdraw 160.00 from a 200.00 balance | 1 succeeded (201), 1 rejected (422 insufficient funds); balance 40.00 |
| Ten at once | 10 x withdraw 8.00 from a 40.00 balance | exactly 5 succeeded, 5 rejected; balance 0.00, never negative |
| Ledger | credits minus debits for the account | equal to the stored balance |

The balance was then restored with a deposit. The test's transactions are still
in that account's history, since ledger rows cannot be deleted. This was a
one-off manual run, not an automated test.

## Security and trust boundaries

- The role and customer id come only from the signed token. Role guards run on
  the server for every route; a customer token gets 403 on `/manager/*`.
- Every customer query is scoped by `customer_id` from the token. Another
  customer's account returns 404, not 403, so account numbers cannot be probed.
- The client is never trusted for balances, currency, transaction type or
  timestamps - the API accepts only an amount, and re-validates it.
- All SQL is parameterised; search input has LIKE wildcards escaped. Helmet
  sets security headers; request bodies are capped at 10 kB; rate limiting is
  300 requests/minute per IP.

## Structure

`routes/` (HTTP, validation) -> `services/` (business rules + SQL) -> `db/`
(a three-method `Db` interface implemented by `pg` and by PGlite). The app is
built by `createApp(db)`, which is what makes it testable without a network or
global state.

## Known limitations

- **No real authentication.** As in the reference app, anyone can log in as any
  customer or as the manager. Authorisation is enforced properly, but identity
  is not proven. The public demo is therefore open to anyone - including
  deleting customers.
- **Embedded Postgres for local dev/tests** is single-connection. It is real
  Postgres SQL (constraints, triggers, the same statements), but true
  multi-connection contention is only exercised in CI, with `TEST_DATABASE_URL`,
  or by the manual live check described above.
- **No idempotency keys:** a client that retries a timed-out deposit could
  apply it twice.
- **Schema is applied by an idempotent script on boot**, not a versioned
  migration tool. Fine for one table set; not for evolving a schema. On
  serverless hosting "boot" is the first request to a fresh instance; the
  script takes an advisory lock so simultaneous cold starts cannot collide,
  and the demo seed is claimed by a marker row so it runs once.
- **Rate limiting is per instance.** The counter is in memory, and Vercel can
  run several instances, so the effective limit is looser than 300/minute. A
  shared store (e.g. Redis) would fix that.
- **Money safety does not depend on the app being a single process.** The
  guarantee lives in the database statement, so it holds across any number of
  serverless instances.
- **Token in localStorage**, 8-hour expiry, no refresh or server-side
  revocation (deleted customers are rejected because the customer is re-checked
  on each request).
- The transaction list in the UI shows the latest 200 rows; the API paginates
  but the UI has no pager.
- The first request after a quiet period is slower (a new function instance
  starts and Neon's free database wakes up).

## With more time

1. Real login (password hashing or an identity provider), httpOnly cookie sessions.
2. Idempotency keys on deposit / withdraw.
3. A migration tool (e.g. node-pg-migrate) and a periodic ledger-vs-balance reconciliation check.
4. OpenAPI spec generated from the Zod schemas; Docker Compose for local Postgres.
5. Frontend tests (Playwright) for the main flows; pagination UI.
