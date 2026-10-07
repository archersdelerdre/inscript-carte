import type { Knex } from 'knex';

/** The archer would like to share a car from the club; shown to the other members in "Voir les inscrits". */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (table) => {
    table.boolean('carpool').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (table) => {
    table.dropColumn('carpool');
  });
}
