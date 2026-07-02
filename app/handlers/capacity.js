import DefaultHandler from './default.js';
import { capacityService } from '../services/capacity.js';

export class CapacityHandler extends DefaultHandler {
  static async createProgram(request, h) {
    return CapacityHandler.withErrorHandler(request, h, async () => {
      const response = await capacityService.createProgram(request.payload);

      return h.response(response).code(201);
    });
  }

  static async createFxRate(request, h) {
    return CapacityHandler.withErrorHandler(request, h, async () => {
      const response = await capacityService.createFxRate(request.payload);

      return h.response(response).code(201);
    });
  }

  static async getCapacity(request, h) {
    return CapacityHandler.withErrorHandler(request, h, async () =>
      capacityService.getCapacity(request.params.programId));
  }

  static async createReservation(request, h) {
    return CapacityHandler.withErrorHandler(request, h, async () => {
      const response = await capacityService.createReservation(request.params.programId, request.payload);

      return h.response(response).code(201);
    });
  }

  static async releaseReservation(request, h) {
    return CapacityHandler.withErrorHandler(request, h, async () =>
      capacityService.releaseReservation(request.params.programId, request.params.invoiceId));
  }
}
