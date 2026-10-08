import type { GeoPosition } from '@inscript-carte/shared';

import type { CalendarDate } from '../domain/calendar-date.ts';
import type { Clock } from './ports/clock.ts';
import type { FftaCalendar, ListedCompetition } from './ports/ffta-calendar.ts';
import type {
  PlaceLocator,
  ScrapedCompetition,
  ScrapedCompetitionStore,
  StoredListing,
} from './ports/scraped-competition-store.ts';

/**
 * Below this share of the upcoming competitions already known, the list read is not trusted (the site changed, or
 * showed an error page): nothing is written. Checked only once enough are known for a share to mean something.
 */
const MIN_LISTED_SHARE = 0.5;
const MIN_KNOWN_FOR_SHARE = 100;

/** The list card's values a change of which means reading the detail page again. */
export function listingFingerprint(listed: ListedCompetition): string {
  return JSON.stringify([
    listed.title,
    listed.town,
    listed.startDate,
    listed.endDate,
    listed.status,
    listed.discipline,
    listed.hasParaTir,
    listed.organizerClub,
    listed.organizerEmail,
    listed.mandateUrl,
  ]);
}

export type SyncPlan = {
  /** Not stored yet: read their detail page, then add them. */
  added: ListedCompetition[];
  /** Stored, but their list card changed (or the scraper never wrote them): read their detail page again. */
  changed: ListedCompetition[];
  /** Stored and unchanged: only seen again. */
  unchanged: string[];
  /** Of `unchanged`, the ones that were missing and are listed again. */
  back: string[];
  /** Upcoming, stored, listed before, and now gone from the list. */
  missing: string[];
};

/**
 * What a run must do, from the list just read and what is stored. `complete` is `false` when the list was not read
 * to its end: then a competition not seen may be on a page not read, and none is called missing.
 */
export function planSync(
  listed: readonly ListedCompetition[],
  stored: readonly StoredListing[],
  today: CalendarDate,
  complete: boolean,
): SyncPlan {
  const storedById = new Map(stored.map((row) => [row.fftaId, row]));
  const plan: SyncPlan = { added: [], changed: [], unchanged: [], back: [], missing: [] };
  for (const competition of listed) {
    const row = storedById.get(competition.fftaId);
    if (!row) plan.added.push(competition);
    else if (row.fingerprint !== listingFingerprint(competition)) plan.changed.push(competition);
    else {
      plan.unchanged.push(competition.fftaId);
      if (row.missingSince) plan.back.push(competition.fftaId);
    }
  }
  if (complete) {
    const listedIds = new Set(listed.map(({ fftaId }) => fftaId));
    plan.missing = stored
      .filter((row) => row.startDate >= today && !row.missingSince && !listedIds.has(row.fftaId))
      .map(({ fftaId }) => fftaId);
  }
  return plan;
}

export type SyncProgress =
  | { step: 'list'; page: number; found: number }
  | { step: 'details'; done: number; total: number }
  | { step: 'saving' };

export type SyncReport = {
  dryRun: boolean;
  /** Why nothing was written; `null` when the run went through. */
  aborted: string | null;
  pages: number;
  listed: number;
  added: number;
  changed: number;
  unchanged: number;
  back: number;
  missing: number;
  detailsRead: number;
  /** Beyond `maxDetails`: read by a later run (their fingerprint is not saved). */
  detailsLeft: number;
  /** Read, but not stored: abroad (no département), or a detail page that could not be read. */
  skippedAbroad: number;
  skippedUnreadable: number;
  positions: { fromFfta: number; geocoded: number; notFound: number; notTried: number };
  problems: string[];
  durationMs: number;
};

export type SyncOptions = {
  /** Reads everything, writes nothing, calls no geocoder: shows what a real run would change. */
  dryRun: boolean;
  /** At most this many detail pages in one run (about 1 s each); the rest waits for the next run. */
  maxDetails?: number;
  onProgress?: (progress: SyncProgress) => void;
};

/** One run of the FFTA scraper: read the whole list, the detail pages that are needed, then store the result. */
export class SyncFftaCalendar {
  readonly #calendar: FftaCalendar;
  readonly #store: ScrapedCompetitionStore;
  readonly #locator: PlaceLocator;
  readonly #clock: Clock;

