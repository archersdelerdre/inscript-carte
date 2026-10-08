import { FOAM_TARGETS_ANSWERS, MANDATE_AUDIENCES, type MandateData } from '@inscript-carte/shared';
import { z } from 'zod';

import type { CalendarDate } from './calendar-date.ts';

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
        audience: z.enum(MANDATE_AUDIENCES),
        departures: z.int().min(1).max(MAX_DEPARTURES),
        amountEuros: z.number().min(0).max(MAX_PRICE_EUROS),
      }),
    )
    .max(MAX_DEPARTURES * MANDATE_AUDIENCES.length),
  foamTargets: z.enum(FOAM_TARGETS_ANSWERS),
  evidence: z.strictObject({ departures: quote, prices: quote, foamTargets: quote }),
}) satisfies z.ZodType<MandateData>;

export const mandateAnswerJsonSchema = z.toJSONSchema(MandateAnswer);

export type MandateCheck = { ok: true; data: MandateData } | { ok: false; problems: string[] };

/**
 * The LLM's answer is never trusted as is: out of shape, out of range, or contradicting itself, the whole reading is
 * refused (kept, to be looked at) rather than half-stored. A wrong price is worse than no price.
 *
 * One mandate often covers a weekend that the FFTA lists as two competitions (Saturday, Sunday): the départs of the
 * other days are left out, not refused. A price given twice with the same amount is kept once.
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

  const problems: string[] = [];
  const prices = new Map<string, MandateData['prices'][number]>();
  parsed.data.prices.forEach((price, index) => {
    const key = `${price.audience}|${price.departures}`;
    const known = prices.get(key);
    if (known && known.amountEuros !== price.amountEuros) {
      problems.push(`Tarif ${index + 1} : deux montants différents pour le même cas.`);
    }
    if (!known) prices.set(key, price);
  });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, data: { ...parsed.data, departures: onItsDays, prices: [...prices.values()] } };
}
