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
};

export function birthYear(archer: Archer): number {
  return Number(archer.birthDate.slice(0, 4));
}
