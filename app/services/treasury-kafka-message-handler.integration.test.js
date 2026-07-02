import {
  CapacityEventSource,
  CapacityEventType,
  ReservationStatus,
  TreasuryKafkaEventType,
  TreasuryKafkaMessageStatus,
} from '../constants/capacity.js';
import CapacityRepository from '../repositories/capacity.js';
import {
  countAllEvents,
  countEvents,
  findBalance,
  findEvents,
  findKafkaMessages,
  findProgram,
  findReservations,
  setupIntegrationDatabase,
} from '../test/integration-db.js';
import CapacityService from './capacity.js';
import TreasuryKafkaMessageHandler, {
  TreasuryKafkaHandlerResult,
} from './treasury-kafka-message-handler.js';

const NOW = new Date('2026-07-02T12:00:00.000Z');
const PROGRAM_PREFIX = `cir006-${process.pid}-`;

let programSequence = 0;

const createService = () =>
  new CapacityService({
    repository: new CapacityRepository(),
    now: () => NOW,
  });

const createHandler = () =>
  new TreasuryKafkaMessageHandler({
    now: () => NOW,
  });

const nextProgramId = () => {
  programSequence += 1;

  return `${PROGRAM_PREFIX}${programSequence}`;
};

const buildKafkaMessage = (payload, {
  topic = 'treasury.capacity.events',
  partition = 0,
  offset = '1',
  key = payload?.programId || 'program-1',
  value = JSON.stringify(payload),
} = {}) => ({
  topic,
  partition,
  message: {
    offset,
    key: Buffer.from(key),
    value: Buffer.from(value),
  },
});

setupIntegrationDatabase();

describe('TreasuryKafkaMessageHandler integration', () => {
  test('processes reservation approval messages through the capacity domain transaction', async () => {
    const service = createService();
    const handler = createHandler();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });

    const result = await handler.handleKafkaMessage(buildKafkaMessage({
      messageId: 'kafka-message-reservation',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: '2026-07-02T11:30:00.000Z',
      programId: programExternalId,
      invoiceId: 'invoice-kafka-reservation',
      amount: 275,
      currency: 'USD',
    }));
    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);
    const events = await findEvents(program.id, CapacityEventType.ReservationCreated);
    const messages = await findKafkaMessages();

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Processed);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: 'kafka-message-reservation',
      topic: 'treasury.capacity.events',
      partition: 0,
      messageOffset: '1',
      messageKey: programExternalId,
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      programId: programExternalId,
      invoiceId: 'invoice-kafka-reservation',
      status: TreasuryKafkaMessageStatus.Processed,
      failureReason: null,
    });
    expect(balance.reservedAmount).toBe(275);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      invoiceId: 'invoice-kafka-reservation',
      status: ReservationStatus.Reserved,
      amount: 275,
      currency: 'USD',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: CapacityEventSource.KafkaTreasury,
      invoiceId: 'invoice-kafka-reservation',
      amount: 275,
      currency: 'USD',
    });
    expect(events[0].occurredAt).toBeInstanceOf(Date);
  });

  test('processes invoice repayment messages through the capacity release flow', async () => {
    const service = createService();
    const handler = createHandler();
    const programExternalId = nextProgramId();

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });
    await service.createReservation(programExternalId, {
      invoiceId: 'invoice-kafka-release',
      amount: 320,
      currency: 'USD',
    });

    const result = await handler.handleKafkaMessage(buildKafkaMessage({
      messageId: 'kafka-message-release',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      occurredAt: '2026-07-02T11:45:00.000Z',
      programId: programExternalId,
      invoiceId: 'invoice-kafka-release',
    }, {
      offset: '2',
    }));
    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);
    const events = await findEvents(program.id, CapacityEventType.ReservationReleased);
    const messages = await findKafkaMessages();

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Processed);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: 'kafka-message-release',
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      status: TreasuryKafkaMessageStatus.Processed,
    });
    expect(balance.reservedAmount).toBe(0);
    expect(reservations[0]).toMatchObject({
      invoiceId: 'invoice-kafka-release',
      status: ReservationStatus.Released,
      releasedAmount: 320,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: CapacityEventSource.KafkaTreasury,
      invoiceId: 'invoice-kafka-release',
      amount: 320,
      currency: 'USD',
    });
    expect(events[0].occurredAt).toBeInstanceOf(Date);
  });

  test('skips duplicate message ids without applying capacity twice', async () => {
    const service = createService();
    const handler = createHandler();
    const programExternalId = nextProgramId();
    const message = {
      messageId: 'kafka-message-duplicate-id',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: '2026-07-02T11:30:00.000Z',
      programId: programExternalId,
      invoiceId: 'invoice-duplicate-id-1',
      amount: 180,
      currency: 'USD',
    };

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });
    await handler.handleKafkaMessage(buildKafkaMessage(message, { offset: '3' }));
    const result = await handler.handleKafkaMessage(buildKafkaMessage({
      ...message,
      invoiceId: 'invoice-duplicate-id-2',
      amount: 400,
    }, {
      offset: '4',
    }));
    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);
    const messages = await findKafkaMessages();

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Duplicate);
    expect(messages).toHaveLength(1);
    expect(balance.reservedAmount).toBe(180);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].invoiceId).toBe('invoice-duplicate-id-1');
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(1);
  });

  test('skips duplicate broker offsets without applying capacity twice', async () => {
    const service = createService();
    const handler = createHandler();
    const programExternalId = nextProgramId();
    const message = {
      messageId: 'kafka-message-offset-1',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: '2026-07-02T11:30:00.000Z',
      programId: programExternalId,
      invoiceId: 'invoice-offset-1',
      amount: 190,
      currency: 'USD',
    };

    await service.createProgram({
      externalId: programExternalId,
      currency: 'USD',
      totalLimit: 1000,
    });
    await handler.handleKafkaMessage(buildKafkaMessage(message, { offset: '5' }));
    const result = await handler.handleKafkaMessage(buildKafkaMessage({
      ...message,
      messageId: 'kafka-message-offset-2',
      invoiceId: 'invoice-offset-2',
      amount: 410,
    }, {
      offset: '5',
    }));
    const program = await findProgram(programExternalId);
    const balance = await findBalance(program.id);
    const reservations = await findReservations(program.id);
    const messages = await findKafkaMessages();

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Duplicate);
    expect(messages).toHaveLength(1);
    expect(balance.reservedAmount).toBe(190);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].invoiceId).toBe('invoice-offset-1');
    expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(1);
  });

  test('records malformed messages as rejected without creating capacity events', async () => {
    const handler = createHandler();

    const result = await handler.handleKafkaMessage(buildKafkaMessage(null, {
      offset: '6',
      value: '{bad-json',
    }));
    const messages = await findKafkaMessages();

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: null,
      topic: 'treasury.capacity.events',
      partition: 0,
      messageOffset: '6',
      messageKey: 'program-1',
      schemaVersion: null,
      eventType: null,
      programId: null,
      invoiceId: null,
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'Malformed JSON',
    });
    expect(await countAllEvents()).toBe(0);
  });
});
