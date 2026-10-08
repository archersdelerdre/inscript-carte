import {
  BOW_TYPE_LABELS,
  categoryLabel,
  CLUB_NAME,
  departureTitle,
  DISTANCE_LABELS,
  type AgeCategory,
} from '@inscript-carte/shared';
import writeXlsxFile, { type Cell, type Row } from 'write-excel-file/node';

import type { Responsible } from '../../domain/archer.ts';
import { toFrenchDate } from '../../domain/calendar-date.ts';
import { departureLabel, type Competition } from '../../domain/competition.ts';
import { registrationPrice } from '../../domain/pricing.ts';
import type { RegistrationDetails } from '../../domain/registration-repository.ts';

const EUROS = '#,##0.00 "€"';

const BOLD = { fontWeight: 'bold' } as const;
const BOX = { borderStyle: 'thin' } as const;
const HEADER = { ...BOX, ...BOLD, align: 'center', alignVertical: 'center', wrap: true } as const;
const CENTERED = { ...BOX, align: 'center' } as const;

/** One line of the grid: an archer with one bow (a different bow on another départ makes another line). */
type ArcherLine = {
  fullName: string;
  licenceNumber: string;
  ageCategory: AgeCategory;
  category: string;
  bow: string;
  distance: string;
  trispot: boolean;
  departures: Set<number>;
};

/**
 * What each line pays: the archer's price for all their départs in the file, from the mandate, on their first line
 * (their other lines get `0`). `null` when the mandate gives no price for them: the cell stays empty.
 */
function amounts(lines: readonly ArcherLine[], competition: Competition): (number | null)[] {
  const departures = new Map<string, number>();
  for (const line of lines) {
    departures.set(line.licenceNumber, (departures.get(line.licenceNumber) ?? 0) + line.departures.size);
  }
  const priced = new Set<string>();
  return lines.map((line) => {
    if (priced.has(line.licenceNumber)) return 0;
    priced.add(line.licenceNumber);
    return registrationPrice(competition.prices, line.ageCategory, departures.get(line.licenceNumber)!);
  });
}

function amountCell(amount: number | null, style: Cell = {}): Cell {
  return amount === null ? { value: '', ...BOX, ...style } : { value: amount, format: EUROS, ...BOX, ...style };
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
  const lineAmounts = amounts(lines, competition);
  // Unknown for one archer: no total rather than a wrong one.
  const total = lineAmounts.includes(null) ? null : lineAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const header = [
    'NOM Prénom',
    'N° licence',
    'Catég.',
    "Type d'arc",
    ...(withDistance ? ['Distances'] : []),
    ...departures.map((departure) => departureTitle(departure, departureLabel(competition, departure))),
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
    ...lines.map((line, index): Row => [
      { value: line.fullName, ...BOX },
      { value: line.licenceNumber, ...BOX },
      { value: line.category, ...BOX },
      { value: line.bow, ...BOX },
      ...(withDistance ? [{ value: line.distance, ...BOX }] : []),
      ...departures.map((departure): Cell => ({ value: line.departures.has(departure) ? 'X' : '', ...CENTERED })),
      { value: line.trispot ? 'Oui' : 'Non', ...CENTERED },
      amountCell(lineAmounts[index]!),
    ]),
    [
      { value: 'Total', ...BOLD, ...BOX },
      ...header.slice(1, -1).map((): Cell => ({ value: '', ...BOX })),
      amountCell(total, BOLD),
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
      // Wider with the mandate's names ("Départ 2 · Après-midi" on two lines).
      ...departures.map(() => ({ width: competition.departures ? 14 : 10 })),
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
      ageCategory: registration.category,
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
