import Hapi from '@hapi/hapi';
import { CapacityEventType, ReservationStatus } from '../constants/capacity.js';
import auth from '../plugins/auth.js';
import errorHandler from '../plugins/error-handler.js';
import {
  countEvents,
  findBalance,
  findProgram,
  findReservations,
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
  server.decorate('server', 'logger', { error() {} });

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
          totalLimit: '1000',
        },
      });

      expect(createProgramResponse.statusCode).toBe(201);
      expect(createProgramResponse.result.capacity).toMatchObject({
        programId: PROGRAM_ID,
        currency: 'USD',
        totalLimit: '1000',
        reservedAmount: '0',
        availableAmount: '1000',
      });

      const createFxRateResponse = await injectAuthenticated(server, {
        method: 'POST',
        url: '/fx-rates',
        payload: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: '1',
          effectiveAt: '2026-07-02T11:00:00.000Z',
        },
      });

      expect(createFxRateResponse.statusCode).toBe(201);
      expect(createFxRateResponse.result).toMatchObject({ rate: '1' });

      const reserveResponse = await injectAuthenticated(server, {
        method: 'POST',
        url: `/programs/${PROGRAM_ID}/reservations`,
        payload: {
          invoiceId: 'api-flow-invoice',
          amount: '10.075',
          currency: 'EUR',
        },
      });

      expect(reserveResponse.statusCode).toBe(201);
      expect(reserveResponse.result).toMatchObject({
        reservation: {
          programId: PROGRAM_ID,
          invoiceId: 'api-flow-invoice',
          invoiceAmount: '10.075',
          invoiceCurrency: 'EUR',
          amount: '10.08',
          currency: 'USD',
          fxRateId: createFxRateResponse.result.id,
          status: ReservationStatus.Reserved,
          releasedAmount: '0',
        },
        capacity: {
          programId: PROGRAM_ID,
          currency: 'USD',
          totalLimit: '1000',
          reservedAmount: '10.08',
          availableAmount: '989.92',
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
        totalLimit: '1000',
        reservedAmount: '10.08',
        availableAmount: '989.92',
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
          invoiceAmount: '10.075',
          invoiceCurrency: 'EUR',
          amount: '10.08',
          currency: 'USD',
          fxRateId: createFxRateResponse.result.id,
          status: ReservationStatus.Released,
          releasedAmount: '10.08',
        },
        capacity: {
          programId: PROGRAM_ID,
          currency: 'USD',
          totalLimit: '1000',
          reservedAmount: '0',
          availableAmount: '1000',
        },
      });

      const program = await findProgram(PROGRAM_ID);
      const balance = await findBalance(program.id);

      expect(balance).toMatchObject({
        totalLimit: '1000',
        reservedAmount: '0',
      });
    } finally {
      await server.stop();
    }
  });

  test('rejects JSON numeric monetary values', async () => {
    const server = await createServer();

    try {
      const requests = [
        {
          method: 'POST',
          url: '/programs',
          payload: {
            externalId: 'api-numeric-money-program',
            currency: 'USD',
            totalLimit: 1000,
          },
        },
        {
          method: 'POST',
          url: '/fx-rates',
          payload: {
            baseCurrency: 'EUR',
            quoteCurrency: 'USD',
            rate: 1.2,
            effectiveAt: '2026-07-02T11:00:00.000Z',
          },
        },
        {
          method: 'POST',
          url: '/programs/missing-program/reservations',
          payload: {
            invoiceId: 'api-numeric-money-invoice',
            amount: 10.075,
            currency: 'EUR',
          },
        },
      ];

      for (const options of requests) {
        const response = await injectAuthenticated(server, options);

        expect(response.statusCode).toBe(400);
      }
      expect(await findProgram('api-numeric-money-program')).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  test('returns 422 for zero-after-conversion without database side effects', async () => {
    const server = await createServer();
    const programId = 'api-zero-after-conversion-program';

    try {
      await injectAuthenticated(server, {
        method: 'POST',
        url: '/programs',
        payload: {
          externalId: programId,
          currency: 'USD',
          totalLimit: '1',
        },
      });
      await injectAuthenticated(server, {
        method: 'POST',
        url: '/fx-rates',
        payload: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: '1',
          effectiveAt: '2026-07-02T11:00:00.000Z',
        },
      });

      const response = await injectAuthenticated(server, {
        method: 'POST',
        url: `/programs/${programId}/reservations`,
        payload: {
          invoiceId: 'api-zero-after-conversion-invoice',
          amount: '0.0049',
          currency: 'EUR',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.result).toMatchObject({
        statusCode: 422,
        message: 'Converted reservation amount rounds to zero',
        data: {
          invoiceAmount: '0.0049',
          invoiceCurrency: 'EUR',
          convertedAmount: '0',
          currency: 'USD',
        },
      });

      const program = await findProgram(programId);
      expect(await findBalance(program.id)).toMatchObject({ totalLimit: '1', reservedAmount: '0' });
      expect(await findReservations(program.id)).toHaveLength(0);
      expect(await countEvents(program.id, CapacityEventType.ReservationCreated)).toBe(0);
    } finally {
      await server.stop();
    }
  });
});
