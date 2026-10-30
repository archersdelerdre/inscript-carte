import {
  AGE_CATEGORIES,
  allowedRhythms,
  FOAM_TARGETS_ANSWERS,
  hasPriceConflict,
  RHYTHMS,
  type Discipline,
  type MandateData,
  type Rhythm,
} from '@inscript-carte/shared';
import { z } from 'zod';

import { addDays, type CalendarDate } from './calendar-date.ts';

/** More would be a misreading: the busiest competitions have six. */
const MAX_DEPARTURES = 12;
const MAX_PRICE_EUROS = 150;

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
const quote = z.string().max(300).nullable();

/**
 * The shape the LLM must answer with. The same schema checks the answer and, as JSON Schema, tells the LLM what to
 * write (`mandateAnswerJsonSchema`), so the two cannot drift apart.
 */
export const MandateAnswer = z.strictObject({
  departures: z
    .array(
      z.strictObject({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        label: z.string().trim().min(1).max(80),
        registrationOpens: time,
        shootingStarts: time,
      }),
    )
    .max(MAX_DEPARTURES),
  prices: z
    .array(
      z.strictObject({
        categories: z.array(z.enum(AGE_CATEGORIES)).min(1).max(AGE_CATEGORIES.length),
        departures: z.int().min(1).max(MAX_DEPARTURES),
        amountEuros: z.number().min(0).max(MAX_PRICE_EUROS),
      }),
    )
    .max(MAX_DEPARTURES * AGE_CATEGORIES.length),
  foamTargets: z.enum(FOAM_TARGETS_ANSWERS),
  rhythms: z.array(z.enum(RHYTHMS)).max(RHYTHMS.length),
  rhythmsAreAlternatives: z.boolean(),
  evidence: z.strictObject({ departures: quote, prices: quote, foamTargets: quote, rhythm: quote }),
}) satisfies z.ZodType<MandateData>;

/**
 * The rhythms a reading gives, by the user's rules (2026-10-11, 2026-10-25), never asked to the LLM: only the rhythms
 * the discipline allows (none off targets); every one when each is for its own départs ("samedi en AB, dimanche en
 * AB/CD"), but when they are a choice ("AB/CD ou ABC selon le nombre d'archers"), AB/CD as soon as it is named, else
 * the only one, else none. In `RHYTHMS` order.
 */
export function rhythmsOf(data: MandateData | null, discipline: Discipline): Rhythm[] {
  const allowed = allowedRhythms(discipline);
  const written = data?.rhythms ?? [];
  const kept = RHYTHMS.filter((rhythm) => written.includes(rhythm) && allowed.includes(rhythm));
  if (data?.rhythmsAreAlternatives === false || kept.length < 2) return kept;
  return kept.includes('AB/CD') ? ['AB/CD'] : [];
}

export const mandateAnswerJsonSchema = z.toJSONSchema(MandateAnswer);

/** `problems`: what was left out of a kept reading (its prices, when they contradict each other). */
export type MandateCheck = { ok: true; data: MandateData; problems: string[] } | { ok: false; problems: string[] };

export const PRICE_CONFLICT =
  'Deux tarifs aussi précis l’un que l’autre donnaient deux montants pour un même cas : aucun tarif n’est gardé.';

/**
 * The LLM's answer is never trusted as is: out of shape, out of range, or about other days, the whole reading is
 * refused (kept, to be looked at) rather than half-stored.
 *
 * One mandate often covers a weekend that the FFTA lists as two competitions (Saturday, Sunday): the départs of the
 * other days are left out, not refused. A price given twice is kept once. A category named by two prices pays the
 * most specific one (`pricesFor`). Two equally specific prices with different amounts are a contradiction: a wrong
 * price is worse than no price, so every price goes, but the rest of the reading (départs, rhythms) stays (2026-10-29:
 * 17 readings out of 359 lost everything that way).
 */
export function checkMandateData(
  raw: unknown,
  competition: { startDate: CalendarDate; endDate: CalendarDate },
): MandateCheck {
  const parsed = MandateAnswer.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'réponse'} : ${issue.message}`),
    };
  }
  const onItsDays = parsed.data.departures.filter(
    ({ date }) => !date || (date >= competition.startDate && date <= competition.endDate),
  );
  if (parsed.data.departures.length > 0 && onItsDays.length === 0) {
    return { ok: false, problems: ['Aucun départ du mandat ne tombe un jour du concours.'] };
  }

  const prices = new Map<string, MandateData['prices'][number]>();
  for (const price of parsed.data.prices) {
    const categories = AGE_CATEGORIES.filter((category) => price.categories.includes(category));
    prices.set(`${categories.join()}|${price.departures}|${price.amountEuros}`, { ...price, categories });
  }
  const departures = datedDepartures(onItsDays, competition);
  if (hasPriceConflict([...prices.values()])) {
    return { ok: true, data: { ...parsed.data, departures, prices: [] }, problems: [PRICE_CONFLICT] };
  }
  return { ok: true, data: { ...parsed.data, departures, prices: [...prices.values()] }, problems: [] };
}

/**
 * The competition's Inscript'Arc page when the mandate's text names one: 17 mandates out of 116 on 2026-10-29, each
 * time the page to register on. Only the site's name is kept, as the text writes links loosely
 * ("https ://vincennes-salle.inscriptarc.fr,"). The site's home page (`www`) is not a competition.
 */
export function inscriptarcUrlOf(text: string): string | null {
  for (const [, name] of text.matchAll(/([a-z0-9-]+)\.inscriptarc\.fr/gi)) {
    const site = name!.toLowerCase();
    if (site !== 'www') return `https://${site}.inscriptarc.fr/`;
  }
  return null;
}

/**
 * Gives each départ its day when the mandate says none ("Tir 1, Tir 2, Tir 3" over a weekend), from the times: the
 * départs come in order, and a time earlier than the one before ("14 h 30" then "8 h 00") starts the next day. Only
 * when it holds together: no départ dated, a time on every one, and as many days found as the competition has.
 * Otherwise the départs stay as they are (asked by the user, 2026-10-11).
 */
export function datedDepartures(
  departures: MandateData['departures'],
  competition: { startDate: CalendarDate; endDate: CalendarDate },
): MandateData['departures'] {
  const days: CalendarDate[] = [competition.startDate];
  while (days.at(-1)! < competition.endDate && days.length <= MAX_DEPARTURES) days.push(addDays(days.at(-1)!, 1));
  if (days.length < 2 || departures.some(({ date }) => date !== null)) return departures;
  const times = departures.map(({ registrationOpens, shootingStarts }) => registrationOpens ?? shootingStarts);
  if (times.some((opens) => opens === null)) return departures;

  let day = 0;
  const indexes = times.map((opens, index) => (index > 0 && opens! < times[index - 1]! ? ++day : day));
  if (day !== days.length - 1) return departures;
  return departures.map((departure, index) => ({ ...departure, date: days[indexes[index]!]! }));
}
