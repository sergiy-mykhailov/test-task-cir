import {
  CapacityEventSource,
  TreasuryKafkaEventType,
  TreasuryKafkaMessageStatus,
} from '../constants/capacity.js';
import TreasuryKafkaMessagesRepository from '../repositories/treasury-kafka-messages.js';
import {
  bufferToString,
  isNonEmptyString,
  toTimestamp,
} from '../utils/format.js';
import { capacityService } from './capacity.js';

export const TreasuryKafkaHandlerResult = Object.freeze({
  Processed: 'PROCESSED',
  Rejected: 'REJECTED',
  Duplicate: 'DUPLICATE',
});

const SUPPORTED_SCHEMA_VERSION = 1;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export default class TreasuryKafkaMessageHandler {
  constructor({
    repository = new TreasuryKafkaMessagesRepository(),
    capacityDomainService = capacityService,
    now = () => new Date(),
  } = {}) {
    this.repository = repository;
    this.capacityDomainService = capacityDomainService;
    this.now = now;
  }

  async handleKafkaMessage(kafkaPayload) {
    const metadata = this.#getMessageMetadata(kafkaPayload);
    const parsed = this.#parseJson(metadata.value);

    if (!parsed.ok) {
      return this.#recordRejected(metadata, null, parsed.reason);
    }

    const validationError = this.#validateTreasuryMessage(parsed.payload);

    if (validationError) {
      return this.#recordRejected(metadata, parsed.payload, validationError);
    }

    return this.repository.withTransaction(async (trx) => {
      const duplicate = await this.repository.findHandledMessage({
        messageId: parsed.payload.messageId,
        ...metadata,
      }, trx);

      if (duplicate) {
        return {
          status: TreasuryKafkaHandlerResult.Duplicate,
          message: duplicate,
        };
      }

      const message = await this.repository.createMessage(this.#buildMessageRecord({
        metadata,
        payload: parsed.payload,
        status: TreasuryKafkaMessageStatus.Processed,
      }), trx);

      await this.#applyDomainOperation(parsed.payload, trx);

      return {
        status: TreasuryKafkaHandlerResult.Processed,
        message,
      };
    });
  }

  async #recordRejected(metadata, payload, failureReason) {
    return this.repository.withTransaction(async (trx) => {
      const duplicate = await this.repository.findHandledMessage({
        messageId: payload?.messageId,
        ...metadata,
      }, trx);

      if (duplicate) {
        return {
          status: TreasuryKafkaHandlerResult.Duplicate,
          message: duplicate,
        };
      }

      const message = await this.repository.createMessage(this.#buildMessageRecord({
        metadata,
        payload,
        status: TreasuryKafkaMessageStatus.Rejected,
        failureReason,
      }), trx);

      return {
        status: TreasuryKafkaHandlerResult.Rejected,
        message,
      };
    });
  }

  async #applyDomainOperation(payload, trx) {
    if (payload.eventType === TreasuryKafkaEventType.ReservationApproved) {
      await this.capacityDomainService.createReservation(payload.programId, {
        invoiceId: payload.invoiceId,
        amount: payload.amount,
        currency: payload.currency,
      }, {
        source: CapacityEventSource.KafkaTreasury,
        occurredAt: payload.occurredAt,
        trx,
      });

      return;
    }

    if (payload.eventType === TreasuryKafkaEventType.InvoiceRepaid) {
      await this.capacityDomainService.releaseReservation(payload.programId, payload.invoiceId, {
        source: CapacityEventSource.KafkaTreasury,
        occurredAt: payload.occurredAt,
        trx,
      });

      return;
    }

    throw new Error(`Unsupported treasury Kafka event type: ${payload.eventType}`);
  }

  #getMessageMetadata({ topic, partition, message }) {
    return {
      topic,
      partition,
      messageOffset: String(message.offset),
      messageKey: bufferToString(message.key),
      value: bufferToString(message.value),
    };
  }

  #parseJson(value) {
    try {
      return {
        ok: true,
        payload: JSON.parse(value),
      };
    } catch {
      return {
        ok: false,
        reason: 'Malformed JSON',
      };
    }
  }

  #validateTimestamp(value) {
    return isNonEmptyString(value) && !Number.isNaN(new Date(value).getTime());
  }

  #validateTreasuryMessage(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Message payload must be an object';
    }

    if (!isNonEmptyString(payload.messageId)) {
      return 'messageId is required';
    }

    if (payload.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      return 'schemaVersion must be 1';
    }

    if (!Object.values(TreasuryKafkaEventType).includes(payload.eventType)) {
      return 'eventType is not supported';
    }

    if (!this.#validateTimestamp(payload.occurredAt)) {
      return 'occurredAt must be a valid timestamp';
    }

    if (!isNonEmptyString(payload.programId)) {
      return 'programId is required';
    }

    if (!isNonEmptyString(payload.invoiceId)) {
      return 'invoiceId is required';
    }

    if (payload.eventType === TreasuryKafkaEventType.ReservationApproved) {
      if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) {
        return 'amount must be positive';
      }

      if (!isNonEmptyString(payload.currency) || !CURRENCY_PATTERN.test(payload.currency)) {
        return 'currency must be an uppercase three-letter code';
      }
    }

    return null;
  }

  #buildMessageRecord({
    metadata,
    payload,
    status,
    failureReason = null,
  }) {
    const processedAt = toTimestamp(this.now());

    return {
      messageId: isNonEmptyString(payload?.messageId) ? payload.messageId : null,
      topic: metadata.topic,
      partition: metadata.partition,
      messageOffset: metadata.messageOffset,
      messageKey: metadata.messageKey,
      schemaVersion: Number.isInteger(payload?.schemaVersion) ? payload.schemaVersion : null,
      eventType: Object.values(TreasuryKafkaEventType).includes(payload?.eventType) ? payload.eventType : null,
      programId: isNonEmptyString(payload?.programId) ? payload.programId : null,
      invoiceId: isNonEmptyString(payload?.invoiceId) ? payload.invoiceId : null,
      status,
      failureReason,
      processedAt,
      createdAt: processedAt,
    };
  }
}

export const treasuryKafkaMessageHandler = new TreasuryKafkaMessageHandler();
