const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** `2026-10-17` → `17 oct.` */
export function formatDay(isoDate: string): string {
  return dayMonth.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatDateRange(startDate: string, endDate: string): string {
  return startDate === endDate ? formatDay(startDate) : `${formatDay(startDate)} au ${formatDay(endDate)}`;
}

const dayOnly = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'UTC' });
const monthOnly = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

/** `2026-10-17` → `{ day: '17', month: 'oct.' }`, for calendar-style date blocks. */
export function splitDay(isoDate: string): { day: string; month: string } {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return { day: dayOnly.format(date), month: monthOnly.format(date) };
}

/** "en-CA" formats dates as `YYYY-MM-DD`; the club is in France, so its deadlines follow Paris time. */
const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

export function todayInParis(): string {
  return parisDate.format(new Date());
}

const parisDateTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

/** `2026-10-06T10:00:00Z` → `06/10/2026 12:00`, in Paris time. */
export function formatDateTime(isoDateTime: string): string {
  return parisDateTime.format(new Date(isoDateTime));
}

/** `12/05/1980` (also `12.05.1980`, `12 5 1980`) → `1980-05-12`; `null` if it is not a real date. */
export function parseFrenchDate(text: string): string | null {
  const match = /^(\d{1,2})\D+(\d{1,2})\D+(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

/**
 * Formats a date while it is typed: digits only give `JJ/MM/AAAA` (phone number pads have no "/" key), a "/"
 * typed after a one-digit day or month pads it ("1/" → "01/"). When `deleting`, no trailing "/" is added back, so
 * erasing never gets stuck on it.
 */
export function formatDateTyping(value: string, deleting: boolean): string {
  const segments = value.split(/\D+/);
  // A segment followed by a separator is finished: pad the day and month to two digits.
  const digits = segments
    .map((segment, index) =>
      index < 2 && index < segments.length - 1 && segment.length === 1 ? `0${segment}` : segment,
    )
    .join('')
    .slice(0, 8);
  const slashAfter = (length: number) => digits.length > length || (digits.length === length && !deleting);
  return (
    digits.slice(0, 2) + (slashAfter(2) ? '/' : '') + digits.slice(2, 4) + (slashAfter(4) ? '/' : '') + digits.slice(4)
  );
}
