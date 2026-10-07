import { describe, expect, test } from 'bun:test';

import { ageCategory } from './ffta-category.ts';

describe('ageCategory', () => {
  // Every row of the FFTA table for the 2026-2027 season ("âge en 2027"), at both edges of each range.
  test.each([
    [2017, 'U11'],
    [2016, 'U13'],
    [2015, 'U13'],
    [2014, 'U15'],
    [2013, 'U15'],
    [2012, 'U18'],
    [2010, 'U18'],
    [2009, 'U21'],
    [2007, 'U21'],
    [2006, 'S1'],
    [1988, 'S1'],
    [1987, 'S2'],
    [1968, 'S2'],
    [1967, 'S3'],
  ] as const)('born in %i: %s for a competition of the 2026-2027 season', (birthYear, category) => {
    expect(ageCategory(birthYear, '2027-01-09')).toBe(category);
  });

  test('a new season starts on 1 September', () => {
    // Born 2006: still U21 in the 2025-2026 season (age 20 in 2026), Senior 1 from the 2026-2027 season.
    expect(ageCategory(2006, '2026-08-31')).toBe('U21');
    expect(ageCategory(2006, '2026-09-01')).toBe('S1');
  });
});
