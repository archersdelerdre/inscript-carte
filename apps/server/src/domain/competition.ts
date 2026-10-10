import {
  DEFAULT_DEPARTURE_COUNT,
  type Discipline,
  type MandateDeparture,
  type MandatePrice,
} from '@inscript-carte/shared';

import { addDays, type CalendarDate } from './calendar-date.ts';

/** The club deadline is never later than this many days before the start (no mandate yet, or one that comes late). */
const LAST_DAYS_BEFORE_START = 7;
/** With a mandate out early, the club stops this many days before the start... */
const USUAL_DAYS_BEFORE_START = 14;
/** ...but archers always get this many days after a mandate that comes late. */
const DAYS_AFTER_MANDATE = 2;

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
  /** The day a scraper run first saw `mandateUrl`; `null` without one, or for a link stored before it was tracked. */
  readonly mandateAddedOn: CalendarDate | null;
  /** The départs the mandate lists, in order (départ N is the Nth); `null` when no checked reading has any. */
  readonly departures: readonly MandateDeparture[] | null;
  /** The registration prices the mandate lists; `null` when no checked reading has any. */
  readonly prices: readonly MandatePrice[] | null;
  /** The day a scraper run no longer found it on the FFTA list; `null` while it is listed. */
  readonly missingSince: CalendarDate | null;
};

/** The départ numbers an archer may pick: the mandate's, else 1 to `DEFAULT_DEPARTURE_COUNT` (mandate not read). */
export function departureCount(competition: Competition): number {
  return competition.departures?.length ?? DEFAULT_DEPARTURE_COUNT;
}

/** "Après-midi" for départ 2 when the mandate lists it; `null` otherwise (mandate not read, or a number beyond it). */
export function departureLabel(competition: Competition, departure: number): string | null {
  return competition.departures?.[departure - 1]?.label ?? null;
}

/** A competition the public sees: it always has a place. */
export type PublicCompetition = Competition & { readonly position: NonNullable<Competition['position']> };

/**
 * Shown on the public map and list: not cancelled, still on the FFTA list, and with a place (the few without one are
 * placeholders such as "A Définir"; the user chose to keep them in the database but not to show them).
 */
export function isPublic(competition: Competition): competition is PublicCompetition {
  return competition.status !== 'cancelled' && competition.missingSince === null && competition.position !== null;
}

/**
 * Last day (included) to register through the club, the user's rules (2026-10-10): 7 days before the start without a
 * mandate; with one, 14 days before, or 2 days after a mandate that came late, never past 7 days before. A link whose
 * day is unknown (stored before it was tracked) counts as an early one.
 */
export function clubRegistrationDeadline(competition: Competition): CalendarDate {
  const lastDay = addDays(competition.startDate, -LAST_DAYS_BEFORE_START);
  if (!competition.mandateUrl) return lastDay;
  const usual = addDays(competition.startDate, -USUAL_DAYS_BEFORE_START);
  if (!competition.mandateAddedOn) return usual;
  const afterMandate = addDays(competition.mandateAddedOn, DAYS_AFTER_MANDATE);
  const later = afterMandate > usual ? afterMandate : usual;
  return later < lastDay ? later : lastDay;
}

export function isFinished(competition: Competition, today: CalendarDate): boolean {
  return competition.endDate < today;
}
