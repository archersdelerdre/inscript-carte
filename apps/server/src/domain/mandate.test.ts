import { describe, expect, test } from 'bun:test';

import { checkMandateData, mandateAnswerJsonSchema } from './mandate.ts';

const COMPETITION = { startDate: '2026-10-31', endDate: '2026-11-01' };

const price = (amountEuros: number) => ({ audience: 'all' as const, departures: 1, amountEuros });

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

  test('keeps only the départs of the competition’s days: one mandate often covers two FFTA competitions', () => {
    const weekend = [
      { date: '2026-10-31', label: 'Samedi', registrationOpens: null, shootingStarts: '14:00' },
      { date: '2026-11-02', label: 'Lundi', registrationOpens: null, shootingStarts: null },
      { date: null, label: 'Départ Vegas', registrationOpens: null, shootingStarts: null },
    ];
    const check = checkMandateData(answer({ departures: weekend }), COMPETITION);
    expect(check.ok && check.data.departures.map(({ label }) => label)).toEqual(['Samedi', 'Départ Vegas']);

    // None of its days: that reading is not about this competition.
    expect(checkMandateData(answer({ departures: [weekend[1]] }), COMPETITION)).toEqual({
      ok: false,
      problems: ['Aucun départ du mandat ne tombe un jour du concours.'],
    });
  });

  test('keeps a price given twice with the same amount once, refuses two different amounts', () => {
    const same = checkMandateData(answer({ prices: [price(10), price(10)] }), COMPETITION);
    expect(same.ok && same.data.prices).toEqual([price(10)]);
    expect(checkMandateData(answer({ prices: [price(10), price(12)] }), COMPETITION)).toEqual({
      ok: false,
      problems: ['Tarif 2 : deux montants différents pour le même cas.'],
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
