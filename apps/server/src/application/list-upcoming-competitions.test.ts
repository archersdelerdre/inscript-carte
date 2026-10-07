import { expect, test } from 'bun:test';

import type { Competition, CompetitionStatus } from '../domain/competition.ts';
import type { RegistrationRepository } from '../domain/registration-repository.ts';
import { ListUpcomingCompetitions } from './list-upcoming-competitions.ts';

function competition(
  id: string,
  startDate: string,
  endDate: string,
  status: CompetitionStatus = 'scheduled',
): Competition {
  return {
    id,
    title: id,
    discipline: 'salle',
    status,
    hasParaTir: false,
    startDate,
    endDate,
    organizerClub: null,
    town: 'Nantes',
    departmentCode: '44',
    position: null,
    mandateUrl: null,
  };
}

test('keeps competitions not finished nor cancelled, sorted by start date, with their club registration count', async () => {
  const all = [
    competition('later', '2026-11-14', '2026-11-15'),
    competition('finished', '2026-10-03', '2026-10-05'),
    competition('ends-today', '2026-10-05', '2026-10-06'),
    competition('cancelled', '2026-10-08', '2026-10-08', 'cancelled'),
    competition('postponed', '2026-10-12', '2026-10-12', 'postponed'),
    competition('soon', '2026-10-10', '2026-10-10'),
  ];
  const useCase = new ListUpcomingCompetitions(
    { findAll: async () => all, findById: async () => null },
    // Only the method this use case calls.
    { countActiveByCompetition: async () => new Map([['soon', 2]]) } as unknown as RegistrationRepository,
    { today: () => '2026-10-06', now: () => new Date('2026-10-06T10:00:00Z') },
  );

  const upcoming = await useCase.execute();

  expect(upcoming.map(({ competition: { id }, clubRegistrationCount }) => [id, clubRegistrationCount])).toEqual([
    ['ends-today', 0],
    ['soon', 2],
    ['postponed', 0],
    ['later', 0],
  ]);
});
