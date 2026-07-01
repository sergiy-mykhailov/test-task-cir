import Knex from 'knex';
import { Model } from 'objection';
import knexConfig from '../../knexfile.js';
import { isProd } from '../constants/env.js';
import { initPG } from '../utils/pg.js';

const register = async (server) => {
  initPG();

  const config = isProd ? knexConfig.production : knexConfig.development;

  const knex = Knex(config);

  Model.knex(knex);

  server.app.knex = knex;

  server.logger.info(`[database] Database connection created: ${config.connection.host}:${config.connection.port}`);
};

export default {
  name: 'database',
  version: '0.0.1',
  register,
};
