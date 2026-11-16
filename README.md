# XYZ Bank

A full-stack rebuild of the GlobalSQA "XYZ Bank" demo: a Node.js REST API with
PostgreSQL persistence and server-enforced business rules, plus a React client
that is driven entirely by that API.

**Live URL:** `TODO - paste your Vercel URL here, e.g. https://xyz-bank.vercel.app`
**Hosting:** Vercel (frontend on its CDN, API as a Vercel Function) and Neon (PostgreSQL)

## Stack and why

| Layer    | Choice                                   | Why |
| -------- | ---------------------------------------- | --- |
| Backend  | Node.js, TypeScript, Express 5           | Small, well understood; async errors propagate to one error handler. |
| Database | PostgreSQL (`pg`)                        | Row locks, CHECK constraints and triggers let the database itself guarantee the money rules. |
| Validation | Zod                                    | One schema per request, consistent 400 responses. |
| Auth     | Signed JWT (HS256) carrying the role     | Lightweight as the brief allows, but the role is verified server-side on every request. |
| Frontend | React 19 + Vite + TypeScript             | Minimal: no state library, no router - it just renders what the API returns. |
| Tests    | Vitest + Supertest                       | HTTP-level tests against the real Express app and a real Postgres engine. |

## Run locally

Requires Node.js 20+. No database to install: without `DATABASE_URL` the server
uses an embedded Postgres ([PGlite](https://pglite.dev)) stored in `server/.data`.

```bash
npm install
npm run dev
```

Open http://localhost:5173 (API on http://localhost:3000). Demo data is seeded
on first start.

To run the production build the way it is deployed (one process serving API and frontend on port 3000):

```bash
npm run build
npm start
```

To use a real PostgreSQL locally, set `DATABASE_URL` before starting (see `.env.example`).

### Demo data / logins

There are no passwords (same as the reference app):

- **Customer Login** - pick a name: Aisha Rahman (accounts 1001 Dollar, 1002 Pound), Daniel Lee (1003 Dollar), Priya Nair (1004 Rupee).
- **Bank Manager Login** - one click.

## Tests

Frameworks: **Vitest** (runner/assertions) and **Supertest** (HTTP requests against the Express app).

```bash
npm test
```

68 tests in `server/test`:

- `money.test.ts` - amount parsing to integer minor units, float traps, invalid inputs
- `customer.test.ts` - deposit, withdraw, over-balance rejection, history, ownership, ledger immutability
- `manager.test.ts` - add customer, open account, validation, list / search / delete
- `auth.test.ts` - 401/403 behaviour, forged tokens, customer cannot call manager endpoints
- `concurrency.test.ts` - 20 simultaneous withdrawals of 10.00 from 100.00: exactly 10 succeed, balance ends at 0 and equals the ledger

By default the tests use in-memory embedded Postgres, so they need no setup.
Embedded Postgres runs one statement at a time, so to exercise real lock
contention the same suite can run against a real server (CI does this):

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/xyzbank_test npm test
```

**Warning:** that truncates every table in the target database - never point it at production.

## API

Base path `/api`. JSON in and out. Authenticated routes need `Authorization: Bearer <token>`.
Amounts are sent as decimal strings (`"12.34"`) and returned as both a decimal
string (`balance`) and integer minor units (`balanceMinor`).

| Method | Path | Role | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/health` | public | Liveness + database check |
| GET | `/auth/customers` | public | `[{ id, name }]` for the login picker |
| POST | `/auth/login` | public | `{ role: "manager" }` or `{ role: "customer", customerId }` -> `{ token, role, customer? }` |
| GET | `/me` | any | Current role / customer |
| GET | `/accounts` | customer | The caller's accounts |
| GET | `/accounts/:id` | customer | One account: number, balance, currency |
| POST | `/accounts/:id/deposit` | customer | `{ amount }` -> `201 { account, transaction }` |
| POST | `/accounts/:id/withdraw` | customer | `{ amount }` -> `201 { account, transaction }`, or `422 INSUFFICIENT_FUNDS` |
| GET | `/accounts/:id/transactions?limit&offset` | customer | History, newest first, with `total` |
| GET | `/manager/customers?search=` | manager | Customers with their accounts |
| POST | `/manager/customers` | manager | `{ firstName, lastName, postCode }` -> `201 { customer }` |
| DELETE | `/manager/customers/:id` | manager | `204` (soft delete) |
| POST | `/manager/accounts` | manager | `{ customerId, currency }` -> `201 { account }` |

Errors always have the shape `{ "error": { "code", "message", "details?" } }`:

| Status | Code | When |
| ------ | ---- | ---- |
| 400 | `VALIDATION_ERROR` / `BAD_REQUEST` | Missing or invalid field, bad amount, malformed JSON |
| 401 | `UNAUTHORIZED` | No / invalid / expired token, or the customer was deleted |
| 403 | `FORBIDDEN` | Valid token, wrong role |
| 404 | `NOT_FOUND` | Unknown account or customer - including another customer's account |
| 422 | `INSUFFICIENT_FUNDS` | Withdrawal larger than the balance (nothing is changed) |
| 429 | - | Rate limit (300 requests / minute / IP) |

## Deployment

Deployed on **Vercel** with a **Neon** PostgreSQL database. Frontend and API
share one origin (no CORS, one URL):

- The Express app (`server/src/index.ts`, default export) runs as a single Vercel Function.
- The React build is written to `server/public`, which Vercel serves from its CDN.
- `server/vercel.json` tells Vercel to build the client first.

Steps:

1. Push this repository to GitHub.
2. In Vercel: **Add New -> Project**, import the repository, and set **Root Directory** to `server`. Vercel detects Express automatically.
3. In the project's **Storage** tab, create a **Neon** Postgres database and connect it to the project. This adds `DATABASE_URL` to the project's environment variables.
4. In **Settings -> Environment Variables**, add `JWT_SECRET` with a long random value.
5. Redeploy. On the first request the app creates its tables and seeds the demo customers. Every push to the main branch redeploys.

Environment variables: `DATABASE_URL` (from the Neon integration) and `JWT_SECRET`.

The same code also runs as an ordinary long-running Node server (`npm run build && npm start`),
which is what `render.yaml` uses if you prefer Render: there the server listens on `PORT`
and serves `server/public` itself.

## Project layout

```
server/src
  app.ts            Express app: middleware, routes, static frontend
  index.ts          Entry: exports the app (Vercel) or listens on a port (elsewhere)
  auth.ts           Token signing/verification, role guards
  money.ts          Amount parsing/formatting (integer minor units)
  validation.ts     Zod request schemas
  errors.ts         AppError + single error handler
  db/               Connection (pg or PGlite), schema, seed
  services/         Business logic + SQL (accounts, customers)
  routes/           HTTP layer (auth, customer, manager)
server/test         Vitest + Supertest suites
server/public       Built frontend (generated by the client build, not committed)
server/vercel.json  Vercel build setting
client/src          React app (Login, CustomerView, ManagerView, api.ts)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, the concurrency
guarantee, trade-offs and known limitations.

## Scope

Done: all core requirements, plus these stretch items - multiple accounts with
switching, customer search and delete, pagination on the history endpoint,
rate limiting, security headers, CI workflow.

Not done (deliberately): Docker setup, OpenAPI/Swagger (the table above is the
API documentation), frontend tests, real passwords. See ARCHITECTURE.md.
