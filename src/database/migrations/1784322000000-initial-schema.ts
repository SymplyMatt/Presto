import { QueryInterface } from 'sequelize';
import { MigrationParams } from 'umzug';

const schemaQueries = [
  'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
  `CREATE TABLE "users" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "email" varchar NOT NULL,
    "username" varchar NOT NULL,
    "password_hash" varchar NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_users" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_users_email" UNIQUE ("email"),
    CONSTRAINT "UQ_users_username" UNIQUE ("username")
  )`,
  `CREATE TABLE "wallets" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "balance" bigint NOT NULL DEFAULT 0,
    "currency" varchar(3) NOT NULL DEFAULT 'NGN',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_wallets" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_wallets_user" UNIQUE ("user_id"),
    CONSTRAINT "CHK_wallet_balance_nonnegative" CHECK ("balance" >= 0),
    CONSTRAINT "FK_wallets_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
  )`,
  `CREATE TABLE "transfers" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "sender_wallet_id" uuid NOT NULL,
    "receiver_wallet_id" uuid NOT NULL,
    "amount" bigint NOT NULL,
    "currency" varchar(3) NOT NULL DEFAULT 'NGN',
    "idempotency_key" varchar NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'completed',
    "description" varchar(160),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_transfers" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_transfer_idempotency" UNIQUE ("sender_wallet_id", "idempotency_key"),
    CONSTRAINT "FK_transfer_sender" FOREIGN KEY ("sender_wallet_id") REFERENCES "wallets"("id"),
    CONSTRAINT "FK_transfer_receiver" FOREIGN KEY ("receiver_wallet_id") REFERENCES "wallets"("id"),
    CONSTRAINT "CHK_transfer_amount_positive" CHECK ("amount" > 0)
  )`,
  `CREATE TABLE "deposits" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" uuid NOT NULL,
    "amount" bigint NOT NULL,
    "currency" varchar(3) NOT NULL DEFAULT 'NGN',
    "provider_name" varchar(30) NOT NULL,
    "provider_reference" varchar NOT NULL,
    "idempotency_key" varchar NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "checkout_url" varchar,
    "access_code" varchar,
    "confirmed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_deposits" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_deposit_provider_reference" UNIQUE ("provider_name", "provider_reference"),
    CONSTRAINT "UQ_deposit_idempotency" UNIQUE ("wallet_id", "idempotency_key"),
    CONSTRAINT "FK_deposit_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id"),
    CONSTRAINT "CHK_deposit_amount_positive" CHECK ("amount" > 0)
  )`,
  `CREATE TABLE "withdrawals" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" uuid NOT NULL,
    "amount" bigint NOT NULL,
    "currency" varchar(3) NOT NULL DEFAULT 'NGN',
    "bank_code" varchar(20) NOT NULL,
    "account_number_last_four" varchar(4) NOT NULL,
    "account_name" varchar NOT NULL,
    "recipient_code" varchar NOT NULL,
    "provider_name" varchar(30) NOT NULL,
    "provider_reference" varchar NOT NULL,
    "provider_transfer_code" varchar,
    "idempotency_key" varchar NOT NULL,
    "status" varchar(20) NOT NULL DEFAULT 'pending',
    "reason" varchar(160),
    "completed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_withdrawals" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_withdrawal_idempotency" UNIQUE ("wallet_id", "idempotency_key"),
    CONSTRAINT "UQ_withdrawal_provider_reference" UNIQUE ("provider_name", "provider_reference"),
    CONSTRAINT "FK_withdrawal_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id"),
    CONSTRAINT "CHK_withdrawal_amount_positive" CHECK ("amount" > 0)
  )`,
  `CREATE TABLE "ledger_entries" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" uuid NOT NULL,
    "entry_type" varchar(40) NOT NULL,
    "direction" varchar(6) NOT NULL,
    "amount" bigint NOT NULL,
    "balance_after" bigint NOT NULL,
    "reference_type" varchar(30) NOT NULL,
    "reference_id" varchar NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_ledger_entries" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_ledger_reference_entry" UNIQUE ("wallet_id", "reference_id", "entry_type"),
    CONSTRAINT "FK_ledger_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id"),
    CONSTRAINT "CHK_ledger_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "CHK_ledger_direction" CHECK ("direction" IN ('credit', 'debit'))
  )`,
  'CREATE INDEX "IDX_ledger_wallet_created" ON "ledger_entries" ("wallet_id", "created_at")',
  `CREATE TABLE "webhook_events" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "provider_name" varchar(30) NOT NULL,
    "provider_event_id" varchar NOT NULL,
    "event_type" varchar(50) NOT NULL,
    "provider_reference" varchar,
    "status" varchar(20) NOT NULL DEFAULT 'processed',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_webhook_events" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_webhook_provider_event" UNIQUE ("provider_name", "provider_event_id")
  )`,
];

const dropQueries = [
  'DROP TABLE "webhook_events"',
  'DROP TABLE "ledger_entries"',
  'DROP TABLE "withdrawals"',
  'DROP TABLE "deposits"',
  'DROP TABLE "transfers"',
  'DROP TABLE "wallets"',
  'DROP TABLE "users"',
];

const runQueries = async (context: QueryInterface, queries: string[]): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    for (const query of queries) {
      await context.sequelize.query(query, { transaction });
    }
  });
};

export const up = ({ context }: MigrationParams<QueryInterface>) =>
  runQueries(context, schemaQueries);

export const down = ({ context }: MigrationParams<QueryInterface>) =>
  runQueries(context, dropQueries);
