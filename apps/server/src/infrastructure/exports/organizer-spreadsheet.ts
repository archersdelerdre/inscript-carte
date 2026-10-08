import { BOW_TYPE_LABELS, categoryLabel, CLUB_NAME, DISTANCE_LABELS } from '@inscript-carte/shared';
import writeXlsxFile, { type Cell, type Row } from 'write-excel-file/node';

import type { Responsible } from '../../domain/archer.ts';
import { toFrenchDate } from '../../domain/calendar-date.ts';
import type { Competition } from '../../domain/competition.ts';
import type { RegistrationDetails } from '../../domain/registration-repository.ts';

/** Not known yet: the price will come from the FFTA mandate once the scraper reads it. */
const PRICE_PER_DEPARTURE = 0;
const EUROS = '#,##0.00 "€"';

const BOLD = { fontWeight: 'bold' } as const;
const BOX = { borderStyle: 'thin' } as const;
const HEADER = { ...BOX, ...BOLD, align: 'center', alignVertical: 'center', wrap: true } as const;
const CENTERED = { ...BOX, align: 'center' } as const;

/** One line of the grid: an archer with one bow (a different bow on another départ makes another line). */
type ArcherLine = {
  fullName: string;
  licenceNumber: string;
  category: string;
  bow: string;
  distance: string;
  trispot: boolean;
  departures: Set<number>;
};

function amountOf(line: ArcherLine): number {
  return line.departures.size * PRICE_PER_DEPARTURE;
}

/**
 * The club's list for one organizer as an Excel file, laid out like the registration grid of the FFTA mandates:
 * club and contact on top, then one line per archer with a column per départ ("X"), trispot and amount.
 */
export async function organizerSpreadsheet(
  competition: Competition,
  registrations: readonly RegistrationDetails[],
  responsible: Responsible,
): Promise<Buffer> {
  const withDistance = competition.discipline === 'exterieur';
  const departures = [...new Set(registrations.map(({ registration }) => registration.departure))].toSorted(
    (a, b) => a - b,
  );
  const lines = archerLines(registrations);
  const header = [
    'NOM Prénom',
    'N° licence',
    'Catég.',
    "Type d'arc",
    ...(withDistance ? ['Distances'] : []),
    ...departures.map((departure) => `Départ ${departure}`),
    'Trispot',
    'Montant',
  ];
  const dates = `${toFrenchDate(competition.startDate)}${competition.endDate === competition.startDate ? '' : ` au ${toFrenchDate(competition.endDate)}`}`;

  const rows: Row[] = [
    [{ value: competition.title, ...BOLD, fontSize: 14 }],
    [`${dates}, ${competition.town}`],
    [],
    [{ value: 'Nom du club :', ...BOLD }, CLUB_NAME],
    // The admin who makes the file is the club's contact; email and phone stay empty until stored for them.
    [{ value: 'Responsable :', ...BOLD }, responsible.fullName],
    [{ value: 'Email :', ...BOLD }, responsible.email ?? ''],
    [{ value: 'Tél :', ...BOLD }, responsible.phone ?? ''],
    [],
    header.map((title): Cell => ({ value: title, ...HEADER })),
    ...lines.map((line): Row => [
      { value: line.fullName, ...BOX },
      { value: line.licenceNumber, ...BOX },
      { value: line.category, ...BOX },
      { value: line.bow, ...BOX },
      ...(withDistance ? [{ value: line.distance, ...BOX }] : []),
      ...departures.map((departure): Cell => ({ value: line.departures.has(departure) ? 'X' : '', ...CENTERED })),
      { value: line.trispot ? 'Oui' : 'Non', ...CENTERED },
      { value: amountOf(line), format: EUROS, ...BOX },
    ]),
    [
      { value: 'Total', ...BOLD, ...BOX },
      ...header.slice(1, -1).map((): Cell => ({ value: '', ...BOX })),
      { value: lines.reduce((total, line) => total + amountOf(line), 0), format: EUROS, ...BOLD, ...BOX },
    ],
  ];

  return writeXlsxFile(rows, {
    sheet: 'Inscriptions',
    columns: [
      { width: 30 },
      { width: 13 },
      { width: 18 },
      { width: 14 },
      ...(withDistance ? [{ width: 16 }] : []),
      ...departures.map(() => ({ width: 10 })),
      { width: 9 },
      { width: 12 },
    ],
  }).toBuffer();
}

/** By name, then first départ. The rows come one per départ; the grid wants one per archer and bow. */
function archerLines(registrations: readonly RegistrationDetails[]): ArcherLine[] {
  const lines = new Map<string, ArcherLine>();
  for (const { registration, fullName, sex } of registrations) {
    const key = [
      registration.archerLicenceNumber,
      registration.bowType,
      registration.trispot,
      registration.distance,
    ].join('|');
    const known = lines.get(key);
    if (known) {
      known.departures.add(registration.departure);
      continue;
    }
    lines.set(key, {
      fullName,
      licenceNumber: registration.archerLicenceNumber,
      category: categoryLabel(registration.category, sex),
      bow: BOW_TYPE_LABELS[registration.bowType],
      distance: registration.distance ? DISTANCE_LABELS[registration.distance] : '',
      trispot: registration.trispot,
      departures: new Set([registration.departure]),
    });
  }
  return [...lines.values()].toSorted(
    (a, b) => a.fullName.localeCompare(b.fullName, 'fr') || Math.min(...a.departures) - Math.min(...b.departures),
  );
}
