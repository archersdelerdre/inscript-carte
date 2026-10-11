import type { Knex } from 'knex';

/**
 * A reading keeps every rhythm the mandate writes (`rhythms`, a list) instead of one answer (`rhythm`): "AB/CD ou ABC"
 * needs both, and the code picks (`rhythmOf`).
 */
async function rewrite(knex: Knex, convert: (data: Record<string, unknown>) => Record<string, unknown>) {
  const readings: { ffta_id: string; data: string }[] = await knex('competition_mandates')
    .whereNotNull('data')
    .select('ffta_id', 'data');
  for (const { ffta_id, data } of readings) {
    await knex('competition_mandates')
      .where({ ffta_id })
      .update({ data: JSON.stringify(convert(JSON.parse(data))) });
  }
}

export async function up(knex: Knex): Promise<void> {
  await rewrite(knex, ({ rhythm, ...data }) => {
    // Readings made before the rhythm was asked have neither: they stay without.
    if (rhythm === undefined) return data;
    return { ...data, rhythms: rhythm === 'not_mentioned' ? [] : [rhythm] };
  });
}

/** Going back keeps one rhythm: AB/CD when the list has it, the only one otherwise, else "not mentioned". */
function oneRhythm(rhythms: unknown[]): unknown {
  if (rhythms.includes('AB/CD')) return 'AB/CD';
  return rhythms.length === 1 ? rhythms[0] : 'not_mentioned';
}

export async function down(knex: Knex): Promise<void> {
  await rewrite(knex, ({ rhythms, ...data }) =>
    Array.isArray(rhythms) ? { ...data, rhythm: oneRhythm(rhythms) } : data,
  );
}