  constructor(calendar: FftaCalendar, store: ScrapedCompetitionStore, locator: PlaceLocator, clock: Clock) {
    this.#calendar = calendar;
    this.#store = store;
    this.#locator = locator;
    this.#clock = clock;
  }

  async run({ dryRun, maxDetails = Infinity, onProgress = () => {} }: SyncOptions): Promise<SyncReport> {
    const started = this.#clock.now();
    const today = this.#clock.today();
    const report: SyncReport = {
      dryRun,
      aborted: null,
      pages: 0,
      listed: 0,
      added: 0,
      changed: 0,
      unchanged: 0,
      back: 0,
      missing: 0,
      detailsRead: 0,
      detailsLeft: 0,
      skippedAbroad: 0,
      skippedUnreadable: 0,
      positions: { fromFfta: 0, geocoded: 0, notFound: 0, notTried: 0 },
      problems: [],
      durationMs: 0,
    };
    const finish = () => ({ ...report, durationMs: this.#clock.now().getTime() - started.getTime() });

    let list;
    try {
      list = await this.#calendar.readList(today, (page, found) => onProgress({ step: 'list', page, found }));
    } catch (error) {
      report.aborted = `La liste FFTA n'a pas pu être lue : ${error instanceof Error ? error.message : String(error)}`;
      return finish();
    }
    report.pages = list.pages;
    report.listed = list.competitions.length;
    report.problems.push(...list.problems);

    const stored = await this.#store.listings();
    const knownUpcoming = stored.filter((row) => row.startDate >= today && !row.missingSince).length;
    if (knownUpcoming >= MIN_KNOWN_FOR_SHARE && list.competitions.length < knownUpcoming * MIN_LISTED_SHARE) {
      report.aborted = `Seulement ${list.competitions.length} concours lus pour ${knownUpcoming} connus : la liste FFTA n'est pas fiable, rien n'est changé.`;
      return finish();
    }

    const plan = planSync(list.competitions, stored, today, list.complete);
    Object.assign(report, {
      added: plan.added.length,
      changed: plan.changed.length,
      unchanged: plan.unchanged.length,
      back: plan.back.length,
      missing: plan.missing.length,
    });

    const toRead = [...plan.added, ...plan.changed];
    const reading = toRead.slice(0, maxDetails);
    report.detailsLeft = toRead.length - reading.length;
    const scraped: ScrapedCompetition[] = [];
    const located = new Map<string, GeoPosition | null>();
    for (const [index, listed] of reading.entries()) {
      onProgress({ step: 'details', done: index, total: reading.length });
      let page;
      try {
        page = await this.#calendar.readCompetition(listed.fftaId);
      } catch (error) {
        // Cloudflare stopped the browser: what was read so far is still good, the rest waits for the next run.
        report.problems.push(`Arrêt des fiches : ${error instanceof Error ? error.message : String(error)}`);
        report.detailsLeft += reading.length - index;
        break;
      }
      report.detailsRead++;
      report.problems.push(...page.problems);
      const { detail } = page;
      if (!detail) {
        report.skippedUnreadable++;
        continue;
      }
      if (!detail.departmentCode) {
        report.skippedAbroad++;
        continue;
      }
      let position = detail.position;
      if (position) report.positions.fromFfta++;
      else if (dryRun) report.positions.notTried++;
      else {
        // The commune of the postal line names the place better than the title's town.
        const place = detail.city ?? listed.town;
        const key = `${place}|${detail.departmentCode}`;
        if (!located.has(key)) located.set(key, await this.#locator.locate(place, detail.departmentCode));
        position = located.get(key) ?? null;
        if (position) report.positions.geocoded++;
        else report.positions.notFound++;
      }
      scraped.push({
        listed,
        fingerprint: listingFingerprint(listed),
        detail,
        departmentCode: detail.departmentCode,
        position,
      });
    }
    onProgress({ step: 'details', done: reading.length, total: reading.length });

    if (!dryRun) {
      onProgress({ step: 'saving' });
      const listedAt = this.#clock.now();
      await this.#store.save(scraped, listedAt);
      await this.#store.markListed(plan.unchanged, listedAt);
      await this.#store.markMissing(plan.missing, today);
    }
    return finish();
  }
}
