import type { Knex } from 'knex';

import type { MandateReading, MandateStatus, MandateStore, PendingMandate } from '../../application/ports/mandates.ts';
import type { CalendarDate } from '../../domain/calendar-date.ts';

type PendingRow = {
  ffta_id: string;
  mandate_url: string;
  title: string;
  town: string;
  start_date: string;
  end_date: string;
  previous_url: string | null;
  previous_sha256: string | null;
  previous_status: MandateStatus | null;
  previous_attempts: number | null;
};

export class SqliteMandateStore implements MandateStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async pending({
    today,
    maxAttempts,
    fftaIds,
    force = false,
  }: {
    today: CalendarDate;
    maxAttempts: number;
    fftaIds?: readonly string[];
    force?: boolean;
  }): Promise<PendingMandate[]> {
    const query = this.#database('competitions as c')
      .leftJoin('competition_mandates as m', 'm.ffta_id', 'c.ffta_id')
      .whereNotNull('c.mandate_url')
      .where('c.end_date', '>=', today)
      .whereNull('c.missing_since')
      .whereNot('c.status', 'cancelled')
      .modify((pending) => {
        if (force) return;
        pending.where((needed) =>
          needed
            .whereNull('m.ffta_id')
            .orWhereRaw('m.mandate_url <> c.mandate_url')
            .orWhere((retry) => retry.whereIn('m.status', ['failed', 'invalid']).where('m.attempts', '<', maxAttempts)),
        );
      })
      .orderBy('c.start_date')
      .select(
        'c.ffta_id',
        'c.mandate_url',
        'c.title',
        'c.town',
        'c.start_date',
        'c.end_date',
        'm.mandate_url as previous_url',
        'm.sha256 as previous_sha256',
        'm.status as previous_status',
        'm.attempts as previous_attempts',
      );
    if (fftaIds) query.whereIn('c.ffta_id', fftaIds);
    const rows: PendingRow[] = await query;
    return rows.map((row) => ({
      fftaId: row.ffta_id,
      mandateUrl: row.mandate_url,
      title: row.title,
      town: row.town,
      startDate: row.start_date,
      endDate: row.end_date,
      previous:
        row.previous_url && row.previous_status
          ? {
              mandateUrl: row.previous_url,
              sha256: row.previous_sha256,
              status: row.previous_status,
              attempts: row.previous_attempts ?? 0,
            }
          : null,
    }));
  }

  async save(reading: MandateReading): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await transaction('competition_mandates')
        .insert({
          ffta_id: reading.fftaId,
          mandate_url: reading.mandateUrl,
          sha256: reading.sha256,
          status: reading.status,
          attempts: reading.attempts,
          data: reading.data ? JSON.stringify(reading.data) : null,
          raw_answer: reading.rawAnswer,
          problems: reading.problems.join('\n') || null,
          model: reading.model,
          cost_usd: reading.costUsd,
          page_count: reading.pageCount,
          read_at: reading.readAt.toISOString(),
        })
        .onConflict('ffta_id')
        .merge();
      if (reading.data) {
        await transaction('competitions')
          .where({ ffta_id: reading.fftaId })
          .update({ has_foam_targets: reading.data.foamTargets === 'yes' });
      }
    });
  }

  async keepReading(fftaId: string, mandateUrl: string, readAt: Date): Promise<void> {
    await this.#database('competition_mandates')
      .where({ ffta_id: fftaId })
      .update({ mandate_url: mandateUrl, read_at: readAt.toISOString() });
  }
}
