import 'dotenv/config';
import path from 'node:path';
import { QueryInterface } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  dialectOptions:
    process.env.DATABASE_SSL === 'true'
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : undefined,
  logging: false,
});

const extension = path.extname(__filename);
const migrator = new Umzug<QueryInterface>({
  migrations: { glob: path.join(__dirname, 'migrations', `*${extension}`) },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: undefined,
});

const migrate = async (): Promise<void> => {
  try {
    if (process.argv.includes('--down')) {
      await migrator.down();
    } else {
      await migrator.up();
    }
  } finally {
    await sequelize.close();
  }
};

void migrate();
