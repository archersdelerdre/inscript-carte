import { DEFAULT_DEPARTURE_COUNT, type Discipline, type MandateDeparture } from '@inscript-carte/shared';

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
  /** Shot on foam targets ("cibles mousses"); not in the legacy data, `false` until the scraper fills it. */
  readonly hasFoamTargets: boolean;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  readonly organizerClub: string | null;
  readonly town: string;
  readonly departmentCode: string;
  readonly position: { readonly latitude: number; readonly longitude: number } | null;
  readonly mandateUrl: string | null;
  /** The départs the mandate lists, in order (départ N is the Nth); `null` when no checked reading has any. */
  readonly departures: readonly MandateDeparture[] | null;
};

/** The départ numbers an archer may pick: the mandate's, else 1 to `DEFAULT_DEPARTURE_COUNT` (mandate not read). */
export function departureCount(competition: Competition): number {
  return competition.departures?.length ?? DEFAULT_DEPARTURE_COUNT;
}

export function clubRegistrationDeadline(competition: Competition): CalendarDate {
  return addDays(competition.startDate, -CLUB_REGISTRATION_DAYS_BEFORE_START);
}

export function isFinished(competition: Competition, today: CalendarDate): boolean {
  return competition.endDate < today;
}
