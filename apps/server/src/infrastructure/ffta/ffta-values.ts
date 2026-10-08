import type { Discipline } from '@inscript-carte/shared';
import type { HTMLElement } from 'node-html-parser';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type { CompetitionStatus } from '../../domain/competition.ts';

/** How the FFTA writes the same things on its list and detail pages (www.ffta.fr, 2026-10). */

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

/** `undefined` for a label the FFTA added since: reported, never guessed. */
export function fftaDiscipline(label: string): { discipline: Discipline; paraTir: boolean } | undefined {
  return DISCIPLINES[label.trim().toLowerCase()];
}

/** The status class ends the same on both pages: `…--valid`, `…--report`, `…--cancel`. */
export function fftaStatus(classNames: readonly string[]): CompetitionStatus | undefined {
  for (const name of classNames) {
    if (name.endsWith('--valid')) return 'scheduled';
    if (name.endsWith('--report')) return 'postponed';
    if (name.endsWith('--cancel')) return 'cancelled';
  }
  return undefined;
}

const DATES =
  /^(?:le (\d{1,2}) (\p{L}+) (\d{4})|du (\d{1,2})(?: (\p{L}+))?(?: (\d{4}))? au (\d{1,2}) (\p{L}+) (\d{4}))$/u;

function isoDate(year: number, month: number, day: number): CalendarDate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "Le 14 novembre 2026", "Du 09 au 11 octobre 2026", "Du 31 octobre au 01 novembre 2026" or "Du 30 octobre 2026 au
 * 02 mars 2027". Without its own year, a start month after the end month is in the year before (December → January).
 */
export function parseFftaDates(text: string): { startDate: CalendarDate; endDate: CalendarDate } | null {
  const match = DATES.exec(text.trim().replace(/\s+/g, ' ').toLowerCase());
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

/** "CONCOURS SALLE à SAINT HERBLAIN": the town is what follows the last " à ". `null` without one. */
export function splitFftaTitle(fullTitle: string): { title: string; town: string } | null {
  const at = fullTitle.lastIndexOf(' à ');
  return at < 0 ? null : { title: fullTitle.slice(0, at).trim(), town: fullTitle.slice(at + 3).trim() };
}

export function textOf(element: HTMLElement | null | undefined): string {
  return element?.textContent.replace(/\s+/g, ' ').trim() ?? '';
}
