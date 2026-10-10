import type { Knex } from 'knex';

/**
 * The day a scraper run first saw the competition's mandate link: the club deadline depends on it. `NULL` without a
 * link, and for the links already stored (when they appeared is unknown).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitions', (table) => {
    table.text('mandate_added_on');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitions', (table) => {
    table.dropColumn('mandate_added_on');
  });
}
