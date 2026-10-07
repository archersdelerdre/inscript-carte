import type { Knex } from 'knex';

// Copied on purpose: a migration must not change when app constants change.
const PAYMENT_METHODS = ['cash', 'cheque', 'transfer'];

/** How the archer will pay. Rows made before this migration have none; the app requires it for new ones. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (table) => {
    table.enu('payment_method', PAYMENT_METHODS);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (table) => {
    table.dropColumn('payment_method');
  });
}
