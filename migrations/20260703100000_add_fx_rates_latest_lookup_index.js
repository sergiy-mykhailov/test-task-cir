/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.raw(`
    create index if not exists fx_rates_latest_lookup_idx
      on fx_rates (base_currency, quote_currency, effective_at desc, id desc)
      include (rate, created_at);
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.raw('drop index if exists fx_rates_latest_lookup_idx;');
};
