import type { BowType, PaymentStatus, RegistrationStatus, Sex } from '@inscript-carte/shared';

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

/** A registration with the names the admin panel shows. */
export type RegistrationDetails = {
  readonly registration: Registration;
  readonly fullName: string;
  readonly sex: Sex;
  readonly updatedByName: string | null;
};

export type RegistrationCount = {
  readonly competitionId: string;
  readonly status: RegistrationStatus;
  readonly paymentStatus: PaymentStatus;
  readonly count: number;
};

/** The new values of one row, decided by the club. */
export type RegistrationChange = {
  readonly id: number;
  readonly status: RegistrationStatus;
  readonly paymentStatus: PaymentStatus;
  readonly clubNote: string | null;
  /** Only when this change cancels the row. */
  readonly cancelledAt?: CalendarDate;
};

export interface RegistrationRepository {
  /** Active (not cancelled) registrations per competition id. */
  countActiveByCompetition(): Promise<Map<string, number>>;
  /** Every row, cancelled ones included, counted per competition, status and payment status. */
  countAll(): Promise<RegistrationCount[]>;
  activeDepartures(competitionId: string, archerLicenceNumber: string): Promise<number[]>;
  /** Adds one registration per départ, with the archer's payment reference for this competition (new if none yet). */
  add(registration: NewRegistration): Promise<AddRegistrationsResult>;
  activeRegistrants(competitionId: string): Promise<Registrant[]>;
  forArcher(archerLicenceNumber: string): Promise<Registration[]>;
  /** Every row of the competition, cancelled ones included. */
  detailsForCompetition(competitionId: string): Promise<RegistrationDetails[]>;
  forPaymentReference(paymentReference: string): Promise<Registration[]>;
  findById(id: number): Promise<Registration | null>;
  withdraw(id: number, note: string, today: CalendarDate): Promise<void>;
  /** In one transaction. */
  save(changes: readonly RegistrationChange[], updatedBy: string): Promise<void>;
}
