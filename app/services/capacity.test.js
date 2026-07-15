import CapacityService from './capacity.js';
import {
  CapacityEventSource,
  CapacityEventType,
  ReservationStatus,
} from '../constants/capacity.js';

const NOW = new Date('2026-07-02T12:00:00.000Z');

class FakeCapacityRepository {
  constructor({
    programs = [{ id: 1, externalId: 'program-1', currency: 'USD' }],
    balances = [{ programId: 1, totalLimit: '1000', reservedAmount: '100', updatedAt: NOW }],
    reservations = [],
    fxRates = [],
    failOnCreateCapacityEvent = false,
  } = {}) {
    this.programs = programs;
    this.balances = balances;
    this.reservations = reservations;
    this.fxRates = fxRates;
    this.capacityEvents = [];
    this.failOnCreateCapacityEvent = failOnCreateCapacityEvent;
    this.lockedBalanceReads = [];
    this.lockedReservationReads = [];
    this.programLocks = new Map();
    this.nextProgramId = programs.reduce((max, program) =>
      Math.max(max, program.id), 0) + 1;
    this.nextReservationId = reservations.reduce((max, reservation) =>
      Math.max(max, reservation.id), 0) + 1;
    this.nextFxRateId = fxRates.reduce((max, fxRate) =>
      Math.max(max, fxRate.id), 0) + 1;
  }

  async withTransaction(callback) {
    const trx = {
      undo: [],
      lockReleases: [],
    };

    try {
      return await callback(trx);
    } catch (error) {
      [...trx.undo].reverse().forEach((undo) => undo());
      throw error;
    } finally {
      [...trx.lockReleases].reverse().forEach((release) => release());
    }
  }

  findProgramByExternalId(externalId) {
    return this.programs.find((program) => program.externalId === externalId);
  }

  findProgramById(id) {
    return this.programs.find((program) => program.id === id);
  }

  createProgram(data, trx) {
    const program = {
      id: this.nextProgramId,
      ...data,
    };
    this.nextProgramId += 1;
    this.programs.push(program);
    trx?.undo.push(() => {
      this.programs = this.programs.filter((item) => item.id !== program.id);
    });

    return program;
  }

  findBalanceByProgramId(programId) {
    return this.balances.find((balance) => balance.programId === programId);
  }

  async findBalanceByProgramIdForUpdate(programId, trx) {
    this.lockedBalanceReads.push(programId);
    await this.#acquireProgramLock(programId, trx);

    return this.findBalanceByProgramId(programId);
  }

  createBalance(data, trx) {
    this.balances.push(data);
    trx?.undo.push(() => {
      this.balances = this.balances.filter((balance) => balance.programId !== data.programId);
    });

    return data;
  }

  findReservationByProgramAndInvoice(programId, invoiceId) {
    return this.reservations.find((reservation) =>
      reservation.programId === programId && reservation.invoiceId === invoiceId);
  }

  findReservationByProgramAndInvoiceForUpdate(programId, invoiceId) {
    this.lockedReservationReads.push({ programId, invoiceId });

    return this.findReservationByProgramAndInvoice(programId, invoiceId);
  }

  createReservation(data, trx) {
    const reservation = {
      id: this.nextReservationId,
      releasedAt: null,
      ...data,
    };
    this.nextReservationId += 1;
    this.reservations.push(reservation);
    trx?.undo.push(() => {
      this.reservations = this.reservations.filter((item) => item.id !== reservation.id);
    });

    return reservation;
  }

