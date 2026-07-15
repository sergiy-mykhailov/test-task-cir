import pg from 'pg';

export const initPG = () => {
  // node-postgres keeps NUMERIC as text by default; only non-monetary integer types are coerced.
  pg.types.setTypeParser(pg.types.builtins.INT2, Number);
  pg.types.setTypeParser(pg.types.builtins.INT4, Number);
  pg.types.setTypeParser(pg.types.builtins.INT8, Number);
};
