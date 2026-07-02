import Hapi from '@hapi/hapi';
import inert from '@hapi/inert';
import { service } from './constants/env.js';
import { failAction } from './utils/validation.js';
import routes from './plugins/routes.js';
import logger from './plugins/logger.js';
import auth from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import database from './plugins/database.js';
import shutdown from './plugins/shutdown.js';

const options = {
  port: service.port,
  host: service.host,
  routes: {
    cors: true,
    validate: {
      failAction: failAction,
    },
  },
};

const plugins = [
  inert,
  logger,
  auth,
  routes,
  errorHandler,
  database,
  shutdown,
];

export const start = async () => {
  const server = Hapi.server(options);

  await server.register(plugins);
  await server.start();

  return server;
};
