import BaseModel from './base-model.js';
import {
  DECIMAL_STRING_MAX_LENGTH,
  DECIMAL_STRING_PATTERN,
  POSITIVE_DECIMAL_STRING_PATTERN,
  isDecimalGreaterThan,
} from '../utils/decimal.js';

export default class ProgramCapacityBalances extends BaseModel {
  static get tableName() {
    return 'program_capacity_balances';
  }

  static get idColumn() {
    return 'programId';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['programId', 'totalLimit', 'reservedAmount'],
      properties: {
        programId: { type: 'integer', minimum: 1 },
        totalLimit: {
          type: 'string',
          maxLength: DECIMAL_STRING_MAX_LENGTH,
          pattern: POSITIVE_DECIMAL_STRING_PATTERN.source,
        },
        reservedAmount: {
          type: 'string',
          maxLength: DECIMAL_STRING_MAX_LENGTH,
          pattern: DECIMAL_STRING_PATTERN.source,
        },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    };
  }

  $beforeInsert() {
    this.validateReservedAmount();
  }

  validateReservedAmount() {
    if (isDecimalGreaterThan(this.reservedAmount, this.totalLimit)) {
      throw new Error('Reserved amount cannot exceed total limit');
    }
  }
}
