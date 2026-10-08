import { describe, expect, test } from 'bun:test';

import { checkMandateData, mandateAnswerJsonSchema } from './mandate.ts';

const COMPETITION = { startDate: '2026-10-31', endDate: '2026-11-01' };

const answer = (overrides: Record<string, unknown> = {}) => ({
  departures: [
    { date: '2026-10-31', label: 'Samedi après-midi', registrationOpens: '13:30', shootingStarts: '14:30' },
    { date: '2026-11-01', label: 'Dimanche matin', registrationOpens: null, shootingStarts: '09:00' },
  ],
  prices: [
    { audience: 'adult', departures: 1, amountEuros: 10 },
    { audience: 'youth', departures: 1, amountEuros: 7 },
  ],
  foamTargets: 'not_mentioned',
  evidence: { departures: null, prices: 'jeunes 7€ - adultes 10€', foamTargets: null },
  ...overrides,
});

describe('checkMandateData', () => {
  test('keeps a reading that holds together', () => {
    expect(checkMandateData(answer(), COMPETITION)).toEqual({ ok: true, data: answer() as never });
  });

  test('accepts a mandate that gives no départ and no price (not every mandate has them)', () => {
    expect(checkMandateData(answer({ departures: [], prices: [] }), COMPETITION).ok).toBe(true);
  });

  test('refuses a day outside the competition and a price given twice', () => {
    const check = checkMandateData(
      answer({
        departures: [{ date: '2026-11-02', label: 'Lundi', registrationOpens: null, shootingStarts: null }],
        prices: [
          { audience: 'adult', departures: 2, amountEuros: 16 },
          { audience: 'adult', departures: 2, amountEuros: 18 },
        ],
      }),
      COMPETITION,
    );
    expect(check).toEqual({
      ok: false,
      problems: ['Départ 1 : le 2026-11-02 n’est pas un jour du concours.', 'Tarif 2 : donné deux fois.'],
    });
  });

  test('refuses out-of-range values and unknown answers', () => {
    for (const overrides of [
      { prices: [{ audience: 'adult', departures: 1, amountEuros: 900 }] },
      { prices: [{ audience: 'seniors', departures: 1, amountEuros: 9 }] },
      { prices: [{ audience: 'adult', departures: 0, amountEuros: 9 }] },
      { departures: [{ date: null, label: 'Matin', registrationOpens: '25:00', shootingStarts: null }] },
      { departures: [{ date: null, label: '  ', registrationOpens: null, shootingStarts: null }] },
      { foamTargets: 'maybe' },
      { extra: 'field' },
    ]) {
      expect(checkMandateData(answer(overrides), COMPETITION).ok).toBe(false);
    }
    expect(checkMandateData('Voici les informations…', COMPETITION).ok).toBe(false);
  });

  test('tells the LLM the same shape, with every field required and nothing else allowed', () => {
    expect(mandateAnswerJsonSchema).toMatchObject({
      type: 'object',
      required: ['departures', 'prices', 'foamTargets', 'evidence'],
      additionalProperties: false,
    });
  });
});
