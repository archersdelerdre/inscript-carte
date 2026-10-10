import type { Knex } from 'knex';

/**
 * What admins changed on a competition, one row per edited competition, one column per field: `NULL` means the FFTA
 * value is used. The scraper never writes here, so an edit stays until an admin puts the FFTA value back.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('competition_overrides', (table) => {
    table.text('ffta_id').notNullable().primary().references('ffta_id').inTable('competitions').onDelete('CASCADE');
    table.text('title');
    table.text('start_date');
    table.text('end_date');
    table.enu('discipline', ['3d', 'autres', 'beursault', 'campagne', 'exterieur', 'loisirs', 'nature', 'salle']);
    table.enu('status', ['scheduled', 'postponed', 'cancelled']);
    table.boolean('has_para_tir');
    table.boolean('has_foam_targets');
    table.text('mandate_url');
    /** Set when an admin gives a mandate link the FFTA did not have: the club deadline depends on it. */
    table.text('mandate_added_on');
    table.text('town');
    table.text('department_code');
    table.double('latitude');
    table.double('longitude');
    /** `MandateDeparture[]` / `MandatePrice[]` as JSON; they replace the mandate reading. */
    table.text('departures');
    table.text('prices');
    table.text('updated_by').notNullable().references('licence_number').inTable('archers').onDelete('RESTRICT');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('competition_overrides');
}
