import { describe, expect, test } from 'bun:test';

import { clubRegistrationDeadline, type Competition } from './competition.ts';

const competition: Competition = {
  id: '26588',
  title: 'Concours Salle Carquefou',
  discipline: 'salle',
  status: 'scheduled',
  hasParaTir: true,
  startDate: '2027-01-09',
  endDate: '2027-01-10',
  organizerClub: "Archers de l'Erdre",
  town: 'Carquefou',
  departmentCode: '44',
  position: { latitude: 47.297, longitude: -1.49 },
  mandateUrl: null,
};

describe('clubRegistrationDeadline', () => {
  test('is 15 days before the start, across month and year boundaries', () => {
    expect(clubRegistrationDeadline(competition)).toBe('2026-12-25');
  });

  test('handles leap years', () => {
    expect(clubRegistrationDeadline({ ...competition, startDate: '2028-03-10' })).toBe('2028-02-24');
  });
});
