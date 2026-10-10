/** A calendar event: whole days (the mandates give no end time), never a guessed hour. */
export type CalendarEvent = {
  summary: string;
  /** `YYYY-MM-DD`, both included. */
  startDate: string;
  endDate: string;
  location: string;
  description: string;
};

/** The archer's competition as an event: one line per départ (« Départ 2 · Dimanche matin · Greffe 8 h »). */
export function competitionEvent(competition: {
  title: string;
  town: string;
  startDate: string;
  endDate: string;
  departures: string[];
}): CalendarEvent {
  return {
    summary: `Tir à l'arc : ${competition.title}`,
    startDate: competition.startDate,
    endDate: competition.endDate,
    location: competition.town,
    description: [...competition.departures, 'Inscription par le club des Archers de l’Erdre.'].join('\n'),
  };
}

/** `2026-11-15` → `20261116`: calendars want the day after the last one (the end is excluded). */
function compactDate(date: string, addDays = 0): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + addDays);
  return day.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Opens Google Agenda with the event filled in; the archer only saves it. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.summary);
  url.searchParams.set('dates', `${compactDate(event.startDate)}/${compactDate(event.endDate, 1)}`);
  url.searchParams.set('details', event.description);
  url.searchParams.set('location', event.location);
  return url.toString();
}

/** RFC 5545 text: backslash, comma, semicolon and line breaks escaped. */
function icsText(text: string): string {
  return text.replace(/[\\,;]/g, (character) => `\\${character}`).replace(/\n/g, '\\n');
}

/** The standard `.ics` file every calendar opens (iPhone, Outlook, Thunderbird, Android…). */
export function icsFile(event: CalendarEvent, uid: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Archers de l Erdre//Inscriptions//FR',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(event.startDate)}`,
    `DTEND;VALUE=DATE:${compactDate(event.endDate, 1)}`,
    `SUMMARY:${icsText(event.summary)}`,
    `DESCRIPTION:${icsText(event.description)}`,
    `LOCATION:${icsText(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function downloadIcs(event: CalendarEvent, uid: string): void {
  const url = URL.createObjectURL(new Blob([icsFile(event, uid)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'concours.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
