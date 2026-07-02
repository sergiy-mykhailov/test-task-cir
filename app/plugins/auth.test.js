import Hapi from '@hapi/hapi';
import { jest } from '@jest/globals';
import auth, {
  AUTH_CREDENTIALS,
  AUTH_STRATEGY_NAME,
} from './auth.js';
import errorHandler from './error-handler.js';
import capacityRoutes from '../routes/capacity.js';
import healthRoutes from '../routes/health.js';

const TEST_API_TOKEN = 'test-api-token';
const AUTHENTICATION_REQUIRED_PAYLOAD = {
  statusCode: 401,
  error: 'Unauthorized',
  message: 'Authentication required',
};
const BUSINESS_ROUTES = [
  { method: 'POST', url: '/programs', path: '/programs' },
  { method: 'POST', url: '/fx-rates', path: '/fx-rates' },
  { method: 'GET', url: '/programs/program-1/capacity', path: '/programs/{programId}/capacity' },
  { method: 'POST', url: '/programs/program-1/reservations', path: '/programs/{programId}/reservations' },
  {
    method: 'POST',
    url: '/programs/program-1/invoices/invoice-1/release',
    path: '/programs/{programId}/invoices/{invoiceId}/release',
  },
];

const setApiToken = (value) => {
  const previousApiToken = process.env.API_TOKEN;

  process.env.API_TOKEN = value;

  return () => {
    if (previousApiToken === undefined) {
      delete process.env.API_TOKEN;
    } else {
      process.env.API_TOKEN = previousApiToken;
    }
  };
};

const createServer = async (routes) => {
  const restoreApiToken = setApiToken(TEST_API_TOKEN);
  const server = Hapi.server();

  try {
    await server.register([auth, errorHandler]);
    server.route(routes);

    return server;
  } finally {
    restoreApiToken();
  }
};

const expectUnauthorized = (response) => {
  expect(response.statusCode).toBe(401);
  expect(response.result).toEqual(AUTHENTICATION_REQUIRED_PAYLOAD);
  expect(response.headers['www-authenticate']).toBe('Bearer');
};

describe('auth plugin', () => {
  test('fails registration when API_TOKEN is missing', async () => {
    const restoreApiToken = setApiToken('');
    const server = Hapi.server();

    try {
      await expect(server.register(auth)).rejects.toThrow('Missing API_TOKEN');
    } finally {
      restoreApiToken();
    }
  });

  test('rejects missing bearer token', async () => {
    const server = await createServer({
      method: 'GET',
      path: '/protected',
      handler: () => ({ ok: true }),
    });

    expectUnauthorized(await server.inject('/protected'));
  });

  test('rejects malformed Authorization header', async () => {
    const server = await createServer({
      method: 'GET',
      path: '/protected',
      handler: () => ({ ok: true }),
    });

    expectUnauthorized(await server.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: `Basic ${TEST_API_TOKEN}`,
      },
    }));
  });

  test('rejects invalid bearer token', async () => {
    const server = await createServer({
      method: 'GET',
      path: '/protected',
      handler: () => ({ ok: true }),
    });

    expectUnauthorized(await server.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: 'Bearer wrong-token',
      },
    }));
  });

  test('allows protected route execution with a valid bearer token', async () => {
    const server = await createServer({
      method: 'GET',
      path: '/protected',
      handler: (request) => ({
        ok: true,
        credentials: request.auth.credentials,
      }),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: `Bearer ${TEST_API_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({
      ok: true,
      credentials: AUTH_CREDENTIALS,
    });
  });

  test('leaves GET /health unauthenticated', async () => {
    const server = await createServer(healthRoutes);

    server.app.knex = {
      raw: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    };

    const response = await server.inject('/health');

    expect(response.statusCode).toBe(200);
    expect(response.result).toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  test('protects every current business route with the default api-token strategy', async () => {
    const server = await createServer([...capacityRoutes, ...healthRoutes]);
    const routeTable = server.table();
    const healthRoute = routeTable.find((item) =>
      item.method === 'get'
      && item.path === '/health');

    expect(server.auth.settings.default.strategies).toEqual([AUTH_STRATEGY_NAME]);
    expect(healthRoute.settings.auth).toBe(false);
    for (const routeSpec of BUSINESS_ROUTES) {
      expect(routeTable.find((item) =>
        item.method === routeSpec.method.toLowerCase()
        && item.path === routeSpec.path)).toBeDefined();
      expectUnauthorized(await server.inject({
        method: routeSpec.method,
        url: routeSpec.url,
      }));
    }
  });
});
