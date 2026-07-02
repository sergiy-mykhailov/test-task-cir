/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.raw(`
    alter type capacity_event_types
      add value if not exists 'RECONCILIATION_APPLIED';
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.raw(`
    delete from capacity_events
      where event_type = 'RECONCILIATION_APPLIED';
  `);
  await knex.raw(`
    alter type capacity_event_types rename to capacity_event_types_old;
  `);
  await knex.raw(`
    create type capacity_event_types as enum (
      'PROGRAM_CREATED',
      'RESERVATION_CREATED',
      'RESERVATION_RELEASED'
    );
  `);
  await knex.raw(`
    alter table capacity_events
      alter column event_type type capacity_event_types
      using event_type::text::capacity_event_types;
  `);
  await knex.raw('drop type capacity_event_types_old;');
};
