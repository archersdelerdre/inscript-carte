import { describe, expect, test } from 'bun:test';

import {
  departmentFromCommittee,
  departmentFromPostalCode,
  departmentFromRegionalCommittee,
} from './ffta-department.ts';

describe('departmentFromPostalCode', () => {
  test('takes two digits, three overseas, and splits Corsica', () => {
    expect(departmentFromPostalCode('44800')).toBe('44');
    expect(departmentFromPostalCode('01000')).toBe('01');
    expect(departmentFromPostalCode('97200')).toBe('972');
    expect(departmentFromPostalCode('98800')).toBe('988');
    expect(departmentFromPostalCode('20090')).toBe('2A');
    expect(departmentFromPostalCode('20200')).toBe('2B');
  });

  test('refuses codes no département has', () => {
    expect(departmentFromPostalCode('98000')).toBeNull(); // Monaco
    expect(departmentFromPostalCode('4480')).toBeNull();
    expect(departmentFromPostalCode('ABCDE')).toBeNull();
  });
});

describe('departmentFromCommittee', () => {
  test('reads the names the FFTA writes, keeping the longest match', () => {
    expect(departmentFromCommittee('COMITE DEPARTEMENTAL DE LA HAUTE LOIRE')).toBe('43');
    expect(departmentFromCommittee('COMITE DEPARTEMENTAL LOIRE')).toBe('42');
    expect(departmentFromCommittee('COMITE DEPARTEMENTAL LOT ET GARONNE')).toBe('47');
    expect(departmentFromCommittee("C.D. TIR A L'ARC ESSONNE")).toBe('91');
    expect(departmentFromCommittee("COMITE DEPARTEMENTAL VAL D'OISE")).toBe('95');
    expect(departmentFromCommittee('COMITE DEPARTEMENTAL TERRITOIRE DE BELFORT')).toBe('90');
  });
});

describe('departmentFromRegionalCommittee', () => {
  test('reads only overseas regions, which are one département', () => {
    expect(departmentFromRegionalCommittee('COMITE REGIONAL DE LA MARTINIQUE')).toBe('972');
    expect(departmentFromRegionalCommittee('COMITE REGIONAL DES PAYS DE LA LOIRE')).toBeNull();
    expect(departmentFromRegionalCommittee('COMITE REGIONAL DU CENTRE VAL DE LOIRE')).toBeNull();
    expect(departmentFromRegionalCommittee('COMITE REGIONAL DE NOUVELLE AQUITAINE')).toBeNull();
  });
});
