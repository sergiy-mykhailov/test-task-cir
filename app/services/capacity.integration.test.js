import {
  CapacityEventType,
  ReservationStatus,
} from '../constants/capacity.js';
import CapacityRepository from '../repositories/capacity.js';
import {
  countEvents,
  findBalance,
  findEvents,
  findProgram,
  findReservations,
  getKnex,
  setupIntegrationDatabase,
} from '../test/integration-db.js';
import CapacityService from './capacity.js';

const NOW = new Date('2026-07-02T12:00:00.000Z');
// Row-level lock behavior needs a real Postgres connection, but it must never use the service DB.
const PROGRAM_PREFIX = `cir003-${process.pid}-`;

let programSequence = 0;

const createService = () =>
  new CapacityService({
    repository: new CapacityRepository(),
    now: () => NOW,
  });

const nextProgramId = () => {
  programSequence += 1;

  return `${PROGRAM_PREFIX}${programSequence}`;
};

setupIntegrationDatabase();

describe('CapacityService integration safety', () => {
  test('rejects duplicate reservations without mutating balance or events', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '1000',
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-duplicate',
      amount: '300',
      currency: 'USD',
    });

    const program = await findProgram(programExternalId);
    const beforeBalance = await findBalance(program.id);
    const beforeEventCount = await countEvents(program.id, CapacityEventType.ReservationCreated);

    await expect(service.createReservation(programExternalId, {
      invoiceId: 'invoice-duplicate',
      amount: '100',
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
      amount: '300',
    });
  });

  test('rejects insufficient capacity without creating reservation side effects', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '500',
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-kept',
      amount: '200',
      currency: 'USD',
    });

    const program = await findProgram(programExternalId);
    const beforeEventCount = await countEvents(program.id, CapacityEventType.ReservationCreated);

    await expect(service.createReservation(programExternalId, {
      invoiceId: 'invoice-too-large',
      amount: '301',
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });

    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);

    expect(balance.reservedAmount).toBe('200');
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
      totalLimit: '1000',
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-release',
      amount: '250',
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

    expect(balance.reservedAmount).toBe('0');
    expect(await countEvents(program.id, CapacityEventType.ReservationReleased)).toBe(beforeEventCount);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      invoiceId: 'invoice-release',
      status: ReservationStatus.Released,
      releasedAmount: '250',
    });
  });

  test('persists cross-currency reservation effects and releases the stored converted amount', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '1000',
    });
    const fxRate = await service.createFxRate({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1',
      effectiveAt: '2026-07-02T10:00:00.000Z',
    });
    const storedFxRate = await getKnex()('fx_rates')
      .where({ id: fxRate.id })
      .first();

    const reservationResult = await service.createReservation(programExternalId, {
      invoiceId: 'invoice-eur',
      amount: '10.075',
      currency: 'EUR',
    });
    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);
    const reservationEvents = await findEvents(program.id, CapacityEventType.ReservationCreated);

    expect(reservationResult.reservation).toMatchObject({
      invoiceId: 'invoice-eur',
      invoiceAmount: '10.075',
      invoiceCurrency: 'EUR',
      amount: '10.08',
      currency: 'USD',
      fxRateId: fxRate.id,
      status: ReservationStatus.Reserved,
      releasedAmount: '0',
    });
    expect(reservationResult.capacity).toMatchObject({
      currency: 'USD',
      totalLimit: '1000',
      reservedAmount: '10.08',
      availableAmount: '989.92',
    });
    expect(storedFxRate).toMatchObject({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1',
    });
    expect(balance.reservedAmount).toBe('10.08');
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      invoiceId: 'invoice-eur',
      invoiceAmount: '10.075',
      invoiceCurrency: 'EUR',
      amount: '10.08',
      currency: 'USD',
      fxRateId: fxRate.id,
      status: ReservationStatus.Reserved,
      releasedAmount: '0',
    });
    expect(reservationEvents).toHaveLength(1);
    expect(reservationEvents[0]).toMatchObject({
      reservationId: reservations[0].id,
      invoiceId: 'invoice-eur',
      amount: '10.08',
      currency: 'USD',
    });

    await service.createFxRate({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '2',
      effectiveAt: '2026-07-02T11:30:00.000Z',
    });
    const releaseResult = await service.releaseReservation(programExternalId, 'invoice-eur');
    const afterReleaseBalance = await findBalance(program.id);
    const releasedReservations = await findReservations(program.id);
    const releaseEvents = await findEvents(program.id, CapacityEventType.ReservationReleased);

    expect(releaseResult.reservation).toMatchObject({
      invoiceId: 'invoice-eur',
      invoiceAmount: '10.075',
      invoiceCurrency: 'EUR',
      amount: '10.08',
      currency: 'USD',
      fxRateId: fxRate.id,
      status: ReservationStatus.Released,
      releasedAmount: '10.08',
    });
    expect(releaseResult.capacity).toMatchObject({
      currency: 'USD',
      totalLimit: '1000',
      reservedAmount: '0',
      availableAmount: '1000',
    });
    expect(afterReleaseBalance.reservedAmount).toBe('0');
    expect(releasedReservations).toHaveLength(1);
    expect(releasedReservations[0]).toMatchObject({
      invoiceId: 'invoice-eur',
      invoiceAmount: '10.075',
      invoiceCurrency: 'EUR',
      amount: '10.08',
      currency: 'USD',
      fxRateId: fxRate.id,
      status: ReservationStatus.Released,
      releasedAmount: '10.08',
    });
    expect(releaseEvents).toHaveLength(1);
    expect(releaseEvents[0]).toMatchObject({
      reservationId: releasedReservations[0].id,
      invoiceId: 'invoice-eur',
      amount: '10.08',
      currency: 'USD',
    });
  });

  test('rejects zero-after-conversion and accepts the half-cent threshold exactly', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '1',
    });
    await service.createFxRate({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1',
      effectiveAt: '2026-07-02T10:00:00.000Z',
    });

    await expect(service.createReservation(programExternalId, {
      invoiceId: 'invoice-zero-after-conversion',
      amount: '0.0049',
      currency: 'EUR',
    })).rejects.toMatchObject({
      output: { statusCode: 422 },
      data: {
        invoiceAmount: '0.0049',
        invoiceCurrency: 'EUR',
        convertedAmount: '0',
        currency: 'USD',
      },
    });

    const program = await findProgram(programExternalId);
    expect(await findBalance(program.id)).toMatchObject({ totalLimit: '1', reservedAmount: '0' });
    expect(await findReservations(program.id)).toHaveLength(0);
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(0);

    const accepted = await service.createReservation(programExternalId, {
      invoiceId: 'invoice-half-cent-threshold',
      amount: '0.005',
      currency: 'EUR',
    });

    expect(accepted.reservation).toMatchObject({
      invoiceAmount: '0.005',
      amount: '0.01',
      currency: 'USD',
    });
    expect(await findBalance(program.id)).toMatchObject({ totalLimit: '1', reservedAmount: '0.01' });
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(1);
  });

  test('accepts exact-fit fractional reservations at assignment scale', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '10000000.01',
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-fractional-prefix',
      amount: '0.01',
      currency: 'USD',
    });

    const result = await service.createReservation(programExternalId, {
      invoiceId: 'invoice-assignment-scale',
      amount: '10000000',
      currency: 'USD',
    });
    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);

    expect(result.capacity).toMatchObject({
      totalLimit: '10000000.01',
      reservedAmount: '10000000.01',
      availableAmount: '0',
    });
    expect(balance).toMatchObject({
      totalLimit: '10000000.01',
      reservedAmount: '10000000.01',
    });
  });

  test('repeated fractional reservations and releases leave no database residual', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '0.3',
    });

    for (const invoiceId of ['fraction-db-1', 'fraction-db-2', 'fraction-db-3']) {
      await service.createReservation(programExternalId, {
        invoiceId,
        amount: '0.1',
        currency: 'USD',
      });
    }

    for (const invoiceId of ['fraction-db-1', 'fraction-db-2', 'fraction-db-3']) {
      await service.releaseReservation(programExternalId, invoiceId);
    }

    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);

    expect(balance).toMatchObject({ totalLimit: '0.3', reservedAmount: '0' });
    expect(await service.getCapacity(programExternalId)).toMatchObject({
      reservedAmount: '0',
      availableAmount: '0.3',
    });
  });

  test('rejects a high-precision reconciliation amount above the exact total', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '1',
    });

    await expect(service.reconcileProgramSnapshot(programExternalId, {
      currency: 'USD',
      totalLimit: '10000000000000000.1',
      reservedAmount: '10000000000000000.2',
      occurredAt: '2026-07-02T11:15:00.000Z',
    })).rejects.toMatchObject({
      output: { statusCode: 400 },
      data: {
        totalLimit: '10000000000000000.1',
        reservedAmount: '10000000000000000.2',
      },
    });

    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);

    expect(balance).toMatchObject({ totalLimit: '1', reservedAmount: '0' });
    expect(await countEvents(program.id, CapacityEventType.ReconciliationApplied)).toBe(0);
  });

  test('serializes concurrent reservations that would exceed remaining capacity', async () => {
    const service = createService();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: '1000',
    });

    const results = await Promise.allSettled([
      service.createReservation(programExternalId, {
        invoiceId: 'invoice-concurrent-1',
        amount: '700',
        currency: 'USD',
      }),
      service.createReservation(programExternalId, {
        invoiceId: 'invoice-concurrent-2',
        amount: '700',
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
    expect(balance.reservedAmount).toBe('700');
    expect(reservations).toHaveLength(1);
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(1);
  });
});
