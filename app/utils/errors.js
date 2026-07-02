import { Boom, boomify } from '@hapi/boom';
import { DBError, ValidationError } from 'objection';
import lodash from 'lodash';
import { HttpStatusCode } from '../constants/http.js';

const { get } = lodash;

const DEFAULT_STATUS =  HttpStatusCode.InternalServerError;
const DEFAULT_MESSAGE = 'Something went wrong :(';
const DEFAULT_ERROR_NAME = 'Error';

const dbErrorNameToStatusCode = {
  DBError: HttpStatusCode.InternalServerError,
  CheckViolationError: HttpStatusCode.UnprocessableEntity,
  ConstraintViolationError: HttpStatusCode.UnprocessableEntity,
  DataError: HttpStatusCode.UnprocessableEntity,
  ForeignKeyViolationError: HttpStatusCode.UnprocessableEntity,
  NotNullViolationError: HttpStatusCode.UnprocessableEntity,
  UniqueViolationError: HttpStatusCode.Conflict,
};

const reformatError = (
  error,
  statusCode = DEFAULT_STATUS,
  message = DEFAULT_MESSAGE,
  errorName = DEFAULT_ERROR_NAME,
  data,
) => {
  if (error.isBoom) {
    error.output.statusCode = statusCode;
    error.reformat();
    error.output.payload.statusCode = statusCode;
    error.output.payload.error = errorName;
    error.output.payload.message = message;
    if (data) {
      error.output.payload.data = data;
    }

    return error;
  }

  return boomify(error, { statusCode, message, error: errorName, data });
};

const reformatDBError = (error) => {
  const errorName = get(error, 'name', 'DBError');
  const statusCode = get(dbErrorNameToStatusCode, errorName, HttpStatusCode.InternalServerError);
  const message = get(error, 'nativeError.detail') || get(error, 'message');

  return reformatError(error, statusCode, message, errorName);
};

const reformatValidationError = (error) => {
  const errorName = get(error, 'name', 'ValidationError');
  const statusCode = get(error, 'statusCode', HttpStatusCode.InternalServerError);
  const message = get(error, 'message');
  const data = get(error, 'data');

  return reformatError(error, statusCode, message, errorName, data);
};

const reformatPlainError = (error) => {
  const errorName = get(error, 'name');
  const errorNamePayload = get(error, 'output.payload.error');
  const statusCode = get(error, 'statusCode');
  const statusCodeOutput = get(error, 'output.statusCode');
  const statusCodePayload = get(error, 'output.payload.statusCode');
  const message = get(error, 'message');
  const messagePayload = get(error, 'output.payload.message');
  const data = get(error, 'data');

  return reformatError(
    error,
    statusCode || statusCodeOutput || statusCodePayload,
    message || messagePayload,
    errorName || errorNamePayload,
    data,
  );
};

export const createBoomError = (error) => {

  if (error instanceof DBError) {
    return reformatDBError(error);
  }

  if (error instanceof ValidationError) {
    return reformatValidationError(error);
  }

  if (error instanceof Error) {
    return reformatPlainError(error);
  }

  return null;
};

export const throwError = (message, statusCode, data) => {
  throw new Boom(message, { statusCode, data });
};

export const createErrorResponse = (error) => {
  const boomError = createBoomError(error);
  if (boomError) {
    return boomError;
  }

  if (!error.isBoom) {
    return boomify(error);
  }

  return null;
};
