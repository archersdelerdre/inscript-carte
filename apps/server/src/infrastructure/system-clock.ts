import type { Clock } from '../application/ports/clock.ts';
import type { CalendarDate } from '../domain/calendar-date.ts';

/** "en-CA" formats dates as `YYYY-MM-DD`. */
const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

export class SystemClock implements Clock {
  today(): CalendarDate {
    return parisDate.format(new Date());
  }

  now(): Date {
    return new Date();
  }
}
