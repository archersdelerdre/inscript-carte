import type { Knex } from 'knex';

/** The club pays this member's registrations: new départs start as `nothing_due`. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('archers', (table) => {
    table.boolean('club_pays_registrations').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('archers', (table) => {
    table.dropColumn('club_pays_registrations');
  });
}
