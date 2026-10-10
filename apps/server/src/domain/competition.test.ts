import { describe, expect, test } from 'bun:test';

import { clubRegistrationDeadline, type Competition } from './competition.ts';

const competition: Competition = {
  id: '26588',
  title: 'Concours Salle Carquefou',
  discipline: 'salle',
  status: 'scheduled',
  hasParaTir: true,
  hasFoamTargets: false,
  startDate: '2027-01-09',
  endDate: '2027-01-10',
  organizerClub: "Archers de l'Erdre",
  town: 'Carquefou',
  departmentCode: '44',
  position: { latitude: 47.297, longitude: -1.49 },
  mandateUrl: null,
  mandateAddedOn: null,
  departures: null,
  prices: null,
  missingSince: null,
};

const withMandate = (mandateAddedOn: string | null): Competition => ({
  ...competition,
  mandateUrl: 'https://extranet.ffta.fr/m.pdf',
  mandateAddedOn,
});

describe('clubRegistrationDeadline', () => {
  test('without a mandate: 7 days before the start, across month and year boundaries', () => {
    expect(clubRegistrationDeadline(competition)).toBe('2027-01-02');
    expect(clubRegistrationDeadline({ ...competition, startDate: '2028-03-04' })).toBe('2028-02-26');
  });

  test('a mandate out early: 14 days before the start; one whose day is unknown counts as early', () => {
    expect(clubRegistrationDeadline(withMandate('2026-11-01'))).toBe('2026-12-26');
    expect(clubRegistrationDeadline(withMandate(null))).toBe('2026-12-26');
  });

  test('a mandate out late: 2 days after it, never less, never past 7 days before the start', () => {
    // 15 days before: the 14-day limit would leave 1 day, archers get 2.
    expect(clubRegistrationDeadline(withMandate('2026-12-25'))).toBe('2026-12-27');
    expect(clubRegistrationDeadline(withMandate('2026-12-29'))).toBe('2026-12-31');
    expect(clubRegistrationDeadline(withMandate('2027-01-01'))).toBe('2027-01-02');
    // Out after that: the deadline has passed.
    expect(clubRegistrationDeadline(withMandate('2027-01-05'))).toBe('2027-01-02');
  });
});
