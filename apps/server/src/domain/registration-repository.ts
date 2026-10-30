import type { AgeCategory, BowType, PaymentStatus, RegistrationStatus, Sex } from '@inscript-carte/shared';

import type { CalendarDate } from './calendar-date.ts';
import type { NewRegistration, Registration } from './registration.ts';

/** Who is registered for a competition, as shown to other club members. */
export type Registrant = {
  readonly archerLicenceNumber: string;
  readonly fullName: string;
  readonly category: AgeCategory;
  readonly sex: Sex;
  readonly bowType: BowType;
  readonly departure: number;
  readonly carpool: boolean;
};

export type AddRegistrationsResult =
  | { readonly ok: true; readonly paymentReference: string }
  /** Another active registration already exists for one of these départs. */
  | { readonly ok: false; readonly reason: 'already_registered' }
  /** Paid with credit, but the archer's credit no longer covers it (spent meanwhile). */
  | { readonly ok: false; readonly reason: 'credit_too_low' };

/** A registration with the names the admin panel shows. */
export type RegistrationDetails = {
  readonly registration: Registration;
  readonly fullName: string;
  readonly sex: Sex;
  readonly updatedByName: string | null;
  readonly clubPaysRegistrations: boolean;
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
  /** Kept as credit: the amount, in cents; `null` for any other payment state. */
  readonly creditCents: number | null;
  /** What this change gives to the archer's credit (negative: takes back), in cents; `0`: nothing. */
  readonly creditMoveCents: number;
  /** Only when this change cancels the row. */
  readonly cancelledAt?: CalendarDate;
};

export interface RegistrationRepository {
  /** Archers with at least one active (not cancelled) départ, per competition id. */
  countActiveArchersByCompetition(): Promise<Map<string, number>>;
  /** Every row, cancelled ones included, counted per competition, status and payment status. */
  countAll(): Promise<RegistrationCount[]>;
  activeDepartures(competitionId: string, archerLicenceNumber: string): Promise<number[]>;
  /**
   * Adds one registration per départ, with the archer's payment reference for this competition (new if none yet). Its
   * covoiturage answer is set on every active départ of the archer for this competition: the latest answer wins. Paid
   * with credit: checks the archer still has enough, in the same transaction.
   */
  add(registration: NewRegistration): Promise<AddRegistrationsResult>;
  activeRegistrants(competitionId: string): Promise<Registrant[]>;
  forArcher(archerLicenceNumber: string): Promise<Registration[]>;
  /** Every row of the competition, cancelled ones included. */
  detailsForCompetition(competitionId: string): Promise<RegistrationDetails[]>;
  forPaymentReference(paymentReference: string): Promise<Registration[]>;
  findById(id: number): Promise<Registration | null>;
  /** The archer cancels the row; its payment may change with it (paid with credit: kept as credit again). */
  withdraw(
    id: number,
    note: string,
    today: CalendarDate,
    payment: Pick<RegistrationChange, 'paymentStatus' | 'creditCents' | 'creditMoveCents'>,
  ): Promise<void>;
  /** In one transaction. */
  save(changes: readonly RegistrationChange[], updatedBy: string): Promise<void>;
}
