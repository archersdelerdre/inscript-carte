import type { Discipline } from '@inscript-carte/shared';
import { parse, type HTMLElement } from 'node-html-parser';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type { CompetitionStatus } from '../../domain/competition.ts';

/** One competition as the FFTA calendar list shows it (`https://www.ffta.fr/competitions`). */
export type ListedCompetition = {
  fftaId: string;
  /** The FFTA title without its " à TOWN" end. */
  title: string;
  /** What follows the last " à " of the FFTA title. */
  town: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  status: CompetitionStatus;
  discipline: Discipline;
  hasParaTir: boolean;
  organizerClub: string | null;
  organizerEmail: string | null;
  mandateUrl: string | null;
};

/** What the page holds: the competitions read, and what could not be read (FFTA text, never personal data). */
export type CalendarPage = { competitions: ListedCompetition[]; problems: string[] };

const MONTHS: Record<string, number> = {
  janvier: 1,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
};

/** The FFTA discipline labels (its own menu), lower-cased. Para-tir has its own entries: merged as a flag. */
const DISCIPLINES: Record<string, { discipline: Discipline; paraTir: boolean }> = {
  'tir à 18m': { discipline: 'salle', paraTir: false },
  "para-tir à l'arc à 18m": { discipline: 'salle', paraTir: true },
  "tir à l'arc extérieur": { discipline: 'exterieur', paraTir: false },
  "para-tir à l'arc en extérieur": { discipline: 'exterieur', paraTir: true },
  'tir en campagne': { discipline: 'campagne', paraTir: false },
  'tir 3d': { discipline: '3d', paraTir: false },
  'tir nature': { discipline: 'nature', paraTir: false },
  'tir beursault': { discipline: 'beursault', paraTir: false },
  loisirs: { discipline: 'loisirs', paraTir: false },
  'loisirs débutant': { discipline: 'loisirs', paraTir: false },
  'loisirs confirmé': { discipline: 'loisirs', paraTir: false },
  'loisirs débutant et confirmé': { discipline: 'loisirs', paraTir: false },
  'rencontres clubs loisirs': { discipline: 'loisirs', paraTir: false },
  jeunes: { discipline: 'loisirs', paraTir: false },
  'tournoi poussin': { discipline: 'loisirs', paraTir: false },
  'run archery': { discipline: 'autres', paraTir: false },
  divers: { discipline: 'autres', paraTir: false },
};

/** The class of the card head says the status ("--valid", "--report", "--cancel"). */
const STATUS_BY_CLASS: Record<string, CompetitionStatus> = {
  'competition_item__head--valid': 'scheduled',
  'competition_item__head--report': 'postponed',
  'competition_item__head--cancel': 'cancelled',
};

const LIST_DATES =
  /^(?:le (\d{1,2}) (\p{L}+) (\d{4})|du (\d{1,2})(?: (\p{L}+))?(?: (\d{4}))? au (\d{1,2}) (\p{L}+) (\d{4}))$/u;

function isoDate(year: number, month: number, day: number): CalendarDate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "Le 14 novembre 2026", "Du 09 au 11 octobre 2026", "Du 31 octobre au 01 novembre 2026" or "Du 30 octobre 2026 au
 * 02 mars 2027". Without its own year, a start month after the end month is in the year before (December → January).
 */
