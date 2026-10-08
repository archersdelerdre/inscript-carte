import type { Discipline } from '@inscript-carte/shared';
import { parse, type HTMLElement } from 'node-html-parser';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type { CompetitionStatus } from '../../domain/competition.ts';
import { fftaDiscipline, fftaStatus, parseFftaDates, splitFftaTitle, textOf as text } from './ffta-values.ts';

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

/** `null` (with a problem) when a card cannot be read: one odd card never stops the whole page. */
function readCard(card: HTMLElement, problems: string[]): ListedCompetition | null {
  const link = card.querySelector('.competition_item__title a');
  const fftaId = /\/epreuve\/(\d+)/.exec(link?.getAttribute('href') ?? '')?.[1];
  if (!fftaId) {
    problems.push('Carte sans lien /epreuve/<id>');
    return null;
  }
  const fullTitle = text(link);
  const titled = splitFftaTitle(fullTitle);
  const dates = parseFftaDates(text(card.querySelector('.competition_item__dates')));
  const disciplineLabel = text(card.querySelector('.field--name-field-discipline'));
  const discipline = fftaDiscipline(disciplineLabel);
  const head = card.querySelector('.competition_item__head');
  const status = fftaStatus(head?.classList.value ?? []);

  if (!titled) problems.push(`${fftaId} : titre sans « à VILLE » : ${fullTitle}`);
  if (!dates) problems.push(`${fftaId} : dates illisibles : ${text(card.querySelector('.competition_item__dates'))}`);
  if (!discipline) problems.push(`${fftaId} : discipline inconnue : ${disciplineLabel}`);
  if (!status) problems.push(`${fftaId} : statut inconnu : ${head?.classList.value.join(' ') ?? '(aucun)'}`);
  if (!titled || !dates || !discipline || !status) return null;

  // "LA FLECHE ROCHEFORTAISE <small>(ROCHEFORT DU GARD)</small>": the club, then the club's town.
  const organizer = card
    .querySelectorAll('.competition_item__infos > span')
    .find((span) => !span.querySelector('.field'));
  organizer?.querySelector('small')?.remove();
  const email = card.querySelector('a[href^="mailto:"]')?.getAttribute('href')?.slice('mailto:'.length).trim();

  return {
    fftaId,
    ...titled,
    ...dates,
    status,
    discipline: discipline.discipline,
    hasParaTir: discipline.paraTir,
    organizerClub: text(organizer) || null,
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
