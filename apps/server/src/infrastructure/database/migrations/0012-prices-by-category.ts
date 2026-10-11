import type { Knex } from 'knex';

/**
 * Prices name the FFTA categories they apply to (`categories`) instead of one of four audiences (`audience`). Both
 * the mandate readings and the admins' edited prices are JSON: they are rewritten here.
 */
const YOUTH = ['U11', 'U13', 'U15', 'U18', 'U21'];
const ADULTS = ['S1', 'S2', 'S3'];
const CATEGORIES_BY_AUDIENCE: Record<string, string[]> = {
  adult: ADULTS,
  youth: YOUTH,
  u11: ['U11'],
  all: [...YOUTH, ...ADULTS],
};

type OldPrice = { audience: string; departures: number; amountEuros: number };
type NewPrice = { categories: string[]; departures: number; amountEuros: number };

function toCategories({ audience, ...rest }: OldPrice): NewPrice {
  return { categories: CATEGORIES_BY_AUDIENCE[audience] ?? [...YOUTH, ...ADULTS], ...rest };
}

/** Going back loses the lists that no audience covers: they become "all". */
function toAudience({ categories, ...rest }: NewPrice): OldPrice {
  const key = categories.toSorted().join();
  const audience = Object.entries(CATEGORIES_BY_AUDIENCE).find(([, list]) => list.toSorted().join() === key)?.[0];
  return { audience: audience ?? 'all', ...rest };
}

async function rewrite(knex: Knex, convert: (prices: unknown[]) => unknown[]): Promise<void> {
  const readings: { ffta_id: string; data: string }[] = await knex('competition_mandates')
    .whereNotNull('data')
    .select('ffta_id', 'data');
  for (const { ffta_id, data } of readings) {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed.prices)) continue;
    await knex('competition_mandates')
      .where({ ffta_id })
      .update({ data: JSON.stringify({ ...parsed, prices: convert(parsed.prices) }) });
  }
  const edits: { ffta_id: string; prices: string }[] = await knex('competition_overrides')
    .whereNotNull('prices')
    .select('ffta_id', 'prices');
  for (const { ffta_id, prices } of edits) {
    await knex('competition_overrides')
      .where({ ffta_id })
      .update({ prices: JSON.stringify(convert(JSON.parse(prices))) });
  }
}

export async function up(knex: Knex): Promise<void> {
  await rewrite(knex, (prices) => (prices as OldPrice[]).map(toCategories));
}

export async function down(knex: Knex): Promise<void> {
  await rewrite(knex, (prices) => (prices as NewPrice[]).map(toAudience));
}
