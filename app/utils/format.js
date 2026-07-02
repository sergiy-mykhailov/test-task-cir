export const toAmount = (value) => Number(value);

export const toTimestamp = (value) => {
  if (!value) {
    return value;
  }

  return value instanceof Date ? value.toISOString() : value;
};