  updateBalance(programId, patch, trx) {
    const balance = this.findBalanceByProgramId(programId);
    const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, balance[key]]));
    trx?.undo.push(() => {
      Object.assign(balance, previous);
    });
    Object.assign(balance, patch);

    return balance;
  }

  updateReservation(id, patch, trx) {
    const reservation = this.reservations.find((item) => item.id === id);
    const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, reservation[key]]));
    trx?.undo.push(() => {
      Object.assign(reservation, previous);
    });
    Object.assign(reservation, patch);

    return reservation;
  }

  createCapacityEvent(data, trx) {
    if (this.failOnCreateCapacityEvent) {
      throw new Error('Capacity event write failed');
    }

    const event = {
      id: this.capacityEvents.length + 1,
      ...data,
    };
    this.capacityEvents.push(event);
    trx?.undo.push(() => {
      this.capacityEvents = this.capacityEvents.filter((item) => item.id !== event.id);
    });

    return event;
  }

  findFxRateByPairAndEffectiveAt(baseCurrency, quoteCurrency, effectiveAt) {
    return this.fxRates.find((fxRate) =>
      fxRate.baseCurrency === baseCurrency
      && fxRate.quoteCurrency === quoteCurrency
      && new Date(fxRate.effectiveAt).getTime() === new Date(effectiveAt).getTime());
  }

  findLatestFxRate(baseCurrency, quoteCurrency, effectiveAt) {
    const effectiveAtTime = new Date(effectiveAt).getTime();

    return this.fxRates
      .filter((fxRate) =>
        fxRate.baseCurrency === baseCurrency
        && fxRate.quoteCurrency === quoteCurrency
        && new Date(fxRate.effectiveAt).getTime() <= effectiveAtTime)
      .sort((left, right) => {
        const timeDiff = new Date(right.effectiveAt).getTime() - new Date(left.effectiveAt).getTime();

        return timeDiff || right.id - left.id;
      })[0];
  }

  createFxRate(data, trx) {
    const fxRate = {
      id: this.nextFxRateId,
      ...data,
    };
    this.nextFxRateId += 1;
    this.fxRates.push(fxRate);
    trx?.undo.push(() => {
      this.fxRates = this.fxRates.filter((item) => item.id !== fxRate.id);
    });

    return fxRate;
  }

  async #acquireProgramLock(programId, trx) {
    // Model the program balance row lock so service tests expose unsafe concurrent capacity updates.
    const previous = this.programLocks.get(programId) || Promise.resolve();
    let releaseCurrentLock;
    const current = new Promise((resolve) => {
      releaseCurrentLock = resolve;
    });

    this.programLocks.set(programId, current);
    await previous;

    trx?.lockReleases.push(() => {
      releaseCurrentLock();
      if (this.programLocks.get(programId) === current) {
        this.programLocks.delete(programId);
      }
    });
  }
}

const createService = (repository = new FakeCapacityRepository()) =>
  new CapacityService({ repository, now: () => NOW });

