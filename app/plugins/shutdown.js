import { timeout } from '../utils/common.js';

const register = async (server) => {
  let shutdownEventTriggered = false;

  const onShutdown = async (server, signal = 'unknown') => {
    if (shutdownEventTriggered) {
      return;
    }
    shutdownEventTriggered = true;

    server.logger.info(`[shutdown] Signal ${signal} received.`);

    try {
      server.logger.info('[shutdown] Stopping server...');
      await server.stop({ timeout: 20000 });

      server.logger.info('[shutdown] Server stopped accepting new connections');

      if (server.app.knex) {
        server.logger.info('[shutdown] Closing database connections...');
        await server.app.knex.destroy();
      }

      server.logger.info('[shutdown] Server stopped gracefully (:');
      await timeout(200);
      process.exit(0);
    } catch (err) {
      server.logger.error(err, '[shutdown] Error during shutdown:');
      await timeout(200);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => onShutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => onShutdown(server, 'SIGTERM'));

  server.logger.info('[shutdown] Plugin registered');
};

export default {
  name: 'shutdown',
  version: '0.0.1',
  register,
};
