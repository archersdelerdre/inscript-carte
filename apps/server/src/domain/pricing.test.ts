import { describe, expect, test } from 'bun:test';

import type { MandatePrice } from '@inscript-carte/shared';

import { registrationPrice } from './pricing.ts';

/** La Haye-Fouassière, 2026-10-25, as GLM read it. */
const DEGRESSIVE: MandatePrice[] = [
  { audience: 'adult', departures: 1, amountEuros: 9 },
  { audience: 'adult', departures: 2, amountEuros: 16 },
  { audience: 'youth', departures: 1, amountEuros: 6.5 },
  { audience: 'youth', departures: 2, amountEuros: 10 },
];

describe('registrationPrice', () => {
  test('takes the price for that number of départs, youth for every Uxx category', () => {
    expect(registrationPrice(DEGRESSIVE, 'S1', 1)).toBe(9);
    expect(registrationPrice(DEGRESSIVE, 'S3', 2)).toBe(16);
    expect(registrationPrice(DEGRESSIVE, 'U11', 1)).toBe(6.5);
    expect(registrationPrice(DEGRESSIVE, 'U21', 2)).toBe(10);
  });

  test('adds the biggest offers that fit when the mandate stops before', () => {
    expect(registrationPrice(DEGRESSIVE, 'S2', 3)).toBe(25);
    expect(registrationPrice(DEGRESSIVE, 'U15', 4)).toBe(20);
  });

  test('uses the price for everyone when the archer’s audience has none', () => {
    const everyone: MandatePrice[] = [
      { audience: 'all', departures: 1, amountEuros: 8 },
      { audience: 'youth', departures: 1, amountEuros: 5 },
    ];
    expect(registrationPrice(everyone, 'S1', 2)).toBe(16);
    expect(registrationPrice(everyone, 'U18', 2)).toBe(10);
  });

  test('never guesses: no prices, or nothing that fits, gives no amount', () => {
    expect(registrationPrice(null, 'S1', 1)).toBeNull();
    expect(registrationPrice([{ audience: 'adult', departures: 2, amountEuros: 16 }], 'S1', 1)).toBeNull();
    expect(registrationPrice([{ audience: 'youth', departures: 1, amountEuros: 5 }], 'S1', 1)).toBeNull();
  });
});
