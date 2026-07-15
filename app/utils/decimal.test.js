import {
  Decimal,
  addDecimals,
  isDecimalGreaterThan,
  isDecimalString,
  isPositiveDecimalString,
  multiplyDecimals,
  parseDecimal,
  roundMoney,
  serializeDecimal,
  subtractDecimals,
} from './decimal.js';

describe('decimal utilities', () => {
  test('accept exact decimal strings and reject JavaScript numbers', () => {
    expect(Decimal.strict).toBe(true);
    expect(isDecimalString('10000000.01')).toBe(true);
    expect(isDecimalString('01.25')).toBe(false);
    expect(() => parseDecimal(0.1)).toThrow('valid decimal string');
  });

  test('enforces decimal syntax and the 64-character boundary', () => {
    expect(isDecimalString('1'.repeat(64))).toBe(true);
    expect(isDecimalString('1'.repeat(65))).toBe(false);

    for (const invalidValue of ['-1', '+1', '1e3', ' 1', '1 ', '01', '1,000']) {
      expect(isDecimalString(invalidValue)).toBe(false);
    }
  });

  test('rejects zero in positive-only decimal fields', () => {
    for (const zeroValue of ['0', '0.0', '0.000']) {
      expect(isPositiveDecimalString(zeroValue)).toBe(false);
    }
    expect(isPositiveDecimalString('0.0001')).toBe(true);
  });

  test('perform exact arithmetic and serialize without exponent notation', () => {
    const reserved = addDecimals('0.1', '0.2');
    const available = subtractDecimals('10000000.01', reserved);

    expect(serializeDecimal(reserved)).toBe('0.3');
    expect(serializeDecimal(available)).toBe('9999999.71');
    expect(serializeDecimal(parseDecimal('1000000000000000000000')))
      .toBe('1000000000000000000000');
    expect(isDecimalGreaterThan('0.3000000000000000001', reserved)).toBe(true);
  });

  test('round cross-currency products half up to two decimal places', () => {
    expect(serializeDecimal(roundMoney(multiplyDecimals('0.0049', '1')))).toBe('0');
    expect(serializeDecimal(roundMoney(multiplyDecimals('0.005', '1')))).toBe('0.01');
    expect(serializeDecimal(roundMoney(multiplyDecimals('10.075', '1')))).toBe('10.08');
  });
});
