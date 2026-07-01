import { createErrorResponse } from '../utils/errors.js';

export default class DefaultHandler {
  static async withErrorHandler(request, h, callback) {
    try {
      return await callback(request, h);
    } catch (e) {
      return createErrorResponse(e);
    }
  }
}
