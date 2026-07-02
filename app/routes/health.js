import * as validator from '../validators/health.js';
import { HealthHandler } from '../handlers/health.js';

export default [
  {
    method: 'GET',
    path: '/health',
    options: {
      handler: HealthHandler.getStatus,
      description: 'Service and database health check',
      response: {
        failAction: 'log',
        status: {
          200: validator.getHealth.res,
        },
      },
    },
  },
];
