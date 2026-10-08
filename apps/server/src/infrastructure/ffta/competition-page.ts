import type { Discipline } from '@inscript-carte/shared';
import { parse, type HTMLElement } from 'node-html-parser';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type { CompetitionStatus } from '../../domain/competition.ts';
import {
  departmentFromCommittee,
  departmentFromPostalCode,
  departmentFromRegionalCommittee,
} from './ffta-department.ts';
import { fftaDiscipline, fftaStatus, parseFftaDates, splitFftaTitle, textOf as text } from './ffta-values.ts';

/** Everything the detail page of a competition shows (`https://www.ffta.fr/epreuve/<id>`). */
export type CompetitionDetail = {
  fftaId: string;
  title: string;
  town: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  status: CompetitionStatus;
  discipline: Discipline;
  hasParaTir: boolean;
  /** "Individuel Tir à 18m 2027": the championship the competition counts for. */
  championship: string | null;
  hasDuels: boolean | null;
  regionalCommittee: string | null;
  departmentalCommittee: string | null;
  organizerClub: string | null;
  /** "GYMNASE ECHANNEAUX": the bold line(s) under "Lieu". */
  venue: string | null;
  streetLines: string[];
  postalCode: string | null;
  city: string | null;
  country: string | null;
  /** From the "Itinéraire Google" link, when the organizer placed the competition on the map. */
  position: { latitude: number; longitude: number } | null;
  /** The venue's postal code first (where the archers go), else the departmental committee, else (overseas only) the regional one. */
  departmentCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  mandateUrl: string | null;
};

export type CompetitionPage = { detail: CompetitionDetail | null; problems: string[] };

const POSTAL_LINE = /^(\d{5})\s+(.+)$/;
const GOOGLE_DESTINATION = /destination=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

/** "Discipline : <strong>Tir à 18m</strong>" → `{ Discipline: 'Tir à 18m' }`. */
function labelledValues(paragraphs: readonly HTMLElement[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const paragraph of paragraphs) {
    const label = /^([^:]{2,40}?)\s*:/.exec(text(paragraph))?.[1];
    if (label) values.set(label, text(paragraph.querySelector('strong')));
  }
  return values;
}

/** The lines after "Lieu : TOWN": venue (bold), street lines, "43110 AUREC SUR LOIRE", then the country. */
function readPlace(paragraphs: readonly HTMLElement[]) {
  const afterTown = paragraphs.slice(paragraphs.findIndex((paragraph) => text(paragraph).startsWith('Lieu')) + 1);
  const venue: string[] = [];
  const streetLines: string[] = [];
  let postal: RegExpExecArray | null = null;
  let country: string | null = null;
  for (const paragraph of afterTown) {
    const line = text(paragraph);
    if (!line) continue;
    const isBold = text(paragraph.querySelector('strong')) === line;
    const postalLine = POSTAL_LINE.exec(line);
    if (postal) country ??= line;
    else if (postalLine) postal = postalLine;
    else if (isBold && streetLines.length === 0) venue.push(line);
    else streetLines.push(line);
  }
  return {
    venue: venue.join(', ') || null,
    streetLines,
    postalCode: postal?.[1] ?? null,
    city: postal?.[2] ?? null,
    country,
  };
}

function readPosition(detail: HTMLElement): CompetitionDetail['position'] {
  const match = GOOGLE_DESTINATION.exec(detail.querySelector('a[href*="google.com/maps"]')?.getAttribute('href') ?? '');
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  // "0,0" is what an empty map field gives: in the Atlantic, not a place.
  const valid = Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  return valid ? { latitude, longitude } : null;
}

/** The "Tel / Mail / Site" buttons: their visible text is the value. */
function link(detail: HTMLElement, label: string): string | null {
  const row = detail.querySelectorAll('.competition_detail__links > div').find((div) => text(div).startsWith(label));
  return text(row?.querySelector('a')) || null;
}

/** `detail` is `null` (with problems) when the page is not a competition the app can show. */
export function parseCompetitionPage(fftaId: string, html: string): CompetitionPage {
  const problems: string[] = [];
  const root = parse(html);
  const detail = root.querySelector('article.competition_detail');
  if (!detail) return { detail: null, problems: [`${fftaId} : page sans fiche de compétition`] };

  const fullTitle = text(root.querySelector('h1'));
  const titled = splitFftaTitle(fullTitle);
  const dates = parseFftaDates(text(detail.querySelector('.competition_detail__dates')));
  const status = fftaStatus(detail.querySelector('.competition_detail__badge')?.classList.value ?? []);
  const paragraphs = detail.querySelectorAll('.competition_detail__infos p');
  const values = labelledValues(paragraphs);
  const disciplineLabel = values.get('Discipline') ?? '';
  const discipline = fftaDiscipline(disciplineLabel);

  if (!titled) problems.push(`${fftaId} : titre sans « à VILLE » : ${fullTitle}`);
  if (!dates)
    problems.push(`${fftaId} : dates illisibles : ${text(detail.querySelector('.competition_detail__dates'))}`);
  if (!status) problems.push(`${fftaId} : statut inconnu`);
  if (!discipline) problems.push(`${fftaId} : discipline inconnue : ${disciplineLabel}`);
  if (!titled || !dates || !status || !discipline) return { detail: null, problems };

  const place = readPlace(paragraphs);
  const regionalCommittee = values.get('Comité régional') || null;
  const departmentalCommittee = values.get('Comité départemental') || null;
  const departmentCode =
    (place.postalCode && departmentFromPostalCode(place.postalCode)) ||
    (departmentalCommittee && departmentFromCommittee(departmentalCommittee)) ||
    (regionalCommittee && departmentFromRegionalCommittee(regionalCommittee)) ||
    null;
  const duels = values.get('Duels');

  return {
    detail: {
      fftaId,
      ...titled,
      ...dates,
      status,
      discipline: discipline.discipline,
      hasParaTir: discipline.paraTir,
      championship: values.get('Championnat') || null,
      hasDuels: duels === undefined ? null : duels === 'Oui',
      regionalCommittee,
      departmentalCommittee,
      organizerClub: values.get('Organisateur') || null,
      ...place,
      position: readPosition(detail),
      departmentCode,
      phone: link(detail, 'Tel'),
      email: link(detail, 'Mail'),
      website: link(detail, 'Site'),
      mandateUrl: detail.querySelector('.competition_detail__mandat_btn')?.getAttribute('href') ?? null,
    },
    problems,
  };
}
