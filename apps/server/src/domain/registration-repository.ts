import type { BowType } from '@inscript-carte/shared';

import type { CalendarDate } from './calendar-date.ts';
import type { NewRegistration, Registration } from './registration.ts';

/** Who is registered for a competition, as shown to other club members. */
export type Registrant = {
  readonly archerLicenceNumber: string;
  readonly fullName: string;
  readonly bowType: BowType;
  readonly departure: number;
};

export type AddRegistrationsResult =
  | { readonly ok: true; readonly paymentReference: string }
  /** Another active registration already exists for one of these départs. */
  | { readonly ok: false; readonly reason: 'already_registered' };

export interface RegistrationRepository {
  /** Active (not cancelled) registrations per competition id. */
  countActiveByCompetition(): Promise<Map<string, number>>;
  activeDepartures(competitionId: string, archerLicenceNumber: string): Promise<number[]>;
  /** Adds one registration per départ, all sharing one new payment reference. */
  add(registration: NewRegistration): Promise<AddRegistrationsResult>;
  activeRegistrants(competitionId: string): Promise<Registrant[]>;
  forArcher(archerLicenceNumber: string): Promise<Registration[]>;
  findById(id: number): Promise<Registration | null>;
  withdraw(id: number, note: string, today: CalendarDate): Promise<void>;
}
