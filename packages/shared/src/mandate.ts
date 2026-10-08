/** What the FFTA mandate (the organizer's PDF) says, as read by an LLM and checked by the server. */

export const MANDATE_AUDIENCES = ['adult', 'youth', 'all'] as const;
/** `all`: the mandate gives one price for everyone. */
export type MandateAudience = (typeof MANDATE_AUDIENCES)[number];

export const FOAM_TARGETS_ANSWERS = ['yes', 'no', 'not_mentioned'] as const;
/** Most mandates never say: `not_mentioned` is never read as "no". */
export type FoamTargetsAnswer = (typeof FOAM_TARGETS_ANSWERS)[number];

export type MandateDeparture = {
  /** `YYYY-MM-DD`, `null` when the mandate does not say which day. */
  date: string | null;
  /** As the mandate names it: "Samedi après-midi", "Départ 2". */
  label: string;
  /** `HH:MM`, `null` when not given. */
  registrationOpens: string | null;
  shootingStarts: string | null;
};

/** The total price for `departures` départs, for that audience: "2 tirs 16 €" is `{ departures: 2, amountEuros: 16 }`. */
export type MandatePrice = { audience: MandateAudience; departures: number; amountEuros: number };

export type MandateData = {
  departures: MandateDeparture[];
  prices: MandatePrice[];
  foamTargets: FoamTargetsAnswer;
  /** The mandate's own words for each answer, so an admin can check it in a second. */
  evidence: { departures: string | null; prices: string | null; foamTargets: string | null };
};
