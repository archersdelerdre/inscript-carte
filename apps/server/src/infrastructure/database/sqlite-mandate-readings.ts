import type { Knex } from 'knex';

import type { MandateReadingState, MandateReadings } from '../../application/ports/mandate-readings.ts';
import type { MandateStatus } from '../../application/ports/mandates.ts';

type ReadingRow = {
  ffta_id: string;
  mandate_url: string;
  status: MandateStatus;
  attempts: number;
  problems: string | null;
};

export class SqliteMandateReadings implements MandateReadings {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async all(): Promise<Map<string, MandateReadingState>> {
    const rows: ReadingRow[] = await this.#database('competition_mandates').select(
      'ffta_id',
      'mandate_url',
      'status',
      'attempts',
      'problems',
    );
    return new Map(
      rows.map((row) => [
        row.ffta_id,
        {
          mandateUrl: row.mandate_url,
          status: row.status,
          attempts: row.attempts,
          problems: row.problems ? row.problems.split('\n') : [],
        },
      ]),
    );
  }
}
