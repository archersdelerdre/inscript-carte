import type { Knex } from 'knex';

/**
 * What the LLM read in each competition's mandate (the organizer's PDF). One row per competition: a new mandate link
 * replaces it. The file's SHA-256 avoids paying again for a file uploaded twice under another link.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('competition_mandates', (table) => {
    table.text('ffta_id').notNullable().primary().references('ffta_id').inTable('competitions').onDelete('CASCADE');
    table.text('mandate_url').notNullable();
    table.text('sha256');
    /** `invalid`: the LLM answered, but the checks refused it. `failed`: no answer (download, images, LLM). */
    table.enu('status', ['parsed', 'invalid', 'failed']).notNullable();
    /** Tries on this link; reset when the link changes. */
    table.integer('attempts').notNullable().defaultTo(0);
    /** `MandateData` as JSON, only when `parsed`. */
    table.text('data');
    /** The LLM's answer as it came, when `invalid`: to see what went wrong. */
    table.text('raw_answer');
    /** Why it is `invalid` or `failed`, one problem per line. */
    table.text('problems');
    table.text('model');
    table.double('cost_usd');
    table.integer('page_count');
    table.timestamp('read_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('competition_mandates');
}
