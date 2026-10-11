import type { Knex } from 'knex';

/** An admin's correction of the shooting rhythm read in the mandate (AB, ABC, AB/CD); `NULL` = the reading's. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.enu('rhythm', ['AB', 'ABC', 'AB/CD']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.dropColumn('rhythm');
  });
}
