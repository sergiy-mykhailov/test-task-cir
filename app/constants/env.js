export const NODE_ENV_PRODUCTION = 'production';

export const isProd = process.env.NODE_ENV === NODE_ENV_PRODUCTION;

export const app = { isProd };

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
