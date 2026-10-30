import type { Sex } from '@inscript-carte/shared';

import type { CalendarDate } from './calendar-date.ts';

/** A club member, from the FFTA member list export. The licence number identifies them. */
export type Archer = {
  readonly licenceNumber: string;
  readonly fullName: string;
  readonly sex: Sex;
  readonly birthDate: CalendarDate;
  /** Only active members can sign in and register. */
  readonly isActive: boolean;
  /** The club pays their registrations: new départs start as "nothing_due", no payment method asked. */
  readonly clubPaysRegistrations: boolean;
  /** The member added a password (optional): the sign-in asks it after the birth date. Never the hash itself. */
  readonly hasPassword: boolean;
  /**
   * The member's credit (« avoir »), in cents: what was kept from their départs to refund, less what paid later
   * registrations and what admins gave back.
   */
  readonly creditCents: number;
};

/** What the FFTA export knows: it never carries the club's own data. */
export type ExportedMember = Omit<Archer, 'clubPaysRegistrations' | 'hasPassword' | 'creditCents'>;

/** Stored only for the organizer's Excel file ("Responsable"), never shown in the app. */
export type ArcherContact = {
  readonly email: string | null;
  readonly phone: string | null;
};

/** The club's contact on the organizer's file: the admin who makes it. */
export type Responsible = ArcherContact & { readonly fullName: string };

export function birthYear(archer: Archer): number {
  return Number(archer.birthDate.slice(0, 4));
}
