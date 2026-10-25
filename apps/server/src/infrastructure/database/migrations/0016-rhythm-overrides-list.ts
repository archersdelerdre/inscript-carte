import type { Knex } from 'knex';

/**
 * A competition can have several rhythms, one per day for instance ("samedi en AB, dimanche en AB/CD"): an admin's
 * edit becomes a JSON list (`rhythms`) instead of one value (`rhythm`). `NULL` = the reading's.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.text('rhythms');
  });
  await knex('competition_overrides')
    .whereNotNull('rhythm')
    .update({ rhythms: knex.raw('json_array(rhythm)') });
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.dropColumn('rhythm');
  });
}

/** Going back keeps one rhythm: AB/CD when the list has it, else the first. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.enu('rhythm', ['AB', 'ABC', 'AB/CD']);
  });
  const rows: { ffta_id: string; rhythms: string }[] = await knex('competition_overrides')
    .whereNotNull('rhythms')
    .select('ffta_id', 'rhythms');
  for (const { ffta_id, rhythms } of rows) {
    const list = JSON.parse(rhythms) as string[];
    await knex('competition_overrides')
      .where({ ffta_id })
      .update({ rhythm: list.includes('AB/CD') ? 'AB/CD' : list[0] });
  }
  await knex.schema.alterTable('competition_overrides', (table) => {
    table.dropColumn('rhythms');
  });
}
