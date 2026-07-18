# Wallet and Payments API

A NestJS API for registering users, funding an NGN wallet through Paystack, transferring to another user, and withdrawing to a Nigerian bank account. PostgreSQL is the source of truth for balances and ledger history; Redis is used for short-lived reads and BullMQ jobs.

The submission deadline is interpreted in **Africa/Lagos (WAT, UTC+1)**: Saturday, July 18, 2026 at 11:59 PM.

## Stack

- TypeScript and NestJS
- PostgreSQL, Sequelize models, and Umzug migrations
- Redis for wallet-view caching
- BullMQ for asynchronous mock email notifications
- Paystack behind a payment-provider interface and active-provider registry
- JWT authentication and bcrypt password hashing
- Swagger/OpenAPI at `/docs` and `/docs/openapi.json`

## Run locally

Requirements: Node.js 22+, npm, PostgreSQL 16+, Redis 7+, and a Paystack test secret key.

Start PostgreSQL and Redis with your operating system's service manager, create a PostgreSQL database, and set its connection string in `.env`.

```bash
cp .env.example .env
npm install
npm run migration:run
npm run start:dev
```

Set `PAYSTACK_SECRET_KEY` in `.env` before starting. The API runs at `http://localhost:3000/api/v1`, Swagger at `http://localhost:3000/docs`, and the Paystack webhook URL is:

```text
https://your-public-host/api/v1/webhooks/payments
```

The webhook route is provider-neutral. `PAYMENT_PROVIDER=paystack` selects Paystack today. A second provider can be added by implementing `paymentProvider`, registering it in `paymentsModule`, and adding it to `paymentProviderRegistry`; wallet and webhook business logic does not depend on Paystack payloads.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_SYNCHRONIZE` | Development-only schema sync; keep `false` outside tests |
| `DATABASE_SSL` | Set `true` when a hosted PostgreSQL service requires TLS |
| `JWT_SECRET` | JWT signing secret, at least 32 random characters recommended |
| `JWT_EXPIRES_IN_SECONDS` | Access-token lifetime in seconds, default `3600` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Redis connection |
| `PAYMENT_PROVIDER` | Active provider name; currently `paystack` |
| `PAYSTACK_SECRET_KEY` | Paystack server-side secret key and webhook signing key |
| `PAYSTACK_BASE_URL` | Defaults to `https://api.paystack.co` |
| `APP_BASE_URL` | Public application URL used for payment callbacks |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to send credentialed requests |

## Authentication

Registration and login return the JWT in the response body and also set it as an HTTP-only `accessToken` cookie. Protected endpoints check that cookie first and fall back to an `Authorization: Bearer <token>` header. In production the cookie is secure, uses `SameSite=Strict`, and is unavailable to browser JavaScript.

Swagger automatically sends the cookie after registration or login from `/docs`. Its **Authorize** control remains available for testing the bearer-header fallback, and manually entered authorization is preserved across page reloads.

## API flow

All monetary values are positive integer **kobo**. Only NGN is supported.

1. `POST /api/v1/auth/register` creates a user and zero-balance wallet.
2. `POST /api/v1/auth/login` returns a bearer token and sets the JWT session cookie.
3. `POST /api/v1/deposits` creates a pending deposit and returns a Paystack checkout URL.
4. Paystack sends `charge.success` to `POST /api/v1/webhooks/payments`; only a valid signature and exact reference/amount/currency match can credit the wallet.
5. `POST /api/v1/transfers` moves money between platform wallets atomically.
6. `POST /api/v1/withdrawals` reserves the wallet funds and initiates a Paystack transfer to the bank account.
7. `GET /api/v1/wallet` returns the cached wallet view; `GET /api/v1/wallet/ledger` returns the PostgreSQL audit history.

Send an optional `Idempotency-Key` header on deposit, transfer, and withdrawal requests. Reusing a key for the same wallet returns the existing operation. If omitted, the API assigns a new UUID, so clients should provide one for safe retries.

Example registration and transfer:

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","username":"ada","password":"password123"}'

curl -X POST http://localhost:3000/api/v1/transfers \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Idempotency-Key: transfer-2026-0001' \
  -H 'Content-Type: application/json' \
  -d '{"recipientUsername":"grace","amount":250000,"description":"Lunch"}'
```

Cookie-based command-line requests can use a cookie jar:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"ada","password":"password123"}'

curl -b cookies.txt http://localhost:3000/api/v1/wallet
```

## Decisions

- Money is stored as PostgreSQL `bigint` kobo, never floating point.
- Each wallet has a non-negative balance projection plus an append-only ledger for auditability.
- A Sequelize-managed PostgreSQL transaction and `FOR UPDATE` wallet lock serialize every debit.
- Internal transfers lock both wallets in stable UUID order, update both balances, and append both ledger sides atomically.
- Withdrawal funds are reserved before calling the payout endpoint, preventing concurrent double-spend.
- Provider references, client idempotency keys, provider event IDs, and ledger operation entries have database uniqueness constraints.
- Deposit credit occurs only after a verified webhook whose reference, amount, and currency match the pending record.
- An unconfirmed deposit stays pending and never changes the wallet; after `DEPOSIT_PENDING_TTL_SECONDS` (default 1 hour) it is marked `failed` automatically. A late verified success webhook can still credit an expired deposit. Duplicate success webhooks return 200 without a second credit.
- Redis is never authoritative: cache failures degrade to PostgreSQL reads and every committed balance change invalidates the wallet key.
- Notifications are post-commit BullMQ jobs, so email retry behavior cannot roll back or duplicate financial state.

## Evaluation scenarios and tests

The scenario suite is in `test/financial-scenarios.e2e-spec.ts` and covers:

- the same successful deposit webhook delivered twice;
- two concurrent transfers when only one is affordable;
- two concurrent withdrawals when only one is affordable;
- a deposit that never receives a confirmation webhook (balance unchanged; expires to `failed`).

Run the unit suite:

```bash
npm test
```

Run the PostgreSQL-backed scenario suite against a disposable database. The suite recreates its schema:

```bash
createdb wallet_test
TEST_DATABASE_URL=postgresql://localhost/wallet_test npm run test:e2e
```

Also run the static checks before deployment:

```bash
npm run lint
npm run build
```

## Operational notes

- Configure the webhook URL in the Paystack dashboard and keep the route publicly reachable over HTTPS.
- Paystack webhook signatures use HMAC-SHA512 with the secret key and are checked with a timing-safe comparison before JSON event processing.
- Provider timeouts leave reserved withdrawals pending for reconciliation; an explicit rejected provider response is compensated with a ledgered refund.
- Mock emails are written by the BullMQ worker to application logs. Replace only the processor implementation when adopting a real email vendor.
- Run migrations as a release step before starting the application. Do not enable `DB_SYNCHRONIZE` in production.

The provider integration follows Paystack's official [transaction initialization](https://paystack.com/docs/api/transaction/), [transfer recipient](https://paystack.com/docs/api/transfer-recipient/), [transfer](https://paystack.com/docs/api/transfer/), and [webhook verification](https://paystack.com/docs/payments/webhooks/) documentation.
