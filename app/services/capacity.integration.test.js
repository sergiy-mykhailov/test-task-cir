import Knex from 'knex';
import { Model, knexSnakeCaseMappers } from 'objection';
import {
  CapacityEventType,
  ReservationStatus,
} from '../constants/capacity.js';
import CapacityRepository from '../repositories/capacity.js';
import { initPG } from '../utils/pg.js';
import CapacityService from './capacity.js';

const NOW = new Date('2026-07-02T12:00:00.000Z');
const SERVICE_DATABASE_NAMES = new Set(['cir_db']);
const REQUIRED_DATABASE_ENV_NAMES = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_ADMIN_NAME',
];
// Row-level lock behavior needs a real Postgres connection, but it must never use the service DB.
const PROGRAM_PREFIX = `cir003-${process.pid}-`;

let knex;
let programSequence = 0;

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
    throw new Error('Capacity integration tests require DATABASE_NAME to point to a dedicated test database, not cir_db.');
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

const createService = () =>
  new CapacityService({
    repository: new CapacityRepository(),
    now: () => NOW,
  });

const nextProgramId = () => {
  programSequence += 1;

  return `${PROGRAM_PREFIX}${programSequence}`;
};

const cleanupDatabase = async () => {
  await knex.raw('truncate table capacity_events, reservations, program_capacity_balances, programs restart identity cascade;');
};

const findProgram = (externalId) =>
  knex('programs')
    .where({ externalId })
    .first();

const findBalance = (programId) =>
  knex('program_capacity_balances')
    .where({ programId })
    .first();

const findReservations = (programId) =>
  knex('reservations')
    .where({ programId })
    .orderBy('invoiceId');

const countEvents = async (programId, eventType) => {
  const row = await knex('capacity_events')
    .where({ programId, eventType })
    .count({ count: '*' })
    .first();

  return row.count;
};

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
  await cleanupDatabase();
});

afterAll(async () => {
  if (knex) {
    await cleanupDatabase();
    await knex.destroy();
  }
});

describe('CapacityService integration safety', () => {
  test('rejects duplicate reservations without mutating balance or events', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-duplicate',
      amount: 300,
      currency: 'USD',
    });

    const program = await findProgram(programExternalId);
    const beforeBalance = await findBalance(program.id);
    const beforeEventCount = await countEvents(program.id, CapacityEventType.ReservationCreated);

    await expect(service.createReservation(programExternalId, {
      invoiceId: 'invoice-duplicate',
      amount: 100,
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });

    const afterBalance = await findBalance(program.id);
    const reservations = await findReservations(program.id);

    expect(afterBalance.reservedAmount).toBe(beforeBalance.reservedAmount);
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(beforeEventCount);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      invoiceId: 'invoice-duplicate',
      status: ReservationStatus.Reserved,
      amount: 300,
    });
  });

  test('rejects insufficient capacity without creating reservation side effects', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 500,
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-kept',
      amount: 200,
      currency: 'USD',
    });

    const program = await findProgram(programExternalId);
    const beforeEventCount = await countEvents(program.id, CapacityEventType.ReservationCreated);

    await expect(service.createReservation(programExternalId, {
      invoiceId: 'invoice-too-large',
      amount: 301,
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });

    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);

    expect(balance.reservedAmount).toBe(200);
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(beforeEventCount);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].invoiceId).toBe('invoice-kept');
  });

  test('rejects double release without double-applying capacity', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-release',
      amount: 250,
      currency: 'USD',
    });
    await service.releaseReservation(programExternalId, 'invoice-release');

    const program = await findProgram(programExternalId);
    const beforeEventCount = await countEvents(program.id, CapacityEventType.ReservationReleased);

    await expect(service.releaseReservation(programExternalId, 'invoice-release')).rejects.toMatchObject({
      output: { statusCode: 409 },
    });

    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);

    expect(balance.reservedAmount).toBe(0);
    expect(await countEvents(program.id, CapacityEventType.ReservationReleased)).toBe(beforeEventCount);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      invoiceId: 'invoice-release',
      status: ReservationStatus.Released,
      releasedAmount: 250,
    });
  });

  test('serializes concurrent reservations that would exceed remaining capacity', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });

    const results = await Promise.allSettled([
      service.createReservation(programExternalId, {
        invoiceId: 'invoice-concurrent-1',
        amount: 700,
        currency: 'USD',
      }),
      service.createReservation(programExternalId, {
        invoiceId: 'invoice-concurrent-2',
        amount: 700,
        currency: 'USD',
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      output: { statusCode: 409 },
    });
    expect(balance.reservedAmount).toBe(700);
    expect(reservations).toHaveLength(1);
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(1);
  });
});
