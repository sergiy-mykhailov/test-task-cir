import Knex from 'knex';
import * as config from '../app/constants/env.js';
import knexfile from '../knexfile.js';

const start = async () => {
  const knex = Knex(knexfile.cli);

  try {
    const existingDatabase = await knex('pg_database')
      .select('datname')
      .where({ datname: config.db.database })
      .first();

    if (existingDatabase) {
      return `Database ${config.db.database} already exists.`;
    }

    await knex.raw('CREATE DATABASE ??', [config.db.database]);
    return `Database ${config.db.database} successfully created.`;
  } finally {
    await knex.destroy();
  }
};

start()
  .then((message) => {
    console.log(message);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
