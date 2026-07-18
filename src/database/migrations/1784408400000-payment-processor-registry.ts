import { QueryInterface } from 'sequelize';
import { MigrationParams } from 'umzug';

const processorRows = [
  ['flutterwave', 'Flutterwave', false],
  ['paystack', 'Paystack', true],
  ['fincra', 'Fincra', false],
  ['monnify', 'Monnify', false],
] as const;

export const up = async ({ context }: MigrationParams<QueryInterface>): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(
      `CREATE TABLE IF NOT EXISTS "payment_processors" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(30) NOT NULL,
        "display_name" varchar(60) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_processors" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payment_processor_name" UNIQUE ("name")
      )`,
      { transaction },
    );
    await context.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_active_payment_processor" ON "payment_processors" ("is_active") WHERE "is_active" = true',
      { transaction },
    );
    await context.sequelize.query(
      'ALTER TABLE "withdrawals" ALTER COLUMN "recipient_code" DROP NOT NULL',
      { transaction },
    );
    await context.sequelize.query(
      'ALTER TABLE "ledger_entries" ADD COLUMN IF NOT EXISTS "payment_processor_name" varchar(30)',
      { transaction },
    );
    for (const [name, displayName, isActive] of processorRows) {
      await context.sequelize.query(
        `INSERT INTO "payment_processors" ("name", "display_name", "is_active")
         VALUES (:name, :displayName, :isActive)
         ON CONFLICT ("name") DO NOTHING`,
        { replacements: { name, displayName, isActive }, transaction },
      );
    }
  });
};

export const down = async ({ context }: MigrationParams<QueryInterface>): Promise<void> => {
  await context.sequelize.transaction(async (transaction) => {
    await context.sequelize.query(
      `UPDATE "withdrawals" SET "recipient_code" = '' WHERE "recipient_code" IS NULL`,
      { transaction },
    );
    await context.sequelize.query(
      'ALTER TABLE "withdrawals" ALTER COLUMN "recipient_code" SET NOT NULL',
      { transaction },
    );
    await context.sequelize.query(
      'ALTER TABLE "ledger_entries" DROP COLUMN IF EXISTS "payment_processor_name"',
      { transaction },
    );
    await context.sequelize.query('DROP TABLE IF EXISTS "payment_processors"', { transaction });
  });
};
