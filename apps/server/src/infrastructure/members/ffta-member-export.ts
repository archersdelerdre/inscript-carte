import type { MemberExportProblem, Sex } from '@inscript-carte/shared';
import { readSheet } from 'read-excel-file/node';

import type { Archer } from '../../domain/archer.ts';

const LICENCE_NUMBER = /^\d{7}[A-Z]$/;
/** "M DUPONT JEAN" / "Me DUPONT JEANNE": the export puts the civility before the name. */
const CIVILITY = /^(M|Me|Mme|Mlle)\s+/;
const SEX_BY_LABEL: Record<string, Sex> = { Masculin: 'male', Féminin: 'female' };

/** The export is refused as a whole. `detail` is a column title or a wrong value, never a name or a birth date. */
export class MemberExportError extends Error {
  readonly problem: MemberExportProblem;
  readonly line: number | null;
  readonly detail: string | null;

  constructor(problem: MemberExportProblem, message: string, line: number | null = null, detail: string | null = null) {
    super(line === null ? message : `Line ${line}: ${message}`);
    this.problem = problem;
    this.line = line;
    this.detail = detail;
  }
}

/** Reads the club member list exported from the FFTA extranet (first sheet of the .xlsx file, a path or its bytes). */
export async function readMemberExport(input: string | Buffer): Promise<Archer[]> {
  let rows: (readonly unknown[])[];
  try {
    rows = await readSheet(input);
  } catch {
    throw new MemberExportError('unreadable', 'The file is not an Excel (.xlsx) file.');
  }
  return parseMemberRows(rows);
}

/**
 * Only the fields the app needs are kept: the export also has postal addresses, which are left out on purpose.
 * Fails on the first unexpected value, with its line number, rather than importing a half-wrong member list.
 * Rows are `unknown`: every value is checked here (the library types date cells as `typeof Date`, not `Date`).
 */
export function parseMemberRows(rows: readonly (readonly unknown[])[]): Archer[] {
  const [header, ...lines] = rows;
  if (!header) throw new MemberExportError('empty', 'The member export is empty.');

  // Matched by the start of the title: the exported sheet may add a sort arrow ("Nom, Prénom↑").
  const column = (title: string) => {
    const index = header.findIndex((cell) => typeof cell === 'string' && cell.trim().startsWith(title));
    if (index === -1) {
      throw new MemberExportError('missing_column', `Column "${title}" not found in the member export.`, null, title);
    }
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
    if (!LICENCE_NUMBER.test(licenceNumber)) {
      throw new MemberExportError('invalid_licence', `invalid licence number "${licenceNumber}".`, line, licenceNumber);
    }
    if (seen.has(licenceNumber)) {
      throw new MemberExportError(
        'duplicate_licence',
        `licence number ${licenceNumber} appears twice.`,
        line,
        licenceNumber,
      );
    }
    seen.add(licenceNumber);

    const fullName = String(cell(columns.name) ?? '')
      .trim()
      .replace(CIVILITY, '');
    if (!fullName) throw new MemberExportError('missing_name', 'missing name.', line);

    const sexLabel = String(cell(columns.sex) ?? '').trim();
    const sex = SEX_BY_LABEL[sexLabel];
    if (!sex) throw new MemberExportError('unknown_sex', `unknown sex "${sexLabel}".`, line, sexLabel);

    const birthDate = cell(columns.birthDate);
    if (!(birthDate instanceof Date)) {
      throw new MemberExportError('invalid_birth_date', 'missing or invalid birth date.', line);
    }

    archers.push({
      licenceNumber,
      fullName,
      sex,
      // Excel dates are read at UTC midnight.
      birthDate: birthDate.toISOString().slice(0, 10),
      isActive: String(cell(columns.status) ?? '').trim() === 'Active',
    });
  });

  if (archers.length === 0) throw new MemberExportError('no_members', 'The member export has no members.');
  return archers;
}
