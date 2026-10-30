import { describe, expect, test } from 'bun:test';

import type { MandateDeparture } from '@inscript-carte/shared';

import { checkMandateData, datedDepartures, inscriptarcUrlOf, mandateAnswerJsonSchema, rhythmsOf } from './mandate.ts';

const COMPETITION = { startDate: '2026-10-31', endDate: '2026-11-01' };

const ALL = ['U11', 'U13', 'U15', 'U18', 'U21', 'S1', 'S2', 'S3'];
const price = (amountEuros: number, categories: string[] = ALL) => ({ categories, departures: 1, amountEuros });

const answer = (overrides: Record<string, unknown> = {}) => ({
  departures: [
    { date: '2026-10-31', label: 'Samedi après-midi', registrationOpens: '13:30', shootingStarts: '14:30' },
    { date: '2026-11-01', label: 'Dimanche matin', registrationOpens: null, shootingStarts: '09:00' },
  ],
  prices: [
    { categories: ['S1', 'S2', 'S3'], departures: 1, amountEuros: 10 },
    { categories: ['U11', 'U13', 'U15', 'U18', 'U21'], departures: 1, amountEuros: 7 },
  ],
  foamTargets: 'not_mentioned',
  rhythms: ['AB/CD'],
  rhythmsAreAlternatives: false,
  evidence: { departures: null, prices: 'jeunes 7€ - adultes 10€', foamTargets: null, rhythm: 'Rythme AB/CD' },
  ...overrides,
});

