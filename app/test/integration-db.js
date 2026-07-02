import Knex from 'knex';
import { Model, knexSnakeCaseMappers } from 'objection';
import { initPG } from '../utils/pg.js';

const SERVICE_DATABASE_NAMES = new Set(['cir_db']);
const REQUIRED_DATABASE_ENV_NAMES = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_ADMIN_NAME',
];
const TABLES_TO_CLEAN = [
  'treasury_kafka_messages',
  'capacity_events',
  'reservations',
  'program_capacity_balances',
  'programs',
  'fx_rates',
];

let knex;

const createDbConfig = (database) => ({
  client: 'postgresql',
  connection: {
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    database,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  },
  pool: {
    min: 1,
    max: 5,
  },
  ...knexSnakeCaseMappers(),
});

const assertDatabaseEnv = () => {
  const missingNames = REQUIRED_DATABASE_ENV_NAMES.filter((name) => !process.env[name]);

  if (missingNames.length > 0) {
    throw new Error(`Missing integration test database environment: ${missingNames.join(', ')}.`);
  }
};

const assertDedicatedTestDatabase = () => {
  if (SERVICE_DATABASE_NAMES.has(process.env.DATABASE_NAME)) {
    throw new Error('Integration tests require DATABASE_NAME to point to a dedicated test database, not cir_db.');
  }
};

const ensureTestDatabase = async () => {
  assertDatabaseEnv();
  assertDedicatedTestDatabase();
  const adminKnex = Knex(createDbConfig(process.env.DATABASE_ADMIN_NAME));

  try {
    const existingDatabase = await adminKnex('pg_database')
      .select('datname')
      .where({ datname: process.env.DATABASE_NAME })
      .first();

    if (!existingDatabase) {
      await adminKnex.raw('CREATE DATABASE ??', [process.env.DATABASE_NAME]);
    }
  } finally {
    await adminKnex.destroy();
  }
};

export const getKnex = () => {
  if (!knex) {
    throw new Error('Integration database has not been initialized.');
  }

  return knex;
};

export const cleanupIntegrationDatabase = async () => {
  await getKnex().raw(`truncate table ${TABLES_TO_CLEAN.join(', ')} restart identity cascade;`);
};

// Registers the shared dedicated-test-database lifecycle for DB-backed integration specs.
export const setupIntegrationDatabase = () => {
  beforeAll(async () => {
    initPG();
    await ensureTestDatabase();
    knex = Knex(createDbConfig(process.env.DATABASE_NAME));
    Model.knex(knex);
    await knex.migrate.latest({
      directory: './migrations',
      tableName: 'migrations',
    });
  });

  beforeEach(async () => {
    await cleanupIntegrationDatabase();
  });

  afterAll(async () => {
    if (knex) {
      await cleanupIntegrationDatabase();
      await knex.destroy();
      knex = undefined;
    }
  });
};

export const findProgram = (externalId) =>
  getKnex()('programs')
    .where({ externalId })
    .first();

export const findBalance = (programId) =>
  getKnex()('program_capacity_balances')
    .where({ programId })
    .first();

export const findReservations = (programId) =>
  getKnex()('reservations')
    .where({ programId })
    .orderBy('invoiceId');

export const countEvents = async (programId, eventType) => {
  const row = await getKnex()('capacity_events')
    .where({ programId, eventType })
    .count({ count: '*' })
    .first();

  return row.count;
};

export const countAllEvents = async () => {
  const row = await getKnex()('capacity_events')
    .count({ count: '*' })
    .first();

  return row.count;
};

export const findEvents = (programId, eventType) =>
  getKnex()('capacity_events')
    .where({ programId, eventType })
    .orderBy('id');

export const findKafkaMessages = () =>
  getKnex()('treasury_kafka_messages')
    .orderBy('id');
