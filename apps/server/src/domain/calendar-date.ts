/** A day without time or time zone, in ISO format: `YYYY-MM-DD`. Sorts correctly as a string. */
export type CalendarDate = string;

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}
