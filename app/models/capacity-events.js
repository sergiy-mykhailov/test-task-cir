import { CapacityEventSource, CapacityEventType } from '../constants/capacity.js';
import {
  DECIMAL_STRING_MAX_LENGTH,
  DECIMAL_STRING_PATTERN,
} from '../utils/decimal.js';
import BaseModel from './base-model.js';

export default class CapacityEvents extends BaseModel {
  static get tableName() {
    return 'capacity_events';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['programId', 'eventType', 'source', 'amount', 'currency'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        programId: { type: 'integer', minimum: 1 },
        reservationId: { type: ['integer', 'null'], minimum: 1 },
        eventType: { type: 'string', enum: Object.values(CapacityEventType) },
        source: { type: 'string', enum: Object.values(CapacityEventSource) },
        invoiceId: { type: ['string', 'null'], minLength: 1, maxLength: 255 },
        amount: {
          type: 'string',
          maxLength: DECIMAL_STRING_MAX_LENGTH,
          pattern: DECIMAL_STRING_PATTERN.source,
        },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        occurredAt: { type: 'string', format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    };
  }
}
