import { departureTitle, type MandateDeparture } from '@inscript-carte/shared';

import { frenchTime } from './departures';

/**
 * One calendar event. Times are local ("floating"): 8 h stays 8 h in the archer's calendar, which is right when the
 * phone is in the competition's time zone (always, except someone in mainland France adding an overseas competition).
 */
export type CalendarEvent = {
  /** Shown in the menu when there are several: « Départ 2 · Matin ». */
  name: string;
  summary: string;
  location: string;
  description: string;
} & ({ date: string; start: string; end: string } | { startDate: string; endDate: string });

/** The mandates give no end time: 3 h after the shooting starts, else 4 h after the greffe opens. */
const HOURS_AFTER_SHOOTING = 3;
const HOURS_AFTER_GREFFE = 4;

type ChosenDeparture = { number: number; mandate: MandateDeparture | null };

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  return `${String(Math.min(h! + hours, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The archer's départs of one competition: one timed event per départ when the mandate gives its day and a time,
 * else one whole-day event over the competition's days.
 */
export function competitionEvents(competition: {
  title: string;
  town: string;
  startDate: string;
  endDate: string;
  departures: ChosenDeparture[];
}): CalendarEvent[] {
  const summary = `Tir à l'arc : ${competition.title}`;
  const club = 'Inscription par le club des Archers de l’Erdre.';
  const timed = competition.departures.every(
    ({ mandate }) => mandate?.date && (mandate.registrationOpens || mandate.shootingStarts),
  );
  if (!timed) {
    const names = competition.departures.map(({ number, mandate }) => departureTitle(number, mandate?.label ?? null));
    return [
      {
        name: summary,
        summary,
        location: competition.town,
        description: [...names, club].join('\n'),
        startDate: competition.startDate,
        endDate: competition.endDate,
      },
    ];
  }
  return competition.departures.map(({ number, mandate }) => {
    const { date, label, registrationOpens: greffe, shootingStarts: shooting } = mandate!;
    const name = departureTitle(number, label);
    const end = shooting ? addHours(shooting, HOURS_AFTER_SHOOTING) : addHours(greffe!, HOURS_AFTER_GREFFE);
    const times = [
      greffe && `Greffe ${frenchTime(greffe)}`,
      shooting && `Tirs ${frenchTime(shooting)}`,
      `fin vers ${frenchTime(end)} (estimée)`,
    ].filter(Boolean);
    return {
      name,
      summary: `${summary} (${name})`,
      location: competition.town,
      description: [name, times.join(' · '), club].join('\n'),
      date: date!,
      start: greffe ?? shooting!,
      end,
    };
  });
}

/** `2026-11-15` → `20261115`, `+1` day for the excluded end of a whole-day event. */
function compactDate(date: string, addDays = 0): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + addDays);
  return day.toISOString().slice(0, 10).replaceAll('-', '');
}

/** `[start, end]` as calendars write them: `20261025T080000` for a time, a date alone for a whole day. */
function bounds(event: CalendarEvent): [string, string] {
  if ('date' in event) {
    const day = compactDate(event.date);
    return [`${day}T${event.start.replace(':', '')}00`, `${day}T${event.end.replace(':', '')}00`];
  }
  return [compactDate(event.startDate), compactDate(event.endDate, 1)];
}

/** Opens Google Agenda with the event filled in; the archer only saves it. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.summary);
  url.searchParams.set('dates', bounds(event).join('/'));
  url.searchParams.set('details', event.description);
  url.searchParams.set('location', event.location);
  return url.toString();
}

/** RFC 5545 text: backslash, comma, semicolon and line breaks escaped. */
function icsText(text: string): string {
  return text.replace(/[\\,;]/g, (character) => `\\${character}`).replace(/\n/g, '\\n');
}

/** The standard `.ics` file every calendar opens (iPhone, Outlook, Thunderbird, Android…), all events in it. */
export function icsFile(events: readonly CalendarEvent[], uid: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const vevents = events.flatMap((event, index) => {
    const [start, end] = bounds(event);
    const kind = 'date' in event ? '' : ';VALUE=DATE';
    return [
      'BEGIN:VEVENT',
      `UID:${index}-${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART${kind}:${start}`,
      `DTEND${kind}:${end}`,
      `SUMMARY:${icsText(event.summary)}`,
      `DESCRIPTION:${icsText(event.description)}`,
      `LOCATION:${icsText(event.location)}`,
      'END:VEVENT',
    ];
  });
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Archers de l Erdre//Inscriptions//FR',
    ...vevents,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function downloadIcs(events: readonly CalendarEvent[], uid: string): void {
  const url = URL.createObjectURL(new Blob([icsFile(events, uid)], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'concours.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