describe('CapacityService', () => {
  test('creates a program with initial capacity balance', async () => {
    const repository = new FakeCapacityRepository({
      programs: [],
      balances: [],
    });
    const service = createService(repository);

    const result = await service.createProgram({
      externalId: 'program-new',
      currency: 'USD',
      totalLimit: '5000',
    });

    expect(result.program).toMatchObject({
      id: 1,
      externalId: 'program-new',
      currency: 'USD',
    });
    expect(result.capacity).toMatchObject({
      programId: 'program-new',
      totalLimit: '5000',
      reservedAmount: '0',
      availableAmount: '5000',
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ProgramCreated,
      amount: '5000',
      currency: 'USD',
    });
  });

  test('rejects duplicate program creation', async () => {
    const service = createService();

    await expect(service.createProgram({
      externalId: 'program-1',
      currency: 'USD',
      totalLimit: '5000',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });

  test('rejects JavaScript numbers at the monetary domain boundary', async () => {
    const repository = new FakeCapacityRepository({ programs: [], balances: [] });
    const service = createService(repository);

    await expect(service.createProgram({
      externalId: 'program-number-input',
      currency: 'USD',
      totalLimit: 5000,
    })).rejects.toMatchObject({
      output: { statusCode: 400 },
    });
  });

  test('creates an FX rate', async () => {
    const repository = new FakeCapacityRepository();
    const service = createService(repository);

    const result = await service.createFxRate({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1.2',
      effectiveAt: '2026-07-02T10:00:00.000Z',
    });

    expect(result).toMatchObject({
      id: 1,
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1.2',
      effectiveAt: '2026-07-02T10:00:00.000Z',
      createdAt: NOW.toISOString(),
    });
    expect(repository.fxRates).toHaveLength(1);
  });

  test('rejects duplicate FX rate timestamp for the same pair', async () => {
    const repository = new FakeCapacityRepository({
      fxRates: [{
        id: 5,
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '1.2',
        effectiveAt: '2026-07-02T10:00:00.000Z',
        createdAt: NOW,
      }],
    });
    const service = createService(repository);

    await expect(service.createFxRate({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: '1.3',
      effectiveAt: '2026-07-02T10:00:00.000Z',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });

  test('creates a reservation and returns refreshed capacity', async () => {
    const repository = new FakeCapacityRepository();
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-1',
      amount: '200',
      currency: 'USD',
    });

    expect(result.reservation).toMatchObject({
      id: 1,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      invoiceAmount: '200',
      invoiceCurrency: 'USD',
      amount: '200',
      currency: 'USD',
      fxRateId: null,
      status: ReservationStatus.Reserved,
      releasedAmount: '0',
    });
    expect(result.capacity).toMatchObject({
      programId: 'program-1',
      totalLimit: '1000',
      reservedAmount: '300',
      availableAmount: '700',
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReservationCreated,
      invoiceId: 'invoice-1',
      amount: '200',
    });
    expect(repository.lockedBalanceReads).toEqual([1]);
  });

  test('preserves same-currency amounts with more than two fractional digits', async () => {
    const repository = new FakeCapacityRepository();
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-same-currency-precision',
      amount: '10.075',
      currency: 'USD',
    });

    expect(result.reservation).toMatchObject({
      invoiceAmount: '10.075',
      amount: '10.075',
      currency: 'USD',
      fxRateId: null,
    });
    expect(result.capacity).toMatchObject({
      reservedAmount: '110.075',
      availableAmount: '889.925',
    });
    expect(repository.capacityEvents[0].amount).toBe('10.075');
  });

  test('accepts an exact-fit fractional reservation at assignment scale', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{
        programId: 1,
        totalLimit: '10000000.01',
        reservedAmount: '0.01',
        updatedAt: NOW,
      }],
    });
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-exact-fit',
      amount: '10000000',
      currency: 'USD',
    });

    expect(result.capacity).toMatchObject({
      totalLimit: '10000000.01',
      reservedAmount: '10000000.01',
      availableAmount: '0',
    });
  });

  test('repeated fractional reserve and release operations leave no residual balance', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1', reservedAmount: '0', updatedAt: NOW }],
    });
    const service = createService(repository);

    for (const invoiceId of ['fraction-1', 'fraction-2', 'fraction-3']) {
      await service.createReservation('program-1', {
        invoiceId,
        amount: '0.1',
        currency: 'USD',
      });
      await service.releaseReservation('program-1', invoiceId);
    }

    expect(repository.balances[0].reservedAmount).toBe('0');
    expect(await service.getCapacity('program-1')).toMatchObject({
      reservedAmount: '0',
      availableAmount: '1',
    });
  });

  test('creates a cross-currency reservation using the latest effective direct FX rate', async () => {
    const repository = new FakeCapacityRepository({
      fxRates: [
        {
          id: 4,
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: '1.1',
          effectiveAt: '2026-07-02T10:00:00.000Z',
          createdAt: NOW,
        },
        {
          id: 5,
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: '1.25',
          effectiveAt: '2026-07-02T11:00:00.000Z',
          createdAt: NOW,
        },
      ],
    });
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-eur-1',
      amount: '200',
      currency: 'EUR',
    });

    expect(result.reservation).toMatchObject({
      invoiceId: 'invoice-eur-1',
      invoiceAmount: '200',
      invoiceCurrency: 'EUR',
      amount: '250',
      currency: 'USD',
      fxRateId: 5,
    });
    expect(result.capacity).toMatchObject({
      reservedAmount: '350',
      availableAmount: '650',
    });
    expect(repository.capacityEvents[0]).toMatchObject({
      amount: '250',
      currency: 'USD',
    });
  });

  test('rounds converted reservation amount before capacity checks and persistence', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '110.08', reservedAmount: '100', updatedAt: NOW }],
      fxRates: [{
        id: 8,
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '1',
        effectiveAt: '2026-07-02T11:00:00.000Z',
        createdAt: NOW,
      }],
    });
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-rounding',
      amount: '10.075',
      currency: 'EUR',
    });

    expect(result.reservation).toMatchObject({
      invoiceAmount: '10.075',
      invoiceCurrency: 'EUR',
      amount: '10.08',
      currency: 'USD',
      fxRateId: 8,
    });
    expect(result.capacity).toMatchObject({
      reservedAmount: '110.08',
      availableAmount: '0',
    });
    expect(repository.balances[0].reservedAmount).toBe('110.08');
  });

  test('accepts a cross-currency amount at the half-cent threshold', async () => {
    const repository = new FakeCapacityRepository({
      fxRates: [{
        id: 9,
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '1',
        effectiveAt: '2026-07-02T11:00:00.000Z',
        createdAt: NOW,
      }],
    });
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-half-cent',
      amount: '0.005',
      currency: 'EUR',
    });

    expect(result.reservation).toMatchObject({
      invoiceAmount: '0.005',
      amount: '0.01',
      currency: 'USD',
      fxRateId: 9,
    });
    expect(result.capacity.reservedAmount).toBe('100.01');
    expect(repository.capacityEvents[0].amount).toBe('0.01');
  });

  test('rejects a cross-currency amount below half a cent without mutation', async () => {
    const repository = new FakeCapacityRepository({
      fxRates: [{
        id: 10,
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '1',
        effectiveAt: '2026-07-02T11:00:00.000Z',
        createdAt: NOW,
      }],
    });
    const service = createService(repository);

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-below-half-cent',
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
    expect(repository.balances[0].reservedAmount).toBe('100');
    expect(repository.reservations).toHaveLength(0);
    expect(repository.capacityEvents).toHaveLength(0);
  });

  test('rejects reservation when capacity is insufficient', async () => {
    const service = createService();

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-2',
      amount: '901',
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
      data: {
        availableAmount: '900',
        requestedAmount: '901',
      },
    });
  });

  test('rejects cross-currency reservation when converted capacity is insufficient', async () => {
    const repository = new FakeCapacityRepository({
      fxRates: [{
        id: 11,
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '2',
        effectiveAt: '2026-07-02T11:00:00.000Z',
        createdAt: NOW,
      }],
    });
    const service = createService(repository);

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-too-large-eur',
      amount: '451',
      currency: 'EUR',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(repository.reservations).toHaveLength(0);
    expect(repository.capacityEvents).toHaveLength(0);
  });

  test('rejects duplicate invoice reservations for the same program', async () => {
    const repository = new FakeCapacityRepository({
      reservations: [{
        id: 7,
        programId: 1,
        invoiceId: 'invoice-1',
        amount: '50',
        currency: 'USD',
        status: ReservationStatus.Reserved,
        releasedAmount: '0',
        reservedAt: NOW,
        releasedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    });
    const service = createService(repository);

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-1',
      amount: '10',
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(repository.balances[0].reservedAmount).toBe('100');
    expect(repository.reservations).toHaveLength(1);
    expect(repository.capacityEvents).toHaveLength(0);
    expect(repository.lockedBalanceReads).toEqual([1]);
  });

  test('rolls back reservation state when event writing fails', async () => {
    const repository = new FakeCapacityRepository({ failOnCreateCapacityEvent: true });
    const service = createService(repository);

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-rollback',
      amount: '200',
      currency: 'USD',
    })).rejects.toThrow('Capacity event write failed');

    expect(repository.balances[0].reservedAmount).toBe('100');
    expect(repository.reservations).toHaveLength(0);
    expect(repository.capacityEvents).toHaveLength(0);
  });

  test('serializes concurrent reservations that would exceed the program limit', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '0', updatedAt: NOW }],
    });
    const service = createService(repository);

    const results = await Promise.allSettled([
      service.createReservation('program-1', {
        invoiceId: 'invoice-concurrent-1',
        amount: '700',
        currency: 'USD',
      }),
      service.createReservation('program-1', {
        invoiceId: 'invoice-concurrent-2',
        amount: '700',
        currency: 'USD',
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      output: { statusCode: 409 },
    });
    expect(repository.balances[0].reservedAmount).toBe('700');
    expect(repository.reservations).toHaveLength(1);
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.lockedBalanceReads).toEqual([1, 1]);
  });

  test('rejects cross-currency reservation when no usable FX rate exists', async () => {
    const service = createService();

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-3',
      amount: '100',
      currency: 'EUR',
    })).rejects.toMatchObject({
      output: { statusCode: 422 },
    });
  });

  test('fully releases a reserved reservation and returns refreshed capacity', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '300', updatedAt: NOW }],
      reservations: [{
        id: 9,
        programId: 1,
        invoiceId: 'invoice-9',
        amount: '200',
        currency: 'USD',
        status: ReservationStatus.Reserved,
        releasedAmount: '0',
        reservedAt: NOW,
        releasedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    });
    const service = createService(repository);

    const result = await service.releaseReservation('program-1', 'invoice-9');

    expect(result.reservation).toMatchObject({
      id: 9,
      status: ReservationStatus.Released,
      releasedAmount: '200',
    });
    expect(result.capacity).toMatchObject({
      reservedAmount: '100',
      availableAmount: '900',
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReservationReleased,
      invoiceId: 'invoice-9',
      amount: '200',
    });
    expect(repository.lockedBalanceReads).toEqual([1]);
    expect(repository.lockedReservationReads).toEqual([{ programId: 1, invoiceId: 'invoice-9' }]);
  });

  test('releases cross-currency reservation using the stored converted amount without re-conversion', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '250', updatedAt: NOW }],
      reservations: [{
        id: 12,
        programId: 1,
        invoiceId: 'invoice-eur-release',
        invoiceAmount: '200',
        invoiceCurrency: 'EUR',
        amount: '250',
        currency: 'USD',
        fxRateId: 5,
        status: ReservationStatus.Reserved,
        releasedAmount: '0',
        reservedAt: NOW,
        releasedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
      fxRates: [{
        id: 6,
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: '2',
        effectiveAt: NOW,
        createdAt: NOW,
      }],
    });
    const service = createService(repository);

    const result = await service.releaseReservation('program-1', 'invoice-eur-release');

    expect(result.reservation).toMatchObject({
      invoiceAmount: '200',
      invoiceCurrency: 'EUR',
      amount: '250',
      currency: 'USD',
      fxRateId: 5,
      releasedAmount: '250',
    });
    expect(result.capacity).toMatchObject({
      reservedAmount: '0',
      availableAmount: '1000',
    });
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReservationReleased,
      amount: '250',
      currency: 'USD',
    });
  });

  test('reconciles a program capacity snapshot without changing reservations', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '250', updatedAt: NOW }],
      reservations: [{
        id: 14,
        programId: 1,
        invoiceId: 'invoice-kept-during-reconciliation',
        invoiceAmount: '200',
        invoiceCurrency: 'USD',
        amount: '200',
        currency: 'USD',
        fxRateId: null,
        status: ReservationStatus.Reserved,
        releasedAmount: '0',
        reservedAt: NOW,
        releasedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    });
    const service = createService(repository);

    const result = await service.reconcileProgramSnapshot('program-1', {
      currency: 'USD',
      totalLimit: '1500',
      reservedAmount: '375',
      occurredAt: '2026-07-02T11:00:00.000Z',
    });

    expect(result.capacity).toMatchObject({
      programId: 'program-1',
      totalLimit: '1500',
      reservedAmount: '375',
      availableAmount: '1125',
      updatedAt: '2026-07-02T11:00:00.000Z',
    });
    expect(repository.reservations).toHaveLength(1);
    expect(repository.reservations[0]).toMatchObject({
      invoiceId: 'invoice-kept-during-reconciliation',
      status: ReservationStatus.Reserved,
      amount: '200',
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReconciliationApplied,
      source: CapacityEventSource.Reconciliation,
      reservationId: null,
      invoiceId: null,
      amount: '375',
      currency: 'USD',
      occurredAt: '2026-07-02T11:00:00.000Z',
    });
    expect(repository.lockedBalanceReads).toEqual([1]);
  });

  test('accepts a reconciliation snapshot with zero reserved amount', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '250', updatedAt: NOW }],
    });
    const service = createService(repository);

    const result = await service.reconcileProgramSnapshot('program-1', {
      currency: 'USD',
      totalLimit: '900',
      reservedAmount: '0',
      occurredAt: '2026-07-02T11:15:00.000Z',
    });

    expect(result.capacity).toMatchObject({
      totalLimit: '900',
      reservedAmount: '0',
      availableAmount: '900',
    });
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReconciliationApplied,
      amount: '0',
    });
  });

  test('rejects reconciliation currency mismatch without mutating balance', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '250', updatedAt: NOW }],
    });
    const service = createService(repository);

    await expect(service.reconcileProgramSnapshot('program-1', {
      currency: 'EUR',
      totalLimit: '900',
      reservedAmount: '0',
      occurredAt: '2026-07-02T11:15:00.000Z',
    })).rejects.toMatchObject({
      output: { statusCode: 422 },
    });

    expect(repository.balances[0]).toMatchObject({
      totalLimit: '1000',
      reservedAmount: '250',
    });
    expect(repository.capacityEvents).toHaveLength(0);
  });

  test('rejects reconciliation reserved amount above total limit without mutating balance', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1000', reservedAmount: '250', updatedAt: NOW }],
    });
    const service = createService(repository);

    await expect(service.reconcileProgramSnapshot('program-1', {
      currency: 'USD',
      totalLimit: '900',
      reservedAmount: '901',
      occurredAt: '2026-07-02T11:15:00.000Z',
    })).rejects.toMatchObject({
      output: { statusCode: 400 },
    });

    expect(repository.balances[0]).toMatchObject({
      totalLimit: '1000',
      reservedAmount: '250',
    });
    expect(repository.capacityEvents).toHaveLength(0);
  });

  test('compares high-precision reconciliation amounts exactly', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: '1', reservedAmount: '0', updatedAt: NOW }],
    });
    const service = createService(repository);

    await expect(service.reconcileProgramSnapshot('program-1', {
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

    expect(repository.balances[0]).toMatchObject({ totalLimit: '1', reservedAmount: '0' });
  });

  test('rejects release for an already released reservation', async () => {
    const repository = new FakeCapacityRepository({
      reservations: [{
        id: 10,
        programId: 1,
        invoiceId: 'invoice-10',
        amount: '100',
        currency: 'USD',
        status: ReservationStatus.Released,
        releasedAmount: '100',
        reservedAt: NOW,
        releasedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    });
    const service = createService(repository);

    await expect(service.releaseReservation('program-1', 'invoice-10')).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
    expect(repository.balances[0].reservedAmount).toBe('100');
    expect(repository.reservations[0].status).toBe(ReservationStatus.Released);
    expect(repository.capacityEvents).toHaveLength(0);
    expect(repository.lockedBalanceReads).toEqual([1]);
    expect(repository.lockedReservationReads).toEqual([{ programId: 1, invoiceId: 'invoice-10' }]);
  });

  test('rejects release for an invoice without a reservation in the program', async () => {
    const service = createService();

    await expect(service.releaseReservation('program-1', 'missing-invoice')).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});
