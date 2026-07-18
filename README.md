# Wallet and Payments API

A NestJS API for registering users, funding an NGN wallet with the active payment processor, transferring to another user, and withdrawing to a Nigerian bank account. PostgreSQL is the source of truth for balances, ledger history, and payment-processor selection; Redis is used for short-lived reads and BullMQ jobs.

The submission deadline is interpreted in **Africa/Lagos (WAT, UTC+1)**: Saturday, July 18, 2026 at 11:59 PM.

## Stack

- TypeScript and NestJS
- PostgreSQL, Sequelize models, and Umzug migrations
- Redis for wallet-view caching
- BullMQ for asynchronous mock email notifications
- Payment-processor adapters selected through a PostgreSQL-backed registry
- JWT authentication and bcrypt password hashing
- Swagger/OpenAPI at `/docs` and `/docs/openapi.json`



## Run locally

Requirements: Node.js 22+, npm, PostgreSQL 16+, Redis 7+, and credentials for the active payment processor.

Start PostgreSQL and Redis with your operating system's service manager, create a PostgreSQL database, and set its connection string in `.env`.

```bash
cp .env.example .env
npm install
npm run migration:run
npm run start:dev
```

Paystack is the initially active payment processor, so set `PAYSTACK_SECRET_KEY` in `.env` before making payment requests. The API runs at `http://localhost:3000/api/v1`, Swagger at `http://localhost:3000/docs`, and the payment webhook URL is:

```text
https://your-public-host/api/v1/webhooks/payments
```

The webhook route and wallet services are processor-neutral. PostgreSQL stores Flutterwave, Paystack, Fincra, and Monnify in the processor registry. Paystack is seeded as active; the others are seeded as inactive. Business services query the active row and resolve its adapter before every external payment operation. Each supported processor has working checkout, payout, and signed-webhook implementations.

Use `GET /api/v1/payment-processors` to list the registry, active state, and configuration readiness. Use `PATCH /api/v1/payment-processors/:name/activate` to change the active processor. Both endpoints require authentication. Activation is rejected until every required credential for that processor is present, leaving the current processor active. Processor-specific payloads, credentials, URLs, and webhook verification belwhong only inside the corresponding adapter.

## Environment


