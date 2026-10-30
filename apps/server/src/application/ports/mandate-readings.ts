import type { MandateStatus } from './mandates.ts';

/** The last reading stored for one competition, whatever its link: it may be of an older one. */
export type MandateReadingState = {
  mandateUrl: string;
  status: MandateStatus;
  attempts: number;
  /** Why it is `invalid` or `failed`; for `parsed`, what it left out (its prices, when they contradicted each other). */
  problems: string[];
};

export interface MandateReadings {
  /** By FFTA id. */
  all(): Promise<Map<string, MandateReadingState>>;
}
