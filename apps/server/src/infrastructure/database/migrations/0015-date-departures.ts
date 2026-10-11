import type { MandateData } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import { datedDepartures } from '../../../domain/mandate.ts';

/**
 * Readings made before the days of undated départs were worked out from the times (`datedDepartures`) get them now,
 * with the competition's dates (an admin's edited dates win). Nothing to undo: a day found stays right.
 */
export async function up(knex: Knex): Promise<void> {
  const readings: { ffta_id: string; data: string; start_date: string; end_date: string }[] = await knex(
    'competition_mandates as m',
  )
    .join('competitions as c', 'c.ffta_id', 'm.ffta_id')
    .leftJoin('competition_overrides as o', 'o.ffta_id', 'm.ffta_id')
    .where('m.status', 'parsed')
    .whereNotNull('m.data')
    .select(
      'm.ffta_id',
      'm.data',
      knex.raw('coalesce(o.start_date, c.start_date) as start_date'),
      knex.raw('coalesce(o.end_date, c.end_date) as end_date'),
    );
  for (const reading of readings) {
    const data = JSON.parse(reading.data) as MandateData;
    const departures = datedDepartures(data.departures, { startDate: reading.start_date, endDate: reading.end_date });
    if (departures === data.departures) continue;
    await knex('competition_mandates')
      .where({ ffta_id: reading.ffta_id })
      .update({ data: JSON.stringify({ ...data, departures }) });
  }
}

export async function down(): Promise<void> {}
