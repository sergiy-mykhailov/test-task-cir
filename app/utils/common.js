// Shared low-level helpers for runtime parsing, value normalization, and async timing.
export const timeout = (duration = 1001) => new Promise((res) => setTimeout(() => res(true), duration));

export const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue;
  }

  return value === 'true';
};

export const parseList = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const toTimestamp = (value) => {
  if (!value) {
    return value;
  }

  return value instanceof Date ? value.toISOString() : value;
};

export const bufferToString = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
};

export const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;
