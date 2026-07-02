import { createHash, timingSafeEqual } from 'node:crypto';
import { unauthorized } from '@hapi/boom';
import { app } from '../constants/env.js';

export const AUTH_SCHEME_NAME = 'bearer-token';
export const AUTH_STRATEGY_NAME = 'api-token';
export const AUTH_CREDENTIALS = { tokenType: 'static-api-token' };

const AUTHENTICATION_REQUIRED_MESSAGE = 'Authentication required';

const createUnauthorizedError = () => {
  const error = unauthorized(AUTHENTICATION_REQUIRED_MESSAGE);

  error.name = 'Unauthorized';
  error.output.headers['WWW-Authenticate'] = 'Bearer';

  return error;
};

const createTokenDigest = (token) =>
  createHash('sha256').update(token).digest();

const parseBearerToken = (authorization) => {
  if (typeof authorization !== 'string') {
    return null;
  }

  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);

  return match ? match[1] : null;
};

const bearerTokenScheme = (server, { apiToken }) => {
  const apiTokenDigest = createTokenDigest(apiToken);

  return {
    authenticate: (request, h) => {
      const token = parseBearerToken(request.headers.authorization);

      if (!token || !timingSafeEqual(createTokenDigest(token), apiTokenDigest)) {
        throw createUnauthorizedError();
      }

      return h.authenticated({ credentials: { ...AUTH_CREDENTIALS } });
    },
  };
};

const getApiToken = () => {
  const apiToken = app.apiToken;

  if (!apiToken) {
    throw new Error('Missing API_TOKEN. Set API_TOKEN before registering authenticated routes.');
  }

  return apiToken;
};

const register = async (server) => {
  server.auth.scheme(AUTH_SCHEME_NAME, bearerTokenScheme);
  server.auth.strategy(AUTH_STRATEGY_NAME, AUTH_SCHEME_NAME, {
    apiToken: getApiToken(),
  });
  server.auth.default(AUTH_STRATEGY_NAME);
};

export default {
  name: 'auth',
  version: '0.0.1',
  register,
};