| Variable                                                                                                              | Purpose                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                        | PostgreSQL connection string                                                              |
| `DB_SYNCHRONIZE`                                                                                                      | Development-only schema sync; keep `false` outside tests                                  |
| `DATABASE_SSL`                                                                                                        | Set `true` when a hosted PostgreSQL service requires TLS                                  |
| `JWT_SECRET`                                                                                                          | JWT signing secret, at least 32 random characters recommended                             |
| `JWT_EXPIRES_IN_SECONDS`                                                                                              | Access-token lifetime in seconds, default `3600`                                          |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`                                                        | Redis connection for BullMQ queues and wallet cache                                       |
| `REDIS_TLS`                                                                                                           | Set `true` only for `rediss://` / TLS-required Redis endpoints                            |
| `DISABLE_QUEUE_WORKER`                                                                                                | Set `true` when Redis is unavailable so notifications/jobs are skipped instead of hanging |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_BASE_URL`                                                                            | Paystack secret key and optional API URL override                                         |
| `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_SECRET`, `FLUTTERWAVE_BASE_URL`                                        | Flutterwave API and webhook credentials, plus optional API URL override                   |
| `FINCRA_SECRET_KEY`, `FINCRA_PUBLIC_KEY`, `FINCRA_BUSINESS_ID`, `FINCRA_WEBHOOK_SECRET`, `FINCRA_BASE_URL`            | Fincra API, business, and webhook credentials, plus optional API URL override             |
| `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_SOURCE_ACCOUNT_NUMBER`, `MONNIFY_BASE_URL` | Monnify collection and disbursement credentials, plus optional API URL override           |
| `MONNIFY_ALLOW_UNSIGNED_SANDBOX_WEBHOOKS`                                                                             | Opt in to Monnify's unsigned sandbox webhooks outside production; default `false`         |
| `APP_BASE_URL`                                                                                                        | Public application URL used for payment callbacks                                         |
| `CORS_ORIGINS`                                                                                                        | Comma-separated browser origins allowed to send credentialed requests                     |




## Authentication

Registration and login return the JWT in the response body and also set it as an HTTP-only `accessToken` cookie. Protected endpoints check that cookie first and fall back to an `Authorization: Bearer <token>` header. In production the cookie is secure, uses `SameSite=Strict`, and is unavailable to browser JavaScript.

Swagger automatically sends the cookie after registration or login from `/docs`. Its **Authorize** control remains available for testing the bearer-header fallback, and manually entered authorization is preserved across page reloads.

## API flow

All monetary values are positive integer **kobo**. Only NGN is supported.

1. `POST /api/v1/auth/register` creates a user and zero-balance wallet.
2. `POST /api/v1/auth/login` returns a bearer token and sets the JWT session cookie.
3. `POST /api/v1/deposits` creates a pending deposit with the active payment processor and returns its checkout URL.
4. `POST /api/v1/deposits/verify` checks the processor by deposit reference and credits the wallet when payment succeeded (useful if the webhook was delayed or missed).
5. The active payment processor sends a signed event to `POST /api/v1/webhooks/payments`; only a valid signature and exact reference/amount/currency match can credit the wallet.
6. `POST /api/v1/transfers` moves money between platform wallets atomically.
7. `POST /api/v1/withdrawals` reserves wallet funds and initiates a payout with the active payment processor.
8. `GET /api/v1/banks` returns banks supported by the active payment processor (Redis-cached for 24 hours).
9. `GET /api/v1/wallet` returns the cached wallet view; `GET /api/v1/wallet/ledger` returns the PostgreSQL audit history.

Clients do not send idempotency keys. The API rejects a similar deposit, transfer, or withdrawal when the same user attempted it during the preceding two minutes. The check runs inside the same database transaction and wallet lock used for the financial operation, including concurrent requests.

Example registration and transfer:

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","username":"ada","password":"password123"}'

curl -X POST http://localhost:3000/api/v1/transfers \
  -H 'Authorization: Bearer YOUR_TOKEN' \
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



## Redis caching and queues



### What is cached, and why

Redis caches only the wallet summary returned by `GET /api/v1/wallet`: the wallet ID, current balance, and currency. Each entry uses the key `wallet:user:<userId>` and expires after 30 seconds. This is a frequently requested view, so the short-lived cache reduces repeated PostgreSQL reads while keeping the maximum stale period small.

The wallet cache is invalidated after every committed operation that can change a balance, including deposits, transfers, withdrawal reservations, and withdrawal refunds. PostgreSQL remains authoritative; ledger history, transaction records, authentication data, and payment-processor configuration are not cached. If Redis is unavailable, wallet reads fall back to PostgreSQL.

### What is queued with Redis, and why

BullMQ stores two types of jobs in Redis:

- Activity email notifications for registration, login, sent and received transfers, withdrawal requests, confirmed deposits, completed withdrawals, and failed withdrawals. Email work runs after the financial operation and outside the request path so a slow or temporarily failing email service cannot delay or roll back a committed transaction. Notification jobs retry up to three times with exponential backoff.
- Delayed deposit-expiration jobs. A job is scheduled when checkout initialization succeeds and runs after `DEPOSIT_PENDING_TTL_SECONDS`. It marks the deposit as failed only when it is still pending. This schedules abandoned-checkout cleanup at the required time without continuous database polling.

Queue jobs contain only the information needed by their workers. PostgreSQL remains the source of truth, and each worker re-checks current database state before making a financial-status change.

### Why Redis was chosen as the queue system

Redis was already required for the wallet cache, so using it through BullMQ avoids introducing another infrastructure service. BullMQ integrates directly with NestJS and provides delayed jobs, retries, exponential backoff, job identifiers, worker concurrency, and job state outside the application process. Those features fit email delivery and deposit-expiration scheduling while keeping all wallet balances and financial records in PostgreSQL.

## Decisions

- Money is stored as PostgreSQL `bigint` kobo, never floating point.
- Each wallet has a non-negative balance projection plus an append-only ledger for auditability.
- A Sequelize-managed PostgreSQL transaction and `FOR UPDATE` wallet lock serialize every debit.
- Internal transfers lock both wallets in stable UUID order, update both balances, and append both ledger sides atomically.
- Withdrawal funds are reserved before calling the payout endpoint, preventing concurrent double-spend.
- Processor references, internally generated operation keys, processor event IDs, and ledger operation entries have database uniqueness constraints.
- Every externally processed deposit, withdrawal, and related ledger entry stores the payment processor used at creation time.
- A PostgreSQL partial unique index and transactional row locks ensure the processor registry has at most one active row.
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

- Configure the webhook URL with the active payment processor and keep the route publicly reachable over HTTPS.
- The active adapter verifies its processor-specific webhook signature before returning a normalized event to the webhook service. All signature comparisons are timing-safe.
- Flutterwave, Fincra, and Monnify express API amounts in major currency units. Their adapters convert from and back to the API's integer-kobo contract at the boundary. Paystack uses kobo directly.
- Automated Monnify withdrawals require disbursement access, a live-environment IP whitelist, and MFA disabled for the source wallet. Otherwise Monnify can return a payout that requires manual authorization.
- Monnify omits its signature header in sandbox. Set `MONNIFY_ALLOW_UNSIGNED_SANDBOX_WEBHOOKS=true` only for sandbox testing; production always requires a valid signature regardless of this setting.
- Processor timeouts leave reserved withdrawals pending for reconciliation; an explicit rejected response is compensated with a ledgered refund.
- Mock emails are written by the BullMQ worker to application logs. Replace only the processor implementation when adopting a real email vendor.
- Run migrations as a release step before starting the application. Do not enable `DB_SYNCHRONIZE` in production.

The adapters follow the processors' official checkout, transfer, and webhook contracts: [Paystack](https://paystack.com/docs/payments/), [Flutterwave](https://developer.flutterwave.com/v3.0/docs/flutterwave-standard-1), [Fincra](https://docs.fincra.com/docs/cross-currency-checkout-integration-flow), and [Monnify](https://developers.monnify.com/docs/collections/one-time-payments/checkout-api). Core wallet, transaction, registry, and webhook services do not depend on any processor-specific payload.