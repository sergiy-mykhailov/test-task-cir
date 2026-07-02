import { ReservationStatus } from '../constants/capacity.js';
import BaseModel from './base-model.js';

export default class Reservations extends BaseModel {
  static get tableName() {
    return 'reservations';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['programId', 'invoiceId', 'invoiceAmount', 'invoiceCurrency', 'amount', 'currency', 'status'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        programId: { type: 'integer', minimum: 1 },
        invoiceId: { type: 'string', minLength: 1, maxLength: 255 },
        invoiceAmount: { type: 'number', exclusiveMinimum: 0 },
        invoiceCurrency: { type: 'string', minLength: 3, maxLength: 3 },
        amount: { type: 'number', exclusiveMinimum: 0 },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        fxRateId: { type: ['integer', 'null'], minimum: 1 },
        status: { type: 'string', enum: Object.values(ReservationStatus) },
        releasedAmount: { type: 'number', minimum: 0 },
        reservedAt: { type: 'string', format: 'date-time' },
        releasedAt: { type: ['string', 'null'], format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    };
  }
}
