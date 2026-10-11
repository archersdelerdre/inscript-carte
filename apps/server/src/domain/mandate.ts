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
  evidence: z.strictObject({ departures: quote, prices: quote, foamTargets: quote, rhythm: quote }),
}) satisfies z.ZodType<MandateData>;

/**
 * The rhythm a reading gives, by the user's rules (2026-10-11), never asked to the LLM: AB/CD as soon as the mandate
 * names it ("AB/CD ou ABC selon le nombre d'archers"); an indoor "ABC" is AB; then one rhythm the discipline allows,
 * else none (nothing written, readings made before the rhythm was asked, off targets).
 */
export function rhythmOf(data: MandateData | null, discipline: Discipline): Rhythm | null {
  const allowed = allowedRhythms(discipline);
  const written = new Set(
    (data?.rhythms ?? []).map((rhythm) => (discipline === 'salle' && rhythm === 'ABC' ? 'AB' : rhythm)),
  );
  if (written.has('AB/CD') && allowed.includes('AB/CD')) return 'AB/CD';
  const [only, ...others] = [...written].filter((rhythm) => allowed.includes(rhythm));
  return only && others.length === 0 ? only : null;
}

export const mandateAnswerJsonSchema = z.toJSONSchema(MandateAnswer);

export type MandateCheck = { ok: true; data: MandateData } | { ok: false; problems: string[] };

/**
 * The LLM's answer is never trusted as is: out of shape, out of range, or contradicting itself, the whole reading is
 * refused (kept, to be looked at) rather than half-stored. A wrong price is worse than no price.
 *
 * One mandate often covers a weekend that the FFTA lists as two competitions (Saturday, Sunday): the départs of the
 * other days are left out, not refused. A price given twice is kept once. A category named by two prices pays the
 * most specific one (`pricesFor`); only two equally specific prices with different amounts are a contradiction.
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
  if (hasPriceConflict([...prices.values()])) {
    return {
      ok: false,
      problems: ['Deux tarifs aussi précis l’un que l’autre donnent deux montants pour un même cas.'],
    };
  }
  const departures = datedDepartures(onItsDays, competition);
  return { ok: true, data: { ...parsed.data, departures, prices: [...prices.values()] } };
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
