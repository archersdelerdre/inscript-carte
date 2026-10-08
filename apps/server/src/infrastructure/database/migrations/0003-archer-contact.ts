import type { Knex } from 'knex';

/**
 * The member's email and phone, set by hand for now (the FFTA export has neither). Never shown in the app: only the
 * organizer's Excel file reads them, for the admin who makes it ("Responsable"). The member import leaves them alone.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('archers', (table) => {
    table.text('email');
    table.text('phone');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('archers', (table) => {
    table.dropColumn('email');
    table.dropColumn('phone');
  });
}
