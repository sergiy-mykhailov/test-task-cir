/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.raw(`
    create type treasury_kafka_message_statuses as enum (
      'PROCESSED',
      'REJECTED'
    );
  `);

  await knex.raw(`
    create table treasury_kafka_messages (
      id              bigserial primary key,
      message_id      varchar(255),
      topic           varchar(255) not null,
      partition       integer not null,
      message_offset  varchar(255) not null,
      message_key     varchar(255),
      schema_version  integer,
      event_type      varchar(255),
      program_id      varchar(255),
      invoice_id      varchar(255),
      status          treasury_kafka_message_statuses not null,
      failure_reason  varchar(500),
      processed_at    timestamp default now() not null,
      created_at      timestamp default now() not null,
      constraint treasury_kafka_messages_message_id_unique unique (message_id),
      constraint treasury_kafka_messages_broker_offset_unique unique (topic, partition, message_offset)
    );
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.raw('drop table if exists treasury_kafka_messages;');
  await knex.raw('drop type if exists treasury_kafka_message_statuses;');
};
