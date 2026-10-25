import { describe, expect, test } from 'bun:test';

import type { AgeCategory } from './ffta-category.ts';
import type { MandatePrice } from './mandate.ts';
import { registrationPrice } from './pricing.ts';

const YOUTH: AgeCategory[] = ['U11', 'U13', 'U15', 'U18', 'U21'];
const ADULTS: AgeCategory[] = ['S1', 'S2', 'S3'];
const ALL: AgeCategory[] = [...YOUTH, ...ADULTS];

/** La Haye-Fouassière, 2026-10-25, as GLM read it. */
const DEGRESSIVE: MandatePrice[] = [
  { categories: ADULTS, departures: 1, amountEuros: 9 },
  { categories: ADULTS, departures: 2, amountEuros: 16 },
  { categories: YOUTH, departures: 1, amountEuros: 6.5 },
  { categories: YOUTH, departures: 2, amountEuros: 10 },
];

describe('registrationPrice', () => {
  test('takes the price naming the archer’s category, for that number of départs', () => {
    expect(registrationPrice(DEGRESSIVE, 'S1', 1)).toBe(9);
    expect(registrationPrice(DEGRESSIVE, 'S3', 2)).toBe(16);
    expect(registrationPrice(DEGRESSIVE, 'U11', 1)).toBe(6.5);
    expect(registrationPrice(DEGRESSIVE, 'U21', 2)).toBe(10);
  });

  test('adds the biggest offers that fit when the mandate stops before', () => {
    expect(registrationPrice(DEGRESSIVE, 'S2', 3)).toBe(25);
    expect(registrationPrice(DEGRESSIVE, 'U15', 4)).toBe(20);
  });

  test('the most specific price wins when several name the category', () => {
    // Montureux-et-Prantigny, 2026-10-11: « U11 + Promotion 6 € / 8 €, Jeunes 8 € / 10 €, Adultes 10 € / 14 € ».
    const withU11: MandatePrice[] = [
      ...DEGRESSIVE,
      { categories: ['U11'], departures: 1, amountEuros: 6 },
      { categories: ['U11'], departures: 2, amountEuros: 8 },
      { categories: ALL, departures: 1, amountEuros: 12 },
    ];
    expect(registrationPrice(withU11, 'U11', 2)).toBe(8);
    expect(registrationPrice(withU11, 'U13', 2)).toBe(10);
    expect(registrationPrice(withU11, 'S1', 1)).toBe(9);
  });

  test('a price for everyone serves the categories nothing more specific names', () => {
    const everyone: MandatePrice[] = [
      { categories: ALL, departures: 1, amountEuros: 8 },
      { categories: ['U13', 'U15'], departures: 1, amountEuros: 5 },
    ];
    expect(registrationPrice(everyone, 'S1', 2)).toBe(16);
    expect(registrationPrice(everyone, 'U15', 2)).toBe(10);
    expect(registrationPrice(everyone, 'U18', 1)).toBe(8);
  });

  test('never guesses: no prices, or nothing that fits, gives no amount', () => {
    expect(registrationPrice(null, 'S1', 1)).toBeNull();
    expect(registrationPrice([{ categories: ADULTS, departures: 2, amountEuros: 16 }], 'S1', 1)).toBeNull();
    expect(registrationPrice([{ categories: YOUTH, departures: 1, amountEuros: 5 }], 'S1', 1)).toBeNull();
  });
});
