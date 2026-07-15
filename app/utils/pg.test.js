import pg from 'pg';
import { initPG } from './pg.js';

describe('PostgreSQL type parsers', () => {
  test('keeps NUMERIC values as strings while parsing integer identifiers', () => {
    initPG();

    expect(pg.types.getTypeParser(pg.types.builtins.NUMERIC)('10.075')).toBe('10.075');
    expect(pg.types.getTypeParser(pg.types.builtins.INT2)('2')).toBe(2);
    expect(pg.types.getTypeParser(pg.types.builtins.INT4)('4')).toBe(4);
    expect(pg.types.getTypeParser(pg.types.builtins.INT8)('8')).toBe(8);
  });
});
