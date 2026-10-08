import type { Knex } from 'knex';

/**
 * One row per FFTA scraper run. The partial unique index is the lock: at most one row may be `running`, so two admins
 * clicking at the same moment cannot start two runs (SQLite refuses the second insert).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('scraper_runs', (table) => {
    table.increments('id');
    table.enu('kind', ['full', 'competition']).notNullable();
    /** Only for `competition` runs. */
    table.text('ffta_id');
    table.boolean('dry_run').notNullable().defaultTo(false);
    /** `NULL` for the night run and the command line. */
    table.text('started_by').references('licence_number').inTable('archers').onDelete('RESTRICT');
    table.enu('status', ['running', 'succeeded', 'failed', 'interrupted']).notNullable().defaultTo('running');
    /** The current step, as JSON (`ScraperProgress`). */
    table.text('progress');
    /** The final counts, as JSON (`ScraperReport`). */
    table.text('report');
    table.text('error');
    table.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    /** Written every few seconds by the running process: an old one means the process died. */
    table.timestamp('heartbeat_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('finished_at');

    table.index(['started_at']);
  });
  await knex.raw("CREATE UNIQUE INDEX scraper_runs_one_running ON scraper_runs (status) WHERE status = 'running'");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('scraper_runs');
}
