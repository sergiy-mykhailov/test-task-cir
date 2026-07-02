import { jest } from '@jest/globals';
import {
  CapacityEventSource,
  TreasuryKafkaEventType,
  TreasuryKafkaMessageStatus,
} from '../constants/capacity.js';
import TreasuryKafkaMessageHandler, {
  TreasuryKafkaHandlerResult,
} from './treasury-kafka-message-handler.js';

const NOW = new Date('2026-07-02T12:00:00.000Z');
const OCCURRED_AT = '2026-07-02T11:45:00.000Z';

class FakeTreasuryKafkaMessagesRepository {
  constructor({ duplicate = null } = {}) {
    this.duplicate = duplicate;
    this.messages = [];
    this.findCalls = [];
    this.lastTrx = null;
  }

  async withTransaction(callback) {
    const trx = { id: `trx-${this.findCalls.length + 1}` };

    this.lastTrx = trx;

    return callback(trx);
  }

  async findHandledMessage(criteria, trx) {
    this.findCalls.push({ criteria, trx });

    return this.duplicate;
  }

  async createMessage(data, trx) {
    const message = {
      id: this.messages.length + 1,
      ...data,
      trx,
    };

    this.messages.push(message);

    return message;
  }
}

const createCapacityDomainService = () => ({
  createReservation: jest.fn().mockResolvedValue({}),
  releaseReservation: jest.fn().mockResolvedValue({}),
});

const createHandler = (repository = new FakeTreasuryKafkaMessagesRepository()) => {
  const capacityDomainService = createCapacityDomainService();

  return {
    repository,
    capacityDomainService,
    handler: new TreasuryKafkaMessageHandler({
      repository,
      capacityDomainService,
      now: () => NOW,
    }),
  };
};

const buildMessage = (payload, {
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

describe('TreasuryKafkaMessageHandler', () => {
  test('dispatches RESERVATION_APPROVED messages to the capacity reservation flow', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-1',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: 125,
      currency: 'USD',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Processed);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-1',
      topic: 'treasury.capacity.events',
      partition: 0,
      messageOffset: '1',
      messageKey: 'program-1',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      status: TreasuryKafkaMessageStatus.Processed,
      failureReason: null,
      processedAt: NOW.toISOString(),
    });
    expect(capacityDomainService.createReservation).toHaveBeenCalledWith(
      'program-1',
      {
        invoiceId: 'invoice-1',
        amount: 125,
        currency: 'USD',
      },
      {
        source: CapacityEventSource.KafkaTreasury,
        occurredAt: OCCURRED_AT,
        trx: repository.lastTrx,
      },
    );
    expect(capacityDomainService.releaseReservation).not.toHaveBeenCalled();
  });

  test('dispatches INVOICE_REPAID messages to the capacity release flow', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-2',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Processed);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-2',
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      status: TreasuryKafkaMessageStatus.Processed,
    });
    expect(capacityDomainService.releaseReservation).toHaveBeenCalledWith(
      'program-1',
      'invoice-1',
      {
        source: CapacityEventSource.KafkaTreasury,
        occurredAt: OCCURRED_AT,
        trx: repository.lastTrx,
      },
    );
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
  });

  test('records schema-invalid messages as rejected without applying capacity changes', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-invalid',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: 125,
      currency: 'usd',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-invalid',
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'currency must be an uppercase three-letter code',
    });
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
    expect(capacityDomainService.releaseReservation).not.toHaveBeenCalled();
  });

  test('skips messages already present in the inbox', async () => {
    const duplicate = {
      id: 42,
      messageId: 'message-duplicate',
      status: TreasuryKafkaMessageStatus.Processed,
    };
    const repository = new FakeTreasuryKafkaMessagesRepository({ duplicate });
    const { handler, capacityDomainService } = createHandler(repository);
    const payload = {
      messageId: 'message-duplicate',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result).toEqual({
      status: TreasuryKafkaHandlerResult.Duplicate,
      message: duplicate,
    });
    expect(repository.messages).toHaveLength(0);
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
    expect(capacityDomainService.releaseReservation).not.toHaveBeenCalled();
  });
});
