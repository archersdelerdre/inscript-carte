import type {
  AgeCategory,
  BowType,
  DepartureChoice,
  Distance,
  PaymentMethod,
  PaymentStatus,
  RegistrationStatus,
} from '@inscript-carte/shared';

import type { CalendarDate } from './calendar-date.ts';
import { clubRegistrationDeadline, type Competition } from './competition.ts';

/** One registration per départ, like the club's sheet: each départ can get its own status. */
export type Registration = {
  readonly id: number;
  readonly competitionId: string;
  readonly archerLicenceNumber: string;
  readonly departure: number;
  readonly bowType: BowType;
  readonly category: AgeCategory;
  readonly status: RegistrationStatus;
  readonly paymentStatus: PaymentStatus;
  readonly paymentMethod: PaymentMethod | null;
  readonly paymentReference: string;
  readonly clubNote: string | null;
  readonly trispot: boolean;
  readonly distance: Distance | null;
  readonly contact: string | null;
  /** ISO date and time (UTC). */
  readonly createdAt: string;
  /** Licence number of the admin who changed the row last. */
  readonly updatedBy: string | null;
};

/** What an archer asks for; the server adds the category, status and payment reference. */
export type NewRegistration = {
  readonly competitionId: string;
  readonly archerLicenceNumber: string;
  /** Sorted by départ number; each départ has its own bow. */
  readonly departures: readonly DepartureChoice[];
  readonly category: AgeCategory;
  readonly trispot: boolean;
  readonly distance: Distance | null;
  readonly contact: string | null;
  readonly paymentMethod: PaymentMethod;
};

/** The club takes requests until its deadline, included. */
export function isClubRegistrationOpen(competition: Competition, today: CalendarDate): boolean {
  return competition.status !== 'cancelled' && today <= clubRegistrationDeadline(competition);
}

/** Once the club has sent the registration to the organizer, only the club can change it. */
export function canWithdraw(registration: Registration, competition: Competition, today: CalendarDate): boolean {
  return registration.status === 'received' && today <= clubRegistrationDeadline(competition);
}
