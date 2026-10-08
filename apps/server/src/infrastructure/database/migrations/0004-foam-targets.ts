import type { Knex } from 'knex';

/** The competition is shot on foam targets ("cibles mousses"). The legacy data has no such field: the scraper will fill it. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitions', (table) => {
    table.boolean('has_foam_targets').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitions', (table) => {
    table.dropColumn('has_foam_targets');
  });
}
