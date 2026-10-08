import type { Knex } from 'knex';

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

  async save(competitions: readonly ScrapedCompetition[], listedAt: Date): Promise<void> {
    const now = listedAt.toISOString();
    await inBatches(competitions, (batch) =>
      this.#database.transaction((transaction) =>
        transaction('competitions')
          .insert(
            batch.map(({ listed, fingerprint, detail, departmentCode, position }) => ({
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
              mandate_url: listed.mandateUrl ?? detail.mandateUrl,
              championship: detail.championship,
              has_duels: detail.hasDuels,
              regional_committee: detail.regionalCommittee,
              departmental_committee: detail.departmentalCommittee,
              venue: detail.venue,
              street_lines: detail.streetLines.join('\n') || null,
              postal_code: detail.postalCode,
              city: detail.city,
              country: detail.country,
              list_fingerprint: fingerprint,
              detail_read_at: now,
              last_listed_at: now,
              missing_since: null,
              updated_at: now,
            })),
          )
          // `has_foam_targets` and `created_at` are not in the insert, so a merge keeps them.
          .onConflict('ffta_id')
          .merge(),
      ),
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
