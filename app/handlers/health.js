import DefaultHandler from './default.js';

export class HealthHandler extends DefaultHandler {
  static async getStatus(request, h) {
    return HealthHandler.withErrorHandler(request, h, async () => {
      await request.server.app.knex.raw('select 1');

      return {
        status: 'ok',
        database: 'ok',
      };
    });
  }
}
