import type { Knex } from 'knex';

/**
 * Inscript'Arc (2026-10-29): the link read in the mandate lives in the reading (`competition_mandates.data`); an
 * admin's edit of it lives here, `NULL` = the reading's.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.text('inscriptarc_url');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.dropColumn('inscriptarc_url');
  });
}
