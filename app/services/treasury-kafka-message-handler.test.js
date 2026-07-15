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

  async updateMessage(id, patch) {
    const message = this.messages.find((item) => item.id === id);

    Object.assign(message, patch);

    return message;
  }
}

const createCapacityDomainService = () => ({
  createReservation: jest.fn().mockResolvedValue({}),
  releaseReservation: jest.fn().mockResolvedValue({}),
  reconcileProgramSnapshot: jest.fn().mockResolvedValue({}),
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
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: '125',
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
      schemaVersion: 2,
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
        amount: '125',
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
      schemaVersion: 2,
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

  test('dispatches PROGRAM_RECONCILED messages to the reconciliation flow', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-reconciliation',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ProgramReconciled,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      currency: 'USD',
      totalLimit: '1000',
      reservedAmount: '125',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Processed);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-reconciliation',
      eventType: TreasuryKafkaEventType.ProgramReconciled,
      programId: 'program-1',
      invoiceId: null,
      status: TreasuryKafkaMessageStatus.Processed,
    });
    expect(capacityDomainService.reconcileProgramSnapshot).toHaveBeenCalledWith(
      'program-1',
      {
        currency: 'USD',
        totalLimit: '1000',
        reservedAmount: '125',
        occurredAt: OCCURRED_AT,
      },
      {
        source: CapacityEventSource.Reconciliation,
        occurredAt: OCCURRED_AT,
        trx: repository.lastTrx,
      },
    );
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
    expect(capacityDomainService.releaseReservation).not.toHaveBeenCalled();
  });

  test('records schema-invalid messages as rejected without applying capacity changes', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-invalid',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: '125',
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

  test('rejects retired schema version 1 without applying capacity changes', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-version-1',
      schemaVersion: 1,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: '125',
      currency: 'USD',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      schemaVersion: 1,
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'schemaVersion must be 2',
    });
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
  });

  test('rejects version 2 numeric monetary fields without applying capacity changes', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-numeric-amount',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: 125,
      currency: 'USD',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      schemaVersion: 2,
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'amount must be positive',
    });
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
  });

  test('records invalid reconciliation snapshots as rejected without applying capacity changes', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const payload = {
      messageId: 'message-invalid-reconciliation',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ProgramReconciled,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      currency: 'USD',
      totalLimit: '100',
      reservedAmount: '101',
    };

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-invalid-reconciliation',
      eventType: TreasuryKafkaEventType.ProgramReconciled,
      invoiceId: null,
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'reservedAmount must not exceed totalLimit',
    });
    expect(capacityDomainService.reconcileProgramSnapshot).not.toHaveBeenCalled();
    expect(capacityDomainService.createReservation).not.toHaveBeenCalled();
    expect(capacityDomainService.releaseReservation).not.toHaveBeenCalled();
  });

  test('records reconciliation domain validation failures as rejected', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const domainError = new Error('Program not found');
    const payload = {
      messageId: 'message-reconciliation-unknown-program',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ProgramReconciled,
      occurredAt: OCCURRED_AT,
      programId: 'missing-program',
      currency: 'USD',
      totalLimit: '1000',
      reservedAmount: '0',
    };

    domainError.isBoom = true;
    domainError.output = { statusCode: 404 };
    capacityDomainService.reconcileProgramSnapshot.mockRejectedValue(domainError);

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-reconciliation-unknown-program',
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'Program not found',
    });
    expect(capacityDomainService.reconcileProgramSnapshot).toHaveBeenCalledTimes(1);
  });

  test('records reservation domain validation failures as rejected', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const domainError = new Error('Missing FX rate');
    const payload = {
      messageId: 'message-reservation-missing-fx-rate',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: '125',
      currency: 'EUR',
    };

    domainError.isBoom = true;
    domainError.output = { statusCode: 422 };
    capacityDomainService.createReservation.mockRejectedValue(domainError);

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-reservation-missing-fx-rate',
      eventType: TreasuryKafkaEventType.ReservationApproved,
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'Missing FX rate',
    });
    expect(capacityDomainService.createReservation).toHaveBeenCalledTimes(1);
  });

  test('records release domain validation failures as rejected', async () => {
    const { handler, repository, capacityDomainService } = createHandler();
    const domainError = new Error('Reservation not found');
    const payload = {
      messageId: 'message-release-missing-reservation',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
    };

    domainError.isBoom = true;
    domainError.output = { statusCode: 404 };
    capacityDomainService.releaseReservation.mockRejectedValue(domainError);

    const result = await handler.handleKafkaMessage(buildMessage(payload));

    expect(result.status).toBe(TreasuryKafkaHandlerResult.Rejected);
    expect(repository.messages[0]).toMatchObject({
      messageId: 'message-release-missing-reservation',
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      status: TreasuryKafkaMessageStatus.Rejected,
      failureReason: 'Reservation not found',
    });
    expect(capacityDomainService.releaseReservation).toHaveBeenCalledTimes(1);
  });

  test('throws non-Boom domain errors so Kafka can redeliver retryable failures', async () => {
    const { handler, capacityDomainService } = createHandler();
    const domainError = new Error('database unavailable');
    const payload = {
      messageId: 'message-reservation-retryable-error',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.ReservationApproved,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
      amount: '125',
      currency: 'USD',
    };

    capacityDomainService.createReservation.mockRejectedValue(domainError);

    await expect(handler.handleKafkaMessage(buildMessage(payload))).rejects.toThrow('database unavailable');
  });

  test('throws Boom 5xx domain errors so Kafka can redeliver retryable failures', async () => {
    const { handler, capacityDomainService } = createHandler();
    const domainError = new Error('Capacity write failed');
    const payload = {
      messageId: 'message-release-retryable-error',
      schemaVersion: 2,
      eventType: TreasuryKafkaEventType.InvoiceRepaid,
      occurredAt: OCCURRED_AT,
      programId: 'program-1',
      invoiceId: 'invoice-1',
    };

    domainError.isBoom = true;
    domainError.output = { statusCode: 500 };
    capacityDomainService.releaseReservation.mockRejectedValue(domainError);

    await expect(handler.handleKafkaMessage(buildMessage(payload))).rejects.toThrow('Capacity write failed');
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
      schemaVersion: 2,
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
    expect(capacityDomainService.reconcileProgramSnapshot).not.toHaveBeenCalled();
  });
});
