import type {
  CalendarRead,
  CompetitionPage,
  FftaCalendar,
  ListedCompetition,
} from '../../application/ports/ffta-calendar.ts';
import { addDays, type CalendarDate } from '../../domain/calendar-date.ts';
import { mergeParaTir, parseCalendarPage } from './calendar-page.ts';
import { parseCompetitionPage } from './competition-page.ts';
import type { FftaBrowser } from './ffta-browser.ts';

/** The old app read one year ahead too. */
const DAYS_AHEAD = 366;
/** About 75 pages for all of France on 2026-10-08: far more means the site changed (or loops). */
export const MAX_PAGES = 200;

function listUrl(from: CalendarDate, to: CalendarDate, page: number): string {
  const query = new URLSearchParams({
    discipline: 'All',
    inter: 'All',
    univers: 'All',
    sort_by: 'start',
    sort_order: 'ASC',
    start: from,
    end: to,
    page: String(page),
  });
  return `https://www.ffta.fr/competitions?${query}`;
}

/** www.ffta.fr read with the stealth browser, one page at a time. */
export class BrowserFftaCalendar implements FftaCalendar {
  readonly #browser: FftaBrowser;

  constructor(browser: FftaBrowser) {
    this.#browser = browser;
  }

  /** Page after page until an empty one. A competition seen on two pages (the list moved meanwhile) is kept once. */
  async readList(today: CalendarDate, onPage: (page: number, found: number) => void): Promise<CalendarRead> {
    const to = addDays(today, DAYS_AHEAD);
    const byId = new Map<string, ListedCompetition>();
    const problems: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const read = parseCalendarPage(await this.#browser.html(listUrl(today, to, page)));
      problems.push(...read.problems);
      if (read.competitions.length === 0 && read.problems.length === 0) {
        return { competitions: mergeParaTir([...byId.values()]), pages: page, complete: true, problems };
      }
      for (const competition of read.competitions) byId.set(competition.fftaId, competition);
      onPage(page + 1, byId.size);
    }
    problems.push(`Arrêt après ${MAX_PAGES} pages : la liste FFTA ne finit pas.`);
    return { competitions: mergeParaTir([...byId.values()]), pages: MAX_PAGES, complete: false, problems };
  }

  async readCompetition(fftaId: string): Promise<CompetitionPage> {
    return parseCompetitionPage(fftaId, await this.#browser.html(`https://www.ffta.fr/epreuve/${fftaId}`));
  }
}
