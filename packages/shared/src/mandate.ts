import type { Discipline } from './discipline.ts';
import { AGE_CATEGORIES, type AgeCategory } from './ffta-category.ts';

/** What the FFTA mandate (the organizer's PDF) says, as read by an LLM and checked by the server. */

export const FOAM_TARGETS_ANSWERS = ['yes', 'no', 'not_mentioned'] as const;
/** Most mandates never say: `not_mentioned` is never read as "no". */
export type FoamTargetsAnswer = (typeof FOAM_TARGETS_ANSWERS)[number];

/** How archers take turns at the target: by two (AB), by three (ABC), or four per target in two waves (AB/CD). */
export const RHYTHMS = ['AB', 'ABC', 'AB/CD'] as const;
export type Rhythm = (typeof RHYTHMS)[number];
export const RHYTHM_ANSWERS = [...RHYTHMS, 'not_mentioned'] as const;
export type RhythmAnswer = (typeof RHYTHM_ANSWERS)[number];

/**
 * The user's rule (2026-10-11), applied by the code, never asked to the LLM: indoors only AB or AB/CD, outdoors only
 * ABC or AB/CD. Other disciplines are not shot on targets in turns: no rhythm at all.
 */
const RHYTHMS_BY_DISCIPLINE: Partial<Record<Discipline, readonly Rhythm[]>> = {
  salle: ['AB', 'AB/CD'],
  exterieur: ['ABC', 'AB/CD'],
};

export function allowedRhythms(discipline: Discipline): readonly Rhythm[] {
  return RHYTHMS_BY_DISCIPLINE[discipline] ?? [];
}

export type MandateDeparture = {
  /** `YYYY-MM-DD`, `null` when the mandate does not say which day. */
  date: string | null;
  /** As the mandate names it: "Samedi après-midi", "Départ 2". */
  label: string;
  /** `HH:MM`, `null` when not given. */
  registrationOpens: string | null;
  shootingStarts: string | null;
};

/**
 * The total price for `departures` départs, for the FFTA categories it names: "Jeunes : 2 tirs 10 €" is
 * `{ categories: ['U11', 'U13', 'U15', 'U18', 'U21'], departures: 2, amountEuros: 10 }`.
 */
export type MandatePrice = { categories: AgeCategory[]; departures: number; amountEuros: number };

/**
 * The prices an archer of that category pays, one per number of départs: when several name the category ("Jeunes"
 * and "U11"), the one naming the fewest categories wins, the most specific.
 */
export function pricesFor(prices: readonly MandatePrice[], category: AgeCategory): MandatePrice[] {
  const best = new Map<number, MandatePrice>();
  for (const price of prices) {
    if (!price.categories.includes(category)) continue;
    const known = best.get(price.departures);
    if (!known || price.categories.length < known.categories.length) best.set(price.departures, price);
  }
  return [...best.values()];
}

/** Two equally specific prices give one category two amounts for the same départs: nobody can tell which is right. */
export function hasPriceConflict(prices: readonly MandatePrice[]): boolean {
  return AGE_CATEGORIES.some((category) =>
    pricesFor(prices, category).some((chosen) =>
      prices.some(
        (other) =>
          other.categories.includes(category) &&
          other.departures === chosen.departures &&
          other.categories.length === chosen.categories.length &&
          other.amountEuros !== chosen.amountEuros,
      ),
    ),
  );
}

const YOUTH: readonly AgeCategory[] = ['U11', 'U13', 'U15', 'U18', 'U21'];

/** "Tous", "Adultes", "Jeunes (U13 à U21)", "U11", "U15, S3": who a price is for, in the mandates' words. */
export function categoriesLabel(categories: readonly AgeCategory[]): string {
  const sorted = AGE_CATEGORIES.filter((category) => categories.includes(category));
  if (sorted.length === AGE_CATEGORIES.length) return 'Tous';
  if (sorted.join() === 'S1,S2,S3') return 'Adultes';
  const first = YOUTH.indexOf(sorted[0]!);
  const youthRun =
    first >= 0 && sorted.length > 1 && sorted.every((category, index) => YOUTH[first + index] === category);
  return youthRun ? `Jeunes (${sorted[0]} à ${sorted.at(-1)})` : sorted.join(', ');
}

export type MandateData = {
  departures: MandateDeparture[];
  prices: MandatePrice[];
  foamTargets: FoamTargetsAnswer;
  /** Missing from readings made before the rhythm was asked. */
  rhythm?: RhythmAnswer;
  /** The mandate's own words for each answer, so an admin can check it in a second. */
  evidence: { departures: string | null; prices: string | null; foamTargets: string | null; rhythm?: string | null };
};
