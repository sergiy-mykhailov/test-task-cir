import Hapi from '@hapi/hapi';
import { ReservationStatus } from '../constants/capacity.js';
import auth from '../plugins/auth.js';
import errorHandler from '../plugins/error-handler.js';
import {
  findBalance,
  findProgram,
  setupIntegrationDatabase,
} from '../test/integration-db.js';
import { failAction } from '../utils/validation.js';
import capacityRoutes from './capacity.js';

const API_TOKEN = 'cir-api-integration-token';
const AUTHORIZATION_HEADER = {
  authorization: `Bearer ${API_TOKEN}`,
};
const PROGRAM_ID = 'api-flow-program';

const setApiToken = () => {
  const previousApiToken = process.env.API_TOKEN;

  process.env.API_TOKEN = API_TOKEN;

  return () => {
    if (previousApiToken === undefined) {
      delete process.env.API_TOKEN;
    } else {
      process.env.API_TOKEN = previousApiToken;
    }
  };
};

const createServer = async () => {
  const restoreApiToken = setApiToken();
  const server = Hapi.server({
    routes: {
      validate: {
        failAction,
      },
    },
  });

  try {
    await server.register([auth, errorHandler]);
    server.route(capacityRoutes);

    return server;
  } finally {
    restoreApiToken();
  }
};

const injectAuthenticated = (server, options) =>
  server.inject({
    ...options,
    headers: {
      ...AUTHORIZATION_HEADER,
      ...options.headers,
    },
  });

setupIntegrationDatabase();

describe('Capacity API integration', () => {
  test('serves authenticated cross-currency reservation, capacity, and release flow', async () => {
    const server = await createServer();

    try {
      const createProgramResponse = await injectAuthenticated(server, {
        method: 'POST',
        url: '/programs',
        payload: {
          externalId: PROGRAM_ID,
          currency: 'USD',
          totalLimit: 1000,
        },
      });

      expect(createProgramResponse.statusCode).toBe(201);
      expect(createProgramResponse.result.capacity).toMatchObject({
        programId: PROGRAM_ID,
        currency: 'USD',
        totalLimit: 1000,
        reservedAmount: 0,
        availableAmount: 1000,
      });

      const createFxRateResponse = await injectAuthenticated(server, {
        method: 'POST',
        url: '/fx-rates',
        payload: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: 1.2,
          effectiveAt: '2026-07-02T11:00:00.000Z',
        },
      });

      expect(createFxRateResponse.statusCode).toBe(201);

      const reserveResponse = await injectAuthenticated(server, {
        method: 'POST',
        url: `/programs/${PROGRAM_ID}/reservations`,
        payload: {
          invoiceId: 'api-flow-invoice',
          amount: 125,
          currency: 'EUR',
        },
      });

      expect(reserveResponse.statusCode).toBe(201);
      expect(reserveResponse.result).toMatchObject({
        reservation: {
          programId: PROGRAM_ID,
          invoiceId: 'api-flow-invoice',
          invoiceAmount: 125,
          invoiceCurrency: 'EUR',
          amount: 150,
          currency: 'USD',
          fxRateId: createFxRateResponse.result.id,
          status: ReservationStatus.Reserved,
          releasedAmount: 0,
        },
        capacity: {
          programId: PROGRAM_ID,
          currency: 'USD',
          totalLimit: 1000,
          reservedAmount: 150,
          availableAmount: 850,
        },
      });

      const reservedCapacityResponse = await injectAuthenticated(server, {
        method: 'GET',
        url: `/programs/${PROGRAM_ID}/capacity`,
      });

      expect(reservedCapacityResponse.statusCode).toBe(200);
      expect(reservedCapacityResponse.result).toMatchObject({
        programId: PROGRAM_ID,
        currency: 'USD',
        totalLimit: 1000,
        reservedAmount: 150,
        availableAmount: 850,
      });

      const releaseResponse = await injectAuthenticated(server, {
        method: 'POST',
        url: `/programs/${PROGRAM_ID}/invoices/api-flow-invoice/release`,
      });

      expect(releaseResponse.statusCode).toBe(200);
      expect(releaseResponse.result).toMatchObject({
        reservation: {
          programId: PROGRAM_ID,
          invoiceId: 'api-flow-invoice',
          invoiceAmount: 125,
          invoiceCurrency: 'EUR',
          amount: 150,
          currency: 'USD',
          fxRateId: createFxRateResponse.result.id,
          status: ReservationStatus.Released,
          releasedAmount: 150,
        },
        capacity: {
          programId: PROGRAM_ID,
          currency: 'USD',
          totalLimit: 1000,
          reservedAmount: 0,
          availableAmount: 1000,
        },
      });

      const program = await findProgram(PROGRAM_ID);
      const balance = await findBalance(program.id);

      expect(balance).toMatchObject({
        totalLimit: 1000,
        reservedAmount: 0,
      });
    } finally {
      await server.stop();
    }
  });
});