describe('checkMandateData', () => {
  test('keeps a reading that holds together', () => {
    expect(checkMandateData(answer(), COMPETITION)).toEqual({ ok: true, data: answer() as never, problems: [] });
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

  test('keeps a price given twice once, in the categories’ order', () => {
    const same = checkMandateData(answer({ prices: [price(10, ['S3', 'S1']), price(10, ['S1', 'S3'])] }), COMPETITION);
    expect(same.ok && same.data.prices).toEqual([{ categories: ['S1', 'S3'], departures: 1, amountEuros: 10 }]);
  });

  test('two amounts for the same case drop every price, but keep the rest of the reading', () => {
    // « Samedi 10 €, Dimanche 12 € » read for a one-day competition (Meursault, 2026-10-29).
    const check = checkMandateData(answer({ prices: [price(10, ['S1']), price(12), price(12, ['S1'])] }), COMPETITION);
    expect(check).toEqual({
      ok: true,
      data: answer({ prices: [] }) as never,
      problems: [
        'Deux tarifs aussi précis l’un que l’autre donnaient deux montants pour un même cas : aucun tarif n’est gardé.',
      ],
    });
  });

  test('a category in two prices is no contradiction: the most specific one applies', () => {
    // « U11 + Promotion : 6 €, Jeunes : 8 € » (Montureux-et-Prantigny, 2026-10-11).
    const prices = [price(6, ['U11']), price(8, ['U11', 'U13', 'U15', 'U18', 'U21'])];
    expect(checkMandateData(answer({ prices }), COMPETITION).ok).toBe(true);
  });

  test('refuses out-of-range values and unknown answers', () => {
    for (const overrides of [
      { prices: [price(900)] },
      { prices: [price(9, ['Seniors'])] },
      { prices: [price(9, [])] },
      { prices: [{ categories: ALL, departures: 0, amountEuros: 9 }] },
      { departures: [{ date: null, label: 'Matin', registrationOpens: '25:00', shootingStarts: null }] },
      { departures: [{ date: null, label: '  ', registrationOpens: null, shootingStarts: null }] },
      { foamTargets: 'maybe' },
      { rhythms: ['ABCD'] },
      { rhythms: 'AB/CD' },
      { rhythmsAreAlternatives: 'oui' },
      { extra: 'field' },
    ]) {
      expect(checkMandateData(answer(overrides), COMPETITION).ok).toBe(false);
    }
    expect(checkMandateData('Voici les informations…', COMPETITION).ok).toBe(false);
  });

  test('tells the LLM the same shape, with every field required and nothing else allowed', () => {
    expect(mandateAnswerJsonSchema).toMatchObject({
      type: 'object',
      required: ['departures', 'prices', 'foamTargets', 'rhythms', 'rhythmsAreAlternatives', 'evidence'],
      additionalProperties: false,
    });
  });
});

describe('inscriptarcUrlOf', () => {
  test('finds the competition’s page however the mandate writes it (real mandates, 2026-10-29)', () => {
    const page = 'https://vincennes-salle.inscriptarc.fr/';
    expect(inscriptarcUrlOf('par internet : https ://vincennes-salle.inscriptarc.fr, soit par courrier')).toBe(page);
    expect(inscriptarcUrlOf('Inscriptions : VINCENNES-SALLE.inscriptarc.fr')).toBe(page);
    expect(inscriptarcUrlOf('Voir www.inscriptarc.fr puis https://vincennes-salle.inscriptarc.fr/inscription')).toBe(
      page,
    );
  });

  test('nothing without a competition page: the site’s home page alone, or no link at all', () => {
    expect(inscriptarcUrlOf('Inscriptions sur Inscript’Arc : https://www.inscriptarc.fr')).toBeNull();
    expect(inscriptarcUrlOf('Inscriptions par mail à concours@club.fr')).toBeNull();
  });
});

const reading = (rhythms?: string[], rhythmsAreAlternatives?: boolean) =>
  answer({ rhythms, rhythmsAreAlternatives }) as never;

const tir = (number: number, registrationOpens: string | null, date: string | null = null): MandateDeparture => ({
  date,
  label: `Tir ${number}`,
  registrationOpens,
  shootingStarts: null,
});
const WEEKEND = { startDate: '2026-11-07', endDate: '2026-11-08' };
const dates = (departures: MandateDeparture[], competition = WEEKEND) =>
  datedDepartures(departures, competition).map(({ date }) => date);

// Clisson, 7 and 8 November: « Tir 1 » 14 h 30, « Tir 2 » 8 h, « Tir 3 » 13 h 30, no day written.
describe('datedDepartures', () => {
  test('an earlier time than the départ before starts the next day', () => {
    expect(dates([tir(1, '14:30'), tir(2, '08:00'), tir(3, '13:30')])).toEqual([
      '2026-11-07',
      '2026-11-08',
      '2026-11-08',
    ]);
  });

  test('leaves the days unknown when the times do not match the number of days', () => {
    // Times always going forward on a two-day competition: which day each départ is cannot be told.
    expect(dates([tir(1, '08:00'), tir(2, '13:30')])).toEqual([null, null]);
    // Two day changes for two days.
    expect(dates([tir(1, '14:00'), tir(2, '08:00'), tir(3, '07:00')])).toEqual([null, null, null]);
  });

  test('leaves the départs as they are without a time, with a day already given, or on one day', () => {
    expect(dates([tir(1, '14:30'), tir(2, null)])).toEqual([null, null]);
    expect(dates([tir(1, '14:30', '2026-11-07'), tir(2, '08:00')])).toEqual(['2026-11-07', null]);
    expect(dates([tir(1, '14:30'), tir(2, '08:00')], { startDate: '2026-11-07', endDate: '2026-11-07' })).toEqual([
      null,
      null,
    ]);
  });
});

describe('rhythmsOf', () => {
  test('each for its own départs: every one the discipline allows', () => {
    // « Samedi – tir en AB, dimanche – tir en AB/CD » (2026-10-25).
    expect(rhythmsOf(reading(['AB/CD', 'AB'], false), 'salle')).toEqual(['AB', 'AB/CD']);
    expect(rhythmsOf(reading(['AB', 'AB/CD'], false), 'exterieur')).toEqual(['AB/CD']);
    // ABC is shot indoors too (2026-10-25).
    expect(rhythmsOf(reading(['ABC']), 'salle')).toEqual(['ABC']);
    expect(rhythmsOf(reading(['AB']), 'exterieur')).toEqual([]);
  });

  test('a choice: AB/CD as soon as it is named, else the only one, else none', () => {
    // « AB/CD ou ABC en fonction du nombre de tireurs » (Guérande, salle).
    expect(rhythmsOf(reading(['AB/CD', 'ABC'], true), 'salle')).toEqual(['AB/CD']);
    expect(rhythmsOf(reading(['AB', 'AB/CD'], true), 'salle')).toEqual(['AB/CD']);
    expect(rhythmsOf(reading(['AB', 'ABC'], true), 'exterieur')).toEqual(['ABC']);
    expect(rhythmsOf(reading(['AB', 'ABC'], true), 'salle')).toEqual([]);
    // Readings made before 2026-10-25 do not say: read as a choice, as they were.
    expect(rhythmsOf(reading(['AB', 'AB/CD']), 'salle')).toEqual(['AB/CD']);
  });

  test('none when nothing is written, for readings made before, and off targets', () => {
    expect(rhythmsOf(reading([]), 'salle')).toEqual([]);
    expect(rhythmsOf(reading(undefined), 'salle')).toEqual([]);
    expect(rhythmsOf(null, 'salle')).toEqual([]);
    expect(rhythmsOf(reading(['AB/CD']), 'campagne')).toEqual([]);
  });
});
