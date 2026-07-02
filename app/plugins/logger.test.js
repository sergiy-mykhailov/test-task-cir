import Hapi from '@hapi/hapi';
import logger from './logger.js';

const AUTHORIZATION_HEADER = 'Bearer test-secret-token';

const createLogCaptureStream = () => {
  const entries = [];

  return {
    entries,
    write: (line) => {
      entries.push(JSON.parse(line));
    },
  };
};

describe('logger plugin', () => {
  test('redacts authorization header from request logs', async () => {
    const stream = createLogCaptureStream();
    const server = Hapi.server();

    await server.register({
      plugin: logger.plugin,
      options: {
        ...logger.options,
        stream,
        transport: undefined,
      },
    });
    server.route({
      method: 'GET',
      path: '/protected',
      handler: () => ({ ok: true }),
    });

    await server.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: AUTHORIZATION_HEADER,
      },
    });

    expect(stream.entries.some((entry) =>
      entry.req?.headers?.authorization === '[Redacted]')).toBe(true);
    expect(JSON.stringify(stream.entries)).not.toContain(AUTHORIZATION_HEADER);
  });
});