export function parseListDates(text: string): { startDate: CalendarDate; endDate: CalendarDate } | null {
  const match = LIST_DATES.exec(text.trim().replace(/\s+/g, ' ').toLowerCase());
  if (!match) return null;
  const [, oneDay, oneMonth, oneYear, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = match;
  if (oneDay && oneMonth && oneYear) {
    const month = MONTHS[oneMonth];
    if (!month) return null;
    const date = isoDate(Number(oneYear), month, Number(oneDay));
    return { startDate: date, endDate: date };
  }
  const endMonth = MONTHS[toMonth!];
  const startMonth = fromMonth ? MONTHS[fromMonth] : endMonth;
  if (!endMonth || !startMonth) return null;
  const endYear = Number(toYear);
  const startYear = fromYear ? Number(fromYear) : endYear - Number(startMonth > endMonth);
  return {
    startDate: isoDate(startYear, startMonth, Number(fromDay)),
    endDate: isoDate(endYear, endMonth, Number(toDay)),
  };
}

const text = (element: HTMLElement | null) => element?.textContent.replace(/\s+/g, ' ').trim() ?? '';

/** `null` (with a problem) when a card cannot be read: one odd card never stops the whole page. */
function readCard(card: HTMLElement, problems: string[]): ListedCompetition | null {
  const link = card.querySelector('.competition_item__title a');
  const fftaId = /\/epreuve\/(\d+)/.exec(link?.getAttribute('href') ?? '')?.[1];
  if (!fftaId) {
    problems.push('Carte sans lien /epreuve/<id>');
    return null;
  }
  const fullTitle = text(link);
  const at = fullTitle.lastIndexOf(' à ');
  const dates = parseListDates(text(card.querySelector('.competition_item__dates')));
  const disciplineLabel = text(card.querySelector('.field--name-field-discipline'));
  const discipline = DISCIPLINES[disciplineLabel.toLowerCase()];
  const head = card.querySelector('.competition_item__head');
  const status = head?.classList.value.map((name) => STATUS_BY_CLASS[name]).find(Boolean);

  if (at < 0) problems.push(`${fftaId} : titre sans « à VILLE » : ${fullTitle}`);
  if (!dates) problems.push(`${fftaId} : dates illisibles : ${text(card.querySelector('.competition_item__dates'))}`);
  if (!discipline) problems.push(`${fftaId} : discipline inconnue : ${disciplineLabel}`);
  if (!status) problems.push(`${fftaId} : statut inconnu : ${head?.classList.value.join(' ') ?? '(aucun)'}`);
  if (at < 0 || !dates || !discipline || !status) return null;

  // "LA FLECHE ROCHEFORTAISE <small>(ROCHEFORT DU GARD)</small>": the club, then the club's town.
  const organizer = card
    .querySelectorAll('.competition_item__infos > span')
    .find((span) => !span.querySelector('.field'));
  organizer?.querySelector('small')?.remove();
  const email = card.querySelector('a[href^="mailto:"]')?.getAttribute('href')?.slice('mailto:'.length).trim();

  return {
    fftaId,
    title: fullTitle.slice(0, at).trim(),
    town: fullTitle.slice(at + 3).trim(),
    ...dates,
    status,
    discipline: discipline.discipline,
    hasParaTir: discipline.paraTir,
    organizerClub: text(organizer ?? null) || null,
    organizerEmail: email || null,
    mandateUrl: card.querySelector('.competition_item__mandat_btn')?.getAttribute('href') ?? null,
  };
}

export function parseCalendarPage(html: string): CalendarPage {
  const problems: string[] = [];
  const competitions = parse(html)
    .querySelectorAll('article.competition_item')
    .flatMap((card) => readCard(card, problems) ?? []);
  return { competitions, problems };
}

const sameEvent = (competition: ListedCompetition) =>
  [competition.title.toLowerCase(), competition.startDate, competition.town.toLowerCase()].join('|');

/**
 * The FFTA lists the Para-tir version of a competition as its own entry (same title, day and town). It becomes a flag
 * on the main one, which also takes its mandate if it has none. A Para-tir entry with no main one stays, flagged.
 */
export function mergeParaTir(listed: readonly ListedCompetition[]): ListedCompetition[] {
  const result = listed.filter((competition) => !competition.hasParaTir).map((competition) => ({ ...competition }));
  const main = new Map<string, ListedCompetition>();
  for (const competition of result) {
    if (!main.has(sameEvent(competition))) main.set(sameEvent(competition), competition);
  }
  for (const para of listed.filter((competition) => competition.hasParaTir)) {
    const match = main.get(sameEvent(para));
    if (!match) {
      result.push(para);
      continue;
    }
    match.hasParaTir = true;
    match.mandateUrl ??= para.mandateUrl;
  }
  return result;
}
