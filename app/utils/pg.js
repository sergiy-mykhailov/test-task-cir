import pg from 'pg';

export const initPG = () => {
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
  pg.types.setTypeParser(pg.types.builtins.INT2, Number);
  pg.types.setTypeParser(pg.types.builtins.INT4, Number);
  pg.types.setTypeParser(pg.types.builtins.INT8, Number);
};
