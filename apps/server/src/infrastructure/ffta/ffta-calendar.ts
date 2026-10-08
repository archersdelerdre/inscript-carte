import { addDays, type CalendarDate } from '../../domain/calendar-date.ts';
import { mergeParaTir, parseCalendarPage, type ListedCompetition } from './calendar-page.ts';
import { parseCompetitionPage, type CompetitionPage } from './competition-page.ts';
import type { FftaBrowser } from './ffta-browser.ts';

/** The old app read one year ahead too. */
const DAYS_AHEAD = 366;
/** About 75 pages for all of France on 2026-10-08: far more means the site changed (or loops). */
const MAX_PAGES = 200;

export type CalendarRead = { competitions: ListedCompetition[]; pages: number; problems: string[] };

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

/**
 * Every competition of all of France from `today` for a year, page after page until an empty one, Para-tir merged.
 * `onPage` follows the progress. A competition seen on two pages (the list moved while being read) is kept once.
 */
export async function readCalendar(
  browser: FftaBrowser,
  today: CalendarDate,
  onPage: (page: number, found: number) => void = () => {},
): Promise<CalendarRead> {
  const to = addDays(today, DAYS_AHEAD);
  const byId = new Map<string, ListedCompetition>();
  const problems: string[] = [];
  let pages = 0;
  for (; pages < MAX_PAGES; pages++) {
    const page = parseCalendarPage(await browser.html(listUrl(today, to, pages)));
    problems.push(...page.problems);
    if (page.competitions.length === 0 && page.problems.length === 0) break;
    for (const competition of page.competitions) byId.set(competition.fftaId, competition);
    onPage(pages + 1, byId.size);
  }
  if (pages === MAX_PAGES) problems.push(`Arrêt après ${MAX_PAGES} pages : la liste FFTA ne finit pas.`);
  return { competitions: mergeParaTir([...byId.values()]), pages, problems };
}

/** The detail page of one competition: its address (and so its département), contacts and committees. */
export async function readCompetition(browser: FftaBrowser, fftaId: string): Promise<CompetitionPage> {
  return parseCompetitionPage(fftaId, await browser.html(`https://www.ffta.fr/epreuve/${fftaId}`));
}
