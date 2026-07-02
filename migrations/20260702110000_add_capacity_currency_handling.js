/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.raw(`
    create table fx_rates (
      id             bigserial primary key,
      base_currency  varchar(255) not null,
      quote_currency varchar(255) not null,
      rate           numeric not null,
      effective_at   timestamp not null,
      created_at     timestamp default now() not null,
      constraint fx_rates_pair_effective_unique unique (base_currency, quote_currency, effective_at)
    );
  `);

  await knex.raw(`
    alter table reservations
      add column invoice_amount numeric,
      add column invoice_currency varchar(255),
      add column fx_rate_id bigint references fx_rates on delete restrict;
  `);

  await knex.raw(`
    update reservations
      set invoice_amount = amount,
          invoice_currency = currency
      where invoice_amount is null
         or invoice_currency is null;
  `);

  await knex.raw(`
    alter table reservations
      alter column invoice_amount set not null,
      alter column invoice_currency set not null;
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.raw(`
    alter table reservations
      drop column if exists fx_rate_id,
      drop column if exists invoice_currency,
      drop column if exists invoice_amount;
  `);
  await knex.raw('drop table if exists fx_rates;');
};
