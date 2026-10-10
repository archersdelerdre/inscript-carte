import { expect, test } from 'bun:test';

import type { Competition, CompetitionStatus } from '../domain/competition.ts';
import type { RegistrationRepository } from '../domain/registration-repository.ts';
import { ListUpcomingCompetitions } from './list-upcoming-competitions.ts';

function competition(
  id: string,
  startDate: string,
  endDate: string,
  status: CompetitionStatus = 'scheduled',
  overrides: Partial<Competition> = {},
): Competition {
  return {
    id,
    title: id,
    discipline: 'salle',
    status,
    hasParaTir: false,
    hasFoamTargets: false,
    startDate,
    endDate,
    organizerClub: null,
    town: 'Nantes',
    departmentCode: '44',
    position: { latitude: 47.21, longitude: -1.55 },
    mandateUrl: null,
    mandateAddedOn: null,
    departures: null,
    prices: null,
    missingSince: null,
    ...overrides,
  };
}

test('keeps listed competitions with a place, not finished nor cancelled, sorted, with their club count', async () => {
  const all = [
    competition('later', '2026-11-14', '2026-11-15'),
    competition('finished', '2026-10-03', '2026-10-05'),
    competition('ends-today', '2026-10-05', '2026-10-06'),
    competition('cancelled', '2026-10-08', '2026-10-08', 'cancelled'),
    competition('postponed', '2026-10-12', '2026-10-12', 'postponed'),
    competition('soon', '2026-10-10', '2026-10-10'),
    // Gone from the FFTA list, or a placeholder without a place: kept in the database, not shown.
    competition('gone', '2026-10-20', '2026-10-20', 'scheduled', { missingSince: '2026-10-05' }),
    competition('nowhere', '2026-10-21', '2026-10-21', 'scheduled', { position: null }),
  ];
  const useCase = new ListUpcomingCompetitions(
    { findAll: async () => all, findById: async () => null },
    // Only the method this use case calls.
    { countActiveArchersByCompetition: async () => new Map([['soon', 2]]) } as unknown as RegistrationRepository,
    { today: () => '2026-10-06', now: () => new Date('2026-10-06T10:00:00Z') },
  );

  const upcoming = await useCase.execute();

  expect(upcoming.map(({ competition: { id }, clubArcherCount }) => [id, clubArcherCount])).toEqual([
    ['ends-today', 0],
    ['soon', 2],
    ['postponed', 0],
    ['later', 0],
  ]);
});
