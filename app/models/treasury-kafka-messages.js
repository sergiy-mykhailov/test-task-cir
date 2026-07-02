import {
  TreasuryKafkaEventType,
  TreasuryKafkaMessageStatus,
} from '../constants/capacity.js';
import BaseModel from './base-model.js';

export default class TreasuryKafkaMessages extends BaseModel {
  static get tableName() {
    return 'treasury_kafka_messages';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['topic', 'partition', 'messageOffset', 'status', 'processedAt', 'createdAt'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        messageId: { type: ['string', 'null'], minLength: 1, maxLength: 255 },
        topic: { type: 'string', minLength: 1, maxLength: 255 },
        partition: { type: 'integer', minimum: 0 },
        messageOffset: { type: 'string', minLength: 1, maxLength: 255 },
        messageKey: { type: ['string', 'null'], minLength: 1, maxLength: 255 },
        schemaVersion: { type: ['integer', 'null'], minimum: 1 },
        eventType: { type: ['string', 'null'], enum: [...Object.values(TreasuryKafkaEventType), null] },
        programId: { type: ['string', 'null'], minLength: 1, maxLength: 255 },
        invoiceId: { type: ['string', 'null'], minLength: 1, maxLength: 255 },
        status: { type: 'string', enum: Object.values(TreasuryKafkaMessageStatus) },
        failureReason: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
        processedAt: { type: 'string', format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    };
  }
}
