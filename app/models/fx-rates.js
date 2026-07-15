import BaseModel from './base-model.js';
import {
  DECIMAL_STRING_MAX_LENGTH,
  POSITIVE_DECIMAL_STRING_PATTERN,
} from '../utils/decimal.js';

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
        rate: {
          type: 'string',
          maxLength: DECIMAL_STRING_MAX_LENGTH,
          pattern: POSITIVE_DECIMAL_STRING_PATTERN.source,
        },
        effectiveAt: { type: 'string', format: 'date-time' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    };
  }
}
