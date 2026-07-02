import CapacityService from './capacity.js';
import {
  CapacityEventType,
  ReservationStatus,
} from '../constants/capacity.js';

const NOW = new Date('2026-07-02T12:00:00.000Z');

class FakeCapacityRepository {
  constructor({
    programs = [{ id: 1, externalId: 'program-1', currency: 'USD' }],
    balances = [{ programId: 1, totalLimit: 1000, reservedAmount: 100, updatedAt: NOW }],
    reservations = [],
  } = {}) {
    this.programs = programs;
    this.balances = balances;
    this.reservations = reservations;
    this.capacityEvents = [];
    this.nextProgramId = programs.reduce((max, program) =>
      Math.max(max, program.id), 0) + 1;
    this.nextReservationId = reservations.reduce((max, reservation) =>
      Math.max(max, reservation.id), 0) + 1;
  }

  withTransaction(callback) {
    return callback({});
  }

  findProgramByExternalId(externalId) {
    return this.programs.find((program) => program.externalId === externalId);
  }

  findProgramById(id) {
    return this.programs.find((program) => program.id === id);
  }

  createProgram(data) {
    const program = {
      id: this.nextProgramId,
      ...data,
    };
    this.nextProgramId += 1;
    this.programs.push(program);

    return program;
  }

  findBalanceByProgramId(programId) {
    return this.balances.find((balance) => balance.programId === programId);
  }

  createBalance(data) {
    this.balances.push(data);

    return data;
  }

  findReservationByProgramAndInvoice(programId, invoiceId) {
    return this.reservations.find((reservation) =>
      reservation.programId === programId && reservation.invoiceId === invoiceId);
  }

  createReservation(data) {
    const reservation = {
      id: this.nextReservationId,
      releasedAt: null,
      ...data,
    };
    this.nextReservationId += 1;
    this.reservations.push(reservation);

    return reservation;
  }

  updateBalance(programId, patch) {
    const balance = this.findBalanceByProgramId(programId);
    Object.assign(balance, patch);

    return balance;
  }

  updateReservation(id, patch) {
    const reservation = this.reservations.find((item) => item.id === id);
    Object.assign(reservation, patch);

    return reservation;
  }

  createCapacityEvent(data) {
    const event = {
      id: this.capacityEvents.length + 1,
      ...data,
    };
    this.capacityEvents.push(event);

    return event;
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
      totalLimit: 5000,
    });

    expect(result.program).toMatchObject({
      id: 1,
      externalId: 'program-new',
      currency: 'USD',
    });
    expect(result.capacity).toMatchObject({
      programId: 'program-new',
      totalLimit: 5000,
      reservedAmount: 0,
      availableAmount: 5000,
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ProgramCreated,
      amount: 5000,
      currency: 'USD',
    });
  });

  test('rejects duplicate program creation', async () => {
    const service = createService();

    await expect(service.createProgram({
      externalId: 'program-1',
      currency: 'USD',
      totalLimit: 5000,
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });

  test('creates a reservation and returns refreshed capacity', async () => {
    const repository = new FakeCapacityRepository();
    const service = createService(repository);

    const result = await service.createReservation('program-1', {
      invoiceId: 'invoice-1',
      amount: 200,
      currency: 'USD',
    });

    expect(result.reservation).toMatchObject({
      id: 1,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: 200,
      currency: 'USD',
      status: ReservationStatus.Reserved,
      releasedAmount: 0,
    });
    expect(result.capacity).toMatchObject({
      programId: 'program-1',
      totalLimit: 1000,
      reservedAmount: 300,
      availableAmount: 700,
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReservationCreated,
      invoiceId: 'invoice-1',
      amount: 200,
    });
  });

  test('rejects reservation when capacity is insufficient', async () => {
    const service = createService();

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-2',
      amount: 901,
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });

  test('rejects duplicate invoice reservations for the same program', async () => {
    const repository = new FakeCapacityRepository({
      reservations: [{
        id: 7,
        programId: 1,
        invoiceId: 'invoice-1',
        amount: 50,
        currency: 'USD',
        status: ReservationStatus.Reserved,
        releasedAmount: 0,
        reservedAt: NOW,
        releasedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    });
    const service = createService(repository);

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-1',
      amount: 10,
      currency: 'USD',
    })).rejects.toMatchObject({
      output: { statusCode: 409 },
    });
  });

  test('rejects reservation when currency differs from program currency', async () => {
    const service = createService();

    await expect(service.createReservation('program-1', {
      invoiceId: 'invoice-3',
      amount: 100,
      currency: 'EUR',
    })).rejects.toMatchObject({
      output: { statusCode: 422 },
    });
  });

  test('fully releases a reserved reservation and returns refreshed capacity', async () => {
    const repository = new FakeCapacityRepository({
      balances: [{ programId: 1, totalLimit: 1000, reservedAmount: 300, updatedAt: NOW }],
      reservations: [{
        id: 9,
        programId: 1,
        invoiceId: 'invoice-9',
        amount: 200,
        currency: 'USD',
        status: ReservationStatus.Reserved,
        releasedAmount: 0,
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
      releasedAmount: 200,
    });
    expect(result.capacity).toMatchObject({
      reservedAmount: 100,
      availableAmount: 900,
    });
    expect(repository.capacityEvents).toHaveLength(1);
    expect(repository.capacityEvents[0]).toMatchObject({
      eventType: CapacityEventType.ReservationReleased,
      invoiceId: 'invoice-9',
      amount: 200,
    });
  });

  test('rejects release for an already released reservation', async () => {
    const repository = new FakeCapacityRepository({
      reservations: [{
        id: 10,
        programId: 1,
        invoiceId: 'invoice-10',
        amount: 100,
        currency: 'USD',
        status: ReservationStatus.Released,
        releasedAmount: 100,
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
  });

  test('rejects release for an invoice without a reservation in the program', async () => {
    const service = createService();

    await expect(service.releaseReservation('program-1', 'missing-invoice')).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
  });
});
