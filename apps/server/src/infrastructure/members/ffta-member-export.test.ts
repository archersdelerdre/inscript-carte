import { describe, expect, test } from 'bun:test';

import { parseMemberRows } from './ffta-member-export.ts';

// Made-up members, laid out like the FFTA extranet export.
const HEADER = [
  'N°',
  'Nom, Prénom↑',
  'Sexe',
  'Date de naissance',
  'Etat',
  'Licence',
  'Activité',
  'Catégorie',
  'Prise le',
  'CP, Ville',
];
const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
const row = (licence: string, name: string, sex: string, birth: string, status = 'Active') => [
  licence,
  name,
  sex,
  date(birth),
  status,
  null,
  null,
  null,
  date('2026-09-06'),
  '44000, NANTES',
];

describe('parseMemberRows', () => {
  test('keeps licence, name without civility, sex, birth date and status; drops the address', () => {
    const archers = parseMemberRows([
      HEADER,
      row('0123456A', 'M DUPONT JEAN PIERRE', 'Masculin', '1980-05-12'),
      row('7654321B', 'Me MARTIN CLAIRE', 'Féminin', '2012-01-31', 'Inactive'),
    ]);

    expect(archers).toEqual([
      {
        licenceNumber: '0123456A',
        fullName: 'DUPONT JEAN PIERRE',
        sex: 'male',
        birthDate: '1980-05-12',
        isActive: true,
      },
      { licenceNumber: '7654321B', fullName: 'MARTIN CLAIRE', sex: 'female', birthDate: '2012-01-31', isActive: false },
    ]);
  });

  test('skips empty rows', () => {
    expect(
      parseMemberRows([HEADER, row('0123456A', 'M DUPONT JEAN', 'Masculin', '1980-05-12'), HEADER.map(() => null)]),
    ).toHaveLength(1);
  });

  test('refuses a file that is not the member export, or has no members', () => {
    expect(() =>
      parseMemberRows([
        ['Nom', 'Prénom'],
        ['DUPONT', 'JEAN'],
      ]),
    ).toThrow(/Column "N°" not found/);
    expect(() => parseMemberRows([HEADER])).toThrow(/no members/);
  });

  test('refuses bad rows with their line number instead of importing a half-wrong list', () => {
    expect(() => parseMemberRows([HEADER, row('123456A', 'M DUPONT JEAN', 'Masculin', '1980-05-12')])).toThrow(
      /Line 2: invalid licence number/,
    );
    expect(() =>
      parseMemberRows([
        HEADER,
        row('0123456A', 'M DUPONT JEAN', 'Masculin', '1980-05-12'),
        row('0123456A', 'M DUPONT PAUL', 'Masculin', '1982-05-12'),
      ]),
    ).toThrow(/Line 3: licence number 0123456A appears twice/);
    expect(() => parseMemberRows([HEADER, row('0123456A', 'M DUPONT JEAN', 'Autre', '1980-05-12')])).toThrow(
      /Line 2: unknown sex/,
    );
  });
});
