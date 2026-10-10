import {
  COMPETITION_STATUSES,
  DEPARTMENT_NAMES,
  DISCIPLINES,
  MANDATE_AUDIENCES,
  type CompetitionFields,
} from '@inscript-carte/shared';
import { z } from 'zod';

const MAX_TEXT = 200;
const MAX_DEPARTURES = 12;
const MAX_PRICE_EUROS = 150;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

/** What an admin may send. `mandateUrl` and `position` cannot be removed, only changed. */
const Overrides = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TEXT).optional(),
  startDate: day.optional(),
  endDate: day.optional(),
  discipline: z.enum(DISCIPLINES).optional(),
  status: z.enum(COMPETITION_STATUSES).optional(),
  hasParaTir: z.boolean().optional(),
  hasFoamTargets: z.boolean().optional(),
  mandateUrl: z.string().trim().startsWith('https://').max(500).optional(),
  town: z.string().trim().min(1).max(MAX_TEXT).optional(),
  departmentCode: z
    .string()
    .refine((code) => code in DEPARTMENT_NAMES)
    .optional(),
  position: z
    .strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .optional(),
  departures: z
    .array(
      z.strictObject({
        date: day.nullable(),
        label: z.string().trim().min(1).max(80),
        registrationOpens: time,
        shootingStarts: time,
      }),
    )
    .max(MAX_DEPARTURES)
    .optional(),
  prices: z
    .array(
      z.strictObject({
        audience: z.enum(MANDATE_AUDIENCES),
        departures: z.int().min(1).max(MAX_DEPARTURES),
        amountEuros: z.number().min(0).max(MAX_PRICE_EUROS),
      }),
    )
    .max(MAX_DEPARTURES * MANDATE_AUDIENCES.length)
    .optional(),
});

export type CompetitionOverrides = Partial<CompetitionFields>;

/**
 * `null` when the edit is not valid, judged with the values it would give (an edited start date against the FFTA end
 * date, for instance): the dates in order, each départ on one of the competition's days, one amount per case.
 */
export function checkOverrides(raw: unknown, ffta: CompetitionFields): CompetitionOverrides | null {
  const parsed = Overrides.safeParse(raw);
  if (!parsed.success) return null;
  const overrides = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as CompetitionOverrides;
  const startDate = overrides.startDate ?? ffta.startDate;
  const endDate = overrides.endDate ?? ffta.endDate;
  if (endDate < startDate) return null;
  if (overrides.departures?.some(({ date }) => date && (date < startDate || date > endDate))) return null;
  const amounts = new Map<string, number>();
  for (const { audience, departures, amountEuros } of overrides.prices ?? []) {
    const key = `${audience}|${departures}`;
    if ((amounts.get(key) ?? amountEuros) !== amountEuros) return null;
    amounts.set(key, amountEuros);
  }
  return overrides;
}
