import { knexSnakeCaseMappers } from 'objection';
import * as config from './app/constants/env.js';

export default {
  development: {
    client: 'postgresql',
    useNullAsDefault: true,
    connection: {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
    pool: {
      min: 1,
      max: 20,
      acquireTimeoutMillis: 10000,
      idleTimeoutMillis: 60000,
      createTimeoutMillis: 5000,
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 10000,
      createRetryIntervalMillis: 50,
      propagateCreateError: false,
    },
    migrations: {
      tableName: 'migrations',
    },
    seeds: {
      directory: './seeds',
    },
    ...knexSnakeCaseMappers(),
  },
  production: {
    client: 'postgresql',
    useNullAsDefault: true,
    connection: {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
    pool: {
      min: 1,
      max: 20,
      acquireTimeoutMillis: 10000,
      idleTimeoutMillis: 60000,
      createTimeoutMillis: 5000,
      destroyTimeoutMillis: 5000,
      reapIntervalMillis: 10000,
      createRetryIntervalMillis: 50,
      propagateCreateError: false,
    },
    migrations: {
      tableName: 'migrations',
    },
    seeds: {
      directory: './seeds',
    },
    ...knexSnakeCaseMappers(),
  },
  cli: {
    client: 'postgresql',
    connection: {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
    },
    migrations: {
      tableName: 'migrations',
    },
    seeds: {
      directory: './seeds',
    },
  },
};
