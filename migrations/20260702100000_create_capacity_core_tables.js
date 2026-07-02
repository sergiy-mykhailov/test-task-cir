/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.raw(`
    create type reservation_statuses as enum ('RESERVED', 'RELEASED');
  `);
  await knex.raw(`
    create type capacity_event_types as enum (
      'PROGRAM_CREATED',
      'RESERVATION_CREATED',
      'RESERVATION_RELEASED'
    );
  `);
  await knex.raw(`
    create type capacity_event_sources as enum (
      'API',
      'KAFKA_TREASURY',
      'RECONCILIATION'
    );
  `);

  await knex.raw(`
    create table programs (
      id          bigserial primary key,
      external_id varchar(255) not null unique,
      currency    varchar(255) not null,
      created_at  timestamp default now() not null,
      updated_at  timestamp default now() not null
    );
  `);

  await knex.raw(`
    create table program_capacity_balances (
      program_id      bigint primary key references programs on delete cascade,
      total_limit     numeric not null,
      reserved_amount numeric default 0 not null,
      updated_at      timestamp default now() not null
    );
  `);

  await knex.raw(`
    create table reservations (
      id              bigserial primary key,
      program_id      bigint not null references programs on delete cascade,
      invoice_id      varchar(255) not null,
      amount          numeric not null,
      currency        varchar(255) not null,
      status          reservation_statuses not null,
      released_amount numeric default 0 not null,
      reserved_at     timestamp default now() not null,
      released_at     timestamp,
      created_at      timestamp default now() not null,
      updated_at      timestamp default now() not null,
      constraint reservations_program_invoice_unique unique (program_id, invoice_id)
    );
  `);

  await knex.raw(`
    create table capacity_events (
      id             bigserial primary key,
      program_id     bigint not null references programs on delete cascade,
      reservation_id bigint references reservations on delete set null,
      event_type     capacity_event_types not null,
      source         capacity_event_sources not null,
      invoice_id     varchar(255),
      amount         numeric not null,
      currency       varchar(255) not null,
      occurred_at    timestamp default now() not null,
      created_at     timestamp default now() not null
    );
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.raw('drop table if exists capacity_events;');
  await knex.raw('drop table if exists reservations;');
  await knex.raw('drop table if exists program_capacity_balances;');
  await knex.raw('drop table if exists programs;');
  await knex.raw('drop type if exists capacity_event_sources;');
  await knex.raw('drop type if exists capacity_event_types;');
  await knex.raw('drop type if exists reservation_statuses;');
};
