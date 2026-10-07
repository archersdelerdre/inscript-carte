import type { CalendarDate } from '../../domain/calendar-date.ts';

export interface Clock {
  /** Today in Paris, where the club is: deadlines are calendar days. */
  today(): CalendarDate;
  now(): Date;
}
