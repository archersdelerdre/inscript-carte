import type { Discipline } from '@inscript-carte/shared';

import { addDays, type CalendarDate } from './calendar-date.ts';

/** The club stops taking registration requests this many days before the competition starts. */
const CLUB_REGISTRATION_DAYS_BEFORE_START = 15;

export type CompetitionStatus = 'scheduled' | 'postponed' | 'cancelled';

export type Competition = {
  readonly id: string;
  readonly title: string;
  readonly discipline: Discipline;
  readonly status: CompetitionStatus;
  readonly hasParaTir: boolean;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  readonly organizerClub: string | null;
  readonly town: string;
  readonly departmentCode: string;
  readonly position: { readonly latitude: number; readonly longitude: number } | null;
  readonly mandateUrl: string | null;
};

export function clubRegistrationDeadline(competition: Competition): CalendarDate {
  return addDays(competition.startDate, -CLUB_REGISTRATION_DAYS_BEFORE_START);
}

export function isFinished(competition: Competition, today: CalendarDate): boolean {
  return competition.endDate < today;
}
