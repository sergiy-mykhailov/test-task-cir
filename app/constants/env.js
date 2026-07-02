import {
  parseBoolean,
  parseList,
} from '../utils/common.js';

export const NODE_ENV_PRODUCTION = 'production';

export const isProd = process.env.NODE_ENV === NODE_ENV_PRODUCTION;

export const app = {
  isProd,
  get apiToken() {
    return process.env.API_TOKEN;
  },
};

export const service = {
  host: process.env.SERVICE_HOST,
  port: process.env.SERVICE_PORT,
};

export const db = {
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
};

export const kafka = {
  get enabled() {
    return parseBoolean(process.env.KAFKA_ENABLED);
  },
  get brokers() {
    return parseList(process.env.KAFKA_BROKERS);
  },
  get clientId() {
    return process.env.KAFKA_CLIENT_ID || 'cir-service';
  },
  get consumerGroupId() {
    return process.env.KAFKA_CONSUMER_GROUP_ID || 'cir-service-treasury';
  },
  get treasuryEventsTopic() {
    return process.env.KAFKA_TREASURY_EVENTS_TOPIC || 'treasury.capacity.events';
  },
  get fromBeginning() {
    return parseBoolean(process.env.KAFKA_FROM_BEGINNING);
  },
};
