import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('sessions', (table) => {
    // A hash of the device's token: a copy of the database alone cannot be used to sign in.
    table.text('token_hash').notNullable().primary();
    table
      .text('archer_licence_number')
      .notNullable()
      .references('licence_number')
      .inTable('archers')
      .onDelete('CASCADE');
    table.text('expires_at').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('sessions');
}
