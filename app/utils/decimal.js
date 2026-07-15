import BigJs from 'big.js';

export const DECIMAL_STRING_MAX_LENGTH = 64;
export const DECIMAL_STRING_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
export const POSITIVE_DECIMAL_STRING_PATTERN = /^(?=.*[1-9])(0|[1-9][0-9]*)(\.[0-9]+)?$/;

// Keep one strict constructor so monetary values cannot enter arithmetic as JavaScript numbers.
export const Decimal = BigJs();
Decimal.strict = true;

export const isDecimalString = (value) =>
  typeof value === 'string'
  && value.length <= DECIMAL_STRING_MAX_LENGTH
  && DECIMAL_STRING_PATTERN.test(value);

export const parseDecimal = (value) => {
  if (!isDecimalString(value)) {
    throw new TypeError('Value must be a valid decimal string');
  }

  return new Decimal(value);
};

const toDecimal = (value) => value instanceof Decimal ? value : parseDecimal(value);

export const isPositiveDecimalString = (value) =>
  isDecimalString(value) && toDecimal(value).gt(parseDecimal('0'));

export const addDecimals = (left, right) => toDecimal(left).plus(toDecimal(right));

export const subtractDecimals = (left, right) => toDecimal(left).minus(toDecimal(right));

export const multiplyDecimals = (left, right) => toDecimal(left).times(toDecimal(right));

export const isDecimalGreaterThan = (left, right) => toDecimal(left).gt(toDecimal(right));

export const roundMoney = (value) => toDecimal(value).round(2, Decimal.roundHalfUp);

// Unlike Big#toString, toFixed without a scale always emits plain notation.
export const serializeDecimal = (value) => toDecimal(value).toFixed();
