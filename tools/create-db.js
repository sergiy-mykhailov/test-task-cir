import Knex from 'knex';
import * as config from '../app/constants/env.js';
import knexfile from '../knexfile.js';

const start = async () => {
  const knex = Knex(knexfile.cli);

  await knex.raw(`CREATE DATABASE ${config.db.database};`);
};

start()
  .then(() => {
    console.log('Database successfully created!');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
