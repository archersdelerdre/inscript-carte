import type { Knex } from 'knex';

/** An admin made from the panel gets a generated password and must choose their own at first sign-in. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('admins', (table) => {
    table.boolean('must_change_password').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('admins', (table) => {
    table.dropColumn('must_change_password');
  });
}
