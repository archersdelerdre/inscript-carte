import type { GeoPosition, ScraperProgress, ScraperReport } from '@inscript-carte/shared';

import type { CalendarDate } from '../domain/calendar-date.ts';
import type { Clock } from './ports/clock.ts';
import type { CompetitionDetail, FftaCalendar, ListedCompetition } from './ports/ffta-calendar.ts';
import type {
  PlaceLocator,
  ScrapedCompetition,
  ScrapedCompetitionStore,
  StoredListing,
} from './ports/scraped-competition-store.ts';
import type { ReadMandates } from './read-mandates.ts';

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

export type SyncOptions = {
  /** Reads everything, writes nothing, calls no geocoder: shows what a real run would change. */
  dryRun: boolean;
  /** At most this many detail pages in one run (about 1 s each); the rest waits for the next run. */
  maxDetails?: number;
  /** At most this many mandates sent to the LLM in one run; the rest waits for the next run. */
  maxMandates?: number;
  onProgress?: (progress: ScraperProgress) => void;
};

function emptyReport(dryRun: boolean): ScraperReport {
  return {
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
    mandates: null,
    problems: [],
    durationMs: 0,
  };
}

/** One run of the FFTA scraper: read the whole list, the detail pages that are needed, then store the result. */
export class SyncFftaCalendar {
  readonly #calendar: FftaCalendar;
  readonly #store: ScrapedCompetitionStore;
  readonly #locator: PlaceLocator;
  /** `null` without an OpenRouter key: the competitions are still stored, their mandates wait. */
  readonly #mandates: ReadMandates | null;
  readonly #clock: Clock;

  constructor(
    calendar: FftaCalendar,
    store: ScrapedCompetitionStore,
    locator: PlaceLocator,
    mandates: ReadMandates | null,
    clock: Clock,
  ) {
    this.#calendar = calendar;
    this.#store = store;
    this.#locator = locator;
    this.#mandates = mandates;
    this.#clock = clock;
  }

  async run({
    dryRun,
    maxDetails = Infinity,
    maxMandates,
    onProgress = () => {},
  }: SyncOptions): Promise<ScraperReport> {
    const started = this.#clock.now();
    const today = this.#clock.today();
    const report = emptyReport(dryRun);
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
      report.aborted = `Seulement ${list.competitions.length} concours lus alors que ${knownUpcoming} sont déjà connus : la liste FFTA semble incomplète, rien n'a été changé.`;
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
      const position = await this.#position(detail, detail.departmentCode, listed.town, dryRun, report, located);
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
      // After the save: the competitions just stored (and older ones still waiting) have their mandate link.
      await this.#readMandates(report, { today, limit: maxMandates }, onProgress);
    }
    return finish();
  }

  /**
   * Reads one competition's detail page and stores it (an admin saw it wrong or missing). It stores no fingerprint:
   * the next full run reads it again with its list card, which knows the Para-tir flag.
   */
  async runOne(fftaId: string, { dryRun, onProgress = () => {} }: SyncOptions): Promise<ScraperReport> {
    const started = this.#clock.now();
    const report = emptyReport(dryRun);
    const finish = () => ({ ...report, durationMs: this.#clock.now().getTime() - started.getTime() });

    onProgress({ step: 'details', done: 0, total: 1 });
    let page;
    try {
      page = await this.#calendar.readCompetition(fftaId);
    } catch (error) {
      report.aborted = `La fiche FFTA n'a pas pu être lue : ${error instanceof Error ? error.message : String(error)}`;
      return finish();
    }
    onProgress({ step: 'details', done: 1, total: 1 });
    report.detailsRead = 1;
    report.problems.push(...page.problems);
    const { detail } = page;
    if (!detail) {
      report.skippedUnreadable = 1;
      report.aborted = `La fiche FFTA ${fftaId} n'est pas lisible (concours supprimé ?) : rien n'a été changé.`;
      return finish();
    }
    if (!detail.departmentCode) {
      report.skippedAbroad = 1;
      report.aborted = `Le concours ${fftaId} n'a pas de département français : il n'est pas enregistré.`;
      return finish();
    }
    const known = (await this.#store.listings()).some((row) => row.fftaId === fftaId);
    if (known) report.changed = 1;
    else report.added = 1;
    const position = await this.#position(detail, detail.departmentCode, detail.town, dryRun, report, new Map());
    if (!dryRun) {
      onProgress({ step: 'saving' });
      await this.#store.saveDetail(detail, detail.departmentCode, position, this.#clock.now());
      await this.#readMandates(report, { today: this.#clock.today(), fftaIds: [fftaId] }, onProgress);
    }
    return finish();
  }

  async #readMandates(
    report: ScraperReport,
    options: { today: CalendarDate; fftaIds?: string[]; limit?: number },
    onProgress: (progress: ScraperProgress) => void,
  ): Promise<void> {
    if (!this.#mandates) {
      report.problems.push(
        'Les mandats n’ont pas été lus : la clé OpenRouter (OPENROUTER_API_KEY) n’est pas réglée sur ce serveur.',
      );
      return;
    }
    report.mandates = await this.#mandates.run({
      ...options,
      onProgress: (done, total) => onProgress({ step: 'mandates', done, total }),
      onProblem: (fftaId, problem) => report.problems.push(`Concours ${fftaId} : ${problem}`),
    });
  }

  /** The FFTA's own map point, else the address service (never in a dry run), counted in the report. */
  async #position(
    detail: CompetitionDetail,
    departmentCode: string,
    listedTown: string,
    dryRun: boolean,
    report: ScraperReport,
    located: Map<string, GeoPosition | null>,
  ): Promise<GeoPosition | null> {
    if (detail.position) {
      report.positions.fromFfta++;
      return detail.position;
    }
    if (dryRun) {
      report.positions.notTried++;
      return null;
    }
    // The commune of the postal line names the place better than the title's town.
    const place = detail.city ?? listedTown;
    const key = `${place}|${departmentCode}`;
    if (!located.has(key)) located.set(key, await this.#locator.locate(place, departmentCode));
    const position = located.get(key) ?? null;
    if (position) report.positions.geocoded++;
    else report.positions.notFound++;
    return position;
  }
}
