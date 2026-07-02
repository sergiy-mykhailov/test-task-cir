import BaseModel from './base-model.js';

export default class FxRates extends BaseModel {
  static get tableName() {
    return 'fx_rates';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['baseCurrency', 'quoteCurrency', 'rate', 'effectiveAt'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        baseCurrency: { type: 'string', minLength: 3, maxLength: 3 },
        quoteCurrency: { type: 'string', minLength: 3, maxLength: 3 },
        rate: { type: 'number', exclusiveMinimum: 0 },
        effectiveAt: { type: 'string', format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    };
  }
}
