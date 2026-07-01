
export const failAction = async (request, h, err) => {
  if (err) {
    request.server.logger.error({
      id: request.info.id,
      method: request.method,
      path: request.path,
      details: err.details,
    }, 'Validation error');

    return h.response({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
    }).code(400).takeover();
  }

  return h.continue;
};
