import type { Knex } from 'knex';

/** An import no longer deactivates the members missing from the file (the user decided it): nothing to count. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('member_imports', (table) => {
    table.dropColumn('deactivated');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('member_imports', (table) => {
    table.integer('deactivated').notNullable().defaultTo(0);
  });
}
