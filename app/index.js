import { start } from './server.js';
import { logger } from './utils/logger.js';

process.on('unhandledRejection', (error, promise) => {
  logger.error({ error, promise, stack: error.stack }, 'Unhandled rejection :(');
});

process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught exception :(');
});

start();
