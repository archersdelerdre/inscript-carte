import { expect, test } from 'bun:test';

import { checkDepartmentPosition } from './department-area.ts';

const GROSBREUIL = { latitude: 46.54, longitude: -1.61 };

test('keeps a point inside its département’s area, mainland, Corsica or overseas', () => {
  expect(checkDepartmentPosition(GROSBREUIL, '85')).toEqual({ position: GROSBREUIL, swapped: false });
  expect(checkDepartmentPosition({ latitude: 41.93, longitude: 8.74 }, '2A')?.swapped).toBe(false);
  expect(checkDepartmentPosition({ latitude: -21.11, longitude: 55.53 }, '974')?.swapped).toBe(false);
  expect(checkDepartmentPosition({ latitude: 16.24, longitude: -61.53 }, '971')?.swapped).toBe(false);
});

test('swaps back a point whose latitude and longitude were typed the wrong way round', () => {
  expect(checkDepartmentPosition({ latitude: -1.61, longitude: 46.54 }, '85')).toEqual({
    position: GROSBREUIL,
    swapped: true,
  });
});

test('drops a point that fits neither way, or that belongs to another area', () => {
  // Helsinki, either way round.
  expect(checkDepartmentPosition({ latitude: 60.17, longitude: 24.94 }, '85')).toBeNull();
  // A mainland point for a Réunion competition.
  expect(checkDepartmentPosition(GROSBREUIL, '974')).toBeNull();
});
