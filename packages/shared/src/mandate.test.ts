import { expect, test } from 'bun:test';

import { categoriesLabel } from './mandate.ts';

test('names a price’s categories the way mandates do', () => {
  expect(categoriesLabel(['S3', 'S1', 'U11', 'U13', 'U15', 'U18', 'U21', 'S2'])).toBe('Tous');
  expect(categoriesLabel(['S1', 'S2', 'S3'])).toBe('Adultes');
  expect(categoriesLabel(['U11', 'U13', 'U15', 'U18', 'U21'])).toBe('Jeunes (U11 à U21)');
  expect(categoriesLabel(['U21', 'U13', 'U15', 'U18'])).toBe('Jeunes (U13 à U21)');
  expect(categoriesLabel(['U11'])).toBe('U11');
  expect(categoriesLabel(['U11', 'U15'])).toBe('U11, U15');
  expect(categoriesLabel(['U21', 'S1'])).toBe('U21, S1');
});
