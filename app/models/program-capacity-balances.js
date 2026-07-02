import BaseModel from './base-model.js';

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
        totalLimit: { type: 'number', minimum: 0 },
        reservedAmount: { type: 'number', minimum: 0 },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    };
  }

  $beforeInsert() {
    this.validateReservedAmount();
  }

  validateReservedAmount() {
    if (this.reservedAmount > this.totalLimit) {
      throw new Error('Reserved amount cannot exceed total limit');
    }
  }
}
