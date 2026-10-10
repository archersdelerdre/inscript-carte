import type { GeoPosition } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { CompetitionDetail, ListedCompetition } from '../../application/ports/ffta-calendar.ts';
import type {
  ScrapedCompetition,
  ScrapedCompetitionStore,
  StoredListing,
} from '../../application/ports/scraped-competition-store.ts';
import type { CalendarDate } from '../../domain/calendar-date.ts';

/**
 * Each batch is its own short transaction: the server's writes (a registration, an admin change) wait a few
 * milliseconds at most, never the length of a run. A run stopped half-way is fine: the next one starts over.
 */
const BATCH_SIZE = 100;

async function inBatches<T>(items: readonly T[], write: (batch: readonly T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < items.length; start += BATCH_SIZE) await write(items.slice(start, start + BATCH_SIZE));
}

export class SqliteScrapedCompetitionStore implements ScrapedCompetitionStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async listings(): Promise<StoredListing[]> {
    const rows: {
      ffta_id: string;
      list_fingerprint: string | null;
      start_date: string;
      missing_since: string | null;
    }[] = await this.#database('competitions').select('ffta_id', 'list_fingerprint', 'start_date', 'missing_since');
    return rows.map((row) => ({
      fftaId: row.ffta_id,
      fingerprint: row.list_fingerprint,
      startDate: row.start_date,
      missingSince: row.missing_since,
    }));
  }

  async save(competitions: readonly ScrapedCompetition[], listedAt: Date, today: CalendarDate): Promise<void> {
    await inBatches(competitions, (batch) =>
      this.#database.transaction((transaction) => {
        const rows = batch.map(({ listed, fingerprint, detail, departmentCode, position }) => ({
          ...competitionRow(listed, detail, departmentCode, position, listedAt, today),
          list_fingerprint: fingerprint,
          last_listed_at: listedAt.toISOString(),
          missing_since: null,
        }));
        // `has_foam_targets` and `created_at` are not in the insert, so a merge keeps them.
        return transaction('competitions')
          .insert(rows)
          .onConflict('ffta_id')
          .merge(this.#merged(Object.keys(rows[0]!)));
      }),
    );
  }

  async saveDetail(
    detail: CompetitionDetail,
    departmentCode: string,
    position: GeoPosition | null,
    readAt: Date,
    today: CalendarDate,
  ): Promise<void> {
    const listed = { ...detail, organizerEmail: detail.email };
    const row = { ...competitionRow(listed, detail, departmentCode, position, readAt, today), list_fingerprint: null };
    await this.#database('competitions')
      .insert(row)
      .onConflict('ffta_id')
      // The Para-tir flag of a stored row came from the list (merged Para-tir entries): the detail page cannot tell.
      .merge(this.#merged(Object.keys(row).filter((column) => column !== 'has_para_tir')));
  }

  /**
   * The update part of an upsert: the new values, except `mandate_added_on`. That day stays while the row keeps a
   * link (even another file), is set when a link appears, and is cleared when it goes.
   */
  #merged(columns: readonly string[]): Record<string, Knex.Raw> {
    return Object.fromEntries(
      columns.map((column) => [
        column,
        column === 'mandate_added_on'
          ? this.#database.raw(
              `CASE WHEN excluded.mandate_url IS NULL THEN NULL
                    WHEN competitions.mandate_url IS NULL THEN excluded.mandate_added_on
                    ELSE competitions.mandate_added_on END`,
            )
          : this.#database.raw('??', [`excluded.${column}`]),
      ]),
    );
  }

  async markListed(fftaIds: readonly string[], listedAt: Date): Promise<void> {
    await inBatches(fftaIds, (batch) =>
      this.#database('competitions')
        .whereIn('ffta_id', batch)
        .update({ last_listed_at: listedAt.toISOString(), missing_since: null }),
    );
  }

  async markMissing(fftaIds: readonly string[], since: CalendarDate): Promise<void> {
    await inBatches(fftaIds, (batch) =>
      this.#database('competitions').whereIn('ffta_id', batch).update({ missing_since: since }),
    );
  }
}

/** The columns both writes fill: the list's values first (what the fingerprint covers), the rest from the detail page. */
function competitionRow(
  listed: ListedCompetition,
  detail: CompetitionDetail,
  departmentCode: string,
  position: GeoPosition | null,
  readAt: Date,
  today: CalendarDate,
) {
  const now = readAt.toISOString();
  const mandateUrl = listed.mandateUrl ?? detail.mandateUrl;
  return {
    ffta_id: listed.fftaId,
    title: listed.title,
    discipline: listed.discipline,
    status: listed.status,
    start_date: listed.startDate,
    end_date: listed.endDate,
    organizer_club: listed.organizerClub ?? detail.organizerClub,
    organizer_email: listed.organizerEmail ?? detail.email,
    organizer_phone: detail.phone,
    organizer_website: detail.website,
    town: listed.town,
    department_code: departmentCode,
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    has_para_tir: listed.hasParaTir,
    mandate_url: mandateUrl,
    // Only used for a new row, or a stored one that had no link: see `#merged`.
    mandate_added_on: mandateUrl ? today : null,
    championship: detail.championship,
    has_duels: detail.hasDuels,
    regional_committee: detail.regionalCommittee,
    departmental_committee: detail.departmentalCommittee,
    venue: detail.venue,
    street_lines: detail.streetLines.join('\n') || null,
    postal_code: detail.postalCode,
    city: detail.city,
    country: detail.country,
    detail_read_at: now,
    updated_at: now,
  };
}
