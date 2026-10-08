import { DEFAULT_DEPARTURE_COUNT, type CompetitionDto, type MandateDeparture } from '@inscript-carte/shared';

export type DepartureOption = {
  /** Sent to the server: départ N is the Nth of the mandate. */
  number: number;
  /** "Matin", else "Départ 3" when the mandate was not read. */
  name: string;
  /** "Greffe 8 h · Tirs 9 h", with the day first when the competition lasts several days. */
  details: string | null;
};

const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });

/** "08:00" → "8 h", "13:30" → "13 h 30". */
function frenchTime(time: string): string {
  const [hours, minutes] = time.split(':');
  return `${Number(hours)} h${minutes === '00' ? '' : ` ${minutes}`}`;
}

function details(departure: MandateDeparture, severalDays: boolean): string | null {
  // "Samedi matin" already says the day.
  const day = severalDays && departure.date ? weekday.format(new Date(`${departure.date}T00:00:00Z`)) : null;
  const dayShown = day && !departure.label.toLowerCase().includes(day.split(' ')[0]!) ? day : null;
  const parts = [
    dayShown && dayShown.charAt(0).toUpperCase() + dayShown.slice(1),
    departure.registrationOpens && `Greffe ${frenchTime(departure.registrationOpens)}`,
    departure.shootingStarts && `Tirs ${frenchTime(departure.shootingStarts)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The départs the archer may pick: the mandate's when it was read, else 1 to `DEFAULT_DEPARTURE_COUNT`. */
export function departureOptions(competition: CompetitionDto): DepartureOption[] {
  if (!competition.departures) {
    return Array.from({ length: DEFAULT_DEPARTURE_COUNT }, (_, index) => ({
      number: index + 1,
      name: `Départ ${index + 1}`,
      details: null,
    }));
  }
  const severalDays = competition.startDate !== competition.endDate;
  return competition.departures.map((departure, index) => ({
    number: index + 1,
    name: departure.label,
    details: details(departure, severalDays),
  }));
}
