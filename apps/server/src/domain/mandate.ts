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
 * The LLM's answer is never trusted as is: out of shape, out of range, or not matching the competition, the whole
 * reading is refused (kept, to be looked at) rather than half-stored. A wrong price is worse than no price.
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
  const data = parsed.data;
  const problems: string[] = [];
  data.departures.forEach(({ date }, index) => {
    if (date && (date < competition.startDate || date > competition.endDate)) {
      problems.push(`Départ ${index + 1} : le ${date} n’est pas un jour du concours.`);
    }
  });
  const seen = new Set<string>();
  data.prices.forEach(({ audience, departures }, index) => {
    const key = `${audience}|${departures}`;
    if (seen.has(key)) problems.push(`Tarif ${index + 1} : donné deux fois.`);
    seen.add(key);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, data };
}
