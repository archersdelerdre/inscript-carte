import { BOW_TYPE_LABELS, categoryLabel, CLUB_NAME, DISTANCE_LABELS } from '@inscript-carte/shared';
import writeXlsxFile, { type Row } from 'write-excel-file/node';

import { toFrenchDate } from '../../domain/calendar-date.ts';
import type { Competition } from '../../domain/competition.ts';
import type { RegistrationDetails } from '../../domain/registration-repository.ts';

const BOLD = { fontWeight: 'bold' } as const;

/** The club's list for one organizer, one row per départ, as an Excel file. */
export async function organizerSpreadsheet(
  competition: Competition,
  registrations: readonly RegistrationDetails[],
): Promise<Buffer> {
  const withDistance = competition.discipline === 'exterieur';
  const header = ['Départ', 'Nom et prénom', 'N° de licence', 'Catégorie', 'Arc', 'Trispot'];
  if (withDistance) header.push('Distances');

  const rows: Row[] = [
    [{ value: `${CLUB_NAME} – ${competition.title}`, ...BOLD }],
    [
      `${toFrenchDate(competition.startDate)}${competition.endDate === competition.startDate ? '' : ` au ${toFrenchDate(competition.endDate)}`}, ${competition.town}`,
    ],
    [],
    header.map((title) => ({ value: title, ...BOLD })),
    ...registrations.map(({ registration, fullName, sex }) => {
      const row: Row = [
        registration.departure,
        fullName,
        registration.archerLicenceNumber,
        categoryLabel(registration.category, sex),
        BOW_TYPE_LABELS[registration.bowType],
        registration.trispot ? 'Oui' : 'Non',
      ];
      if (withDistance) row.push(registration.distance ? DISTANCE_LABELS[registration.distance] : '');
      return row;
    }),
  ];

  return writeXlsxFile(rows, {
    sheet: 'Inscriptions',
    columns: [{ width: 8 }, { width: 32 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 9 }, { width: 16 }],
  }).toBuffer();
}
