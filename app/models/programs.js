import BaseModel from './base-model.js';

export default class Programs extends BaseModel {
  static get tableName() {
    return 'programs';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['externalId', 'currency'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        externalId: { type: 'string', minLength: 1, maxLength: 255 },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    };
  }
}
