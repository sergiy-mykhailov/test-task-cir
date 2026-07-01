import { createBoomError } from '../utils/errors.js';

const register = async (server) => {
  server.ext('onPreResponse', (request, h) => {
    const response = request.response;

    const boomError = createBoomError(response);
    if (boomError) {
      return boomError;
    }

    return h.continue;
  });
};

export default {
  name: 'error-handler',
  version: '0.0.1',
  register,
};