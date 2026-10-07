import type { Sex } from '@inscript-carte/shared';
import { readSheet } from 'read-excel-file/node';

import type { Archer } from '../../domain/archer.ts';

const LICENCE_NUMBER = /^\d{7}[A-Z]$/;
/** "M DUPONT JEAN" / "Me DUPONT JEANNE": the export puts the civility before the name. */
const CIVILITY = /^(M|Me|Mme|Mlle)\s+/;
const SEX_BY_LABEL: Record<string, Sex> = { Masculin: 'male', Féminin: 'female' };

/** Reads the club member list exported from the FFTA extranet (first sheet of the .xlsx file). */
export async function readMemberExport(path: string): Promise<Archer[]> {
  return parseMemberRows(await readSheet(path));
}

/**
 * Only the fields the app needs are kept: the export also has postal addresses, which are left out on purpose.
 * Fails on the first unexpected value, with its line number, rather than importing a half-wrong member list.
 * Rows are `unknown`: every value is checked here (the library types date cells as `typeof Date`, not `Date`).
 */
export function parseMemberRows(rows: readonly (readonly unknown[])[]): Archer[] {
  const [header, ...lines] = rows;
  if (!header) throw new Error('The member export is empty.');

  // Matched by the start of the title: the exported sheet may add a sort arrow ("Nom, Prénom↑").
  const column = (title: string) => {
    const index = header.findIndex((cell) => typeof cell === 'string' && cell.trim().startsWith(title));
    if (index === -1) throw new Error(`Column "${title}" not found in the member export.`);
    return index;
  };
  const columns = {
    licence: column('N°'),
    name: column('Nom, Prénom'),
    sex: column('Sexe'),
    birthDate: column('Date de naissance'),
    status: column('Etat'),
  };

  const archers: Archer[] = [];
  const seen = new Set<string>();
  lines.forEach((row, index) => {
    if (row.every((cell) => cell === null)) return;
    const line = index + 2;
    const cell = (columnIndex: number) => row[columnIndex] ?? null;

    const licenceNumber = String(cell(columns.licence) ?? '')
      .trim()
      .toUpperCase();
    if (!LICENCE_NUMBER.test(licenceNumber))
      throw new Error(`Line ${line}: invalid licence number "${licenceNumber}".`);
    if (seen.has(licenceNumber)) throw new Error(`Line ${line}: licence number ${licenceNumber} appears twice.`);
    seen.add(licenceNumber);

    const fullName = String(cell(columns.name) ?? '')
      .trim()
      .replace(CIVILITY, '');
    if (!fullName) throw new Error(`Line ${line}: missing name.`);

    const sex = SEX_BY_LABEL[String(cell(columns.sex) ?? '').trim()];
    if (!sex) throw new Error(`Line ${line}: unknown sex "${String(cell(columns.sex))}".`);

    const birthDate = cell(columns.birthDate);
    if (!(birthDate instanceof Date)) throw new Error(`Line ${line}: missing or invalid birth date.`);

    archers.push({
      licenceNumber,
      fullName,
      sex,
      // Excel dates are read at UTC midnight.
      birthDate: birthDate.toISOString().slice(0, 10),
      isActive: String(cell(columns.status) ?? '').trim() === 'Active',
    });
  });

  if (archers.length === 0) throw new Error('The member export has no members.');
  return archers;
}
