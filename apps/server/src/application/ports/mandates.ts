import type { MandateData } from '@inscript-carte/shared';

import type { CalendarDate } from '../../domain/calendar-date.ts';

/** A mandate PDF made ready for the LLM: one image per page, and its own text when it has some. */
export type MandateDocument = {
  sha256: string;
  pageCount: number;
  /** JPEG, at most a few pages (the first ones: the rest is rarely more than registration forms). */
  pageImages: Uint8Array[];
  /** Empty for a scanned mandate: then the images are all there is. */
  text: string;
};

/** Downloads a mandate and turns it into page images. Throws (a plain message) when it cannot. */
export interface MandateFetcher {
  fetch(url: string): Promise<MandateDocument>;
}

/** What the LLM is told about the competition, so it can tell its days and its départs apart. */
export type MandateContext = { title: string; town: string; startDate: CalendarDate; endDate: CalendarDate };

/** `answer` is the LLM's JSON as it came: checked by the application, never trusted. */
export type MandateAnswer = { answer: unknown; model: string; costUsd: number | null };

/** Sends a mandate to the LLM. Throws when it gets no usable answer (network, refusal, not JSON). */
export interface MandateExtractor {
  extract(document: MandateDocument, context: MandateContext): Promise<MandateAnswer>;
}

export type MandateStatus = 'parsed' | 'invalid' | 'failed';

/** A competition whose mandate must be read: a link never read, a new link, or a link to try again. */
export type PendingMandate = MandateContext & {
  fftaId: string;
  mandateUrl: string;
  /** What was read before for this competition, if anything. */
  previous: { mandateUrl: string; sha256: string | null; status: MandateStatus; attempts: number } | null;
};

export type MandateReading = {
  fftaId: string;
  mandateUrl: string;
  sha256: string | null;
  status: MandateStatus;
  attempts: number;
  data: MandateData | null;
  rawAnswer: string | null;
  problems: string[];
  model: string | null;
  costUsd: number | null;
  pageCount: number | null;
  readAt: Date;
};

export interface MandateStore {
  /**
   * Upcoming, listed, not cancelled competitions with a mandate link that has no reading yet, a reading of another
   * link, or a failed one tried fewer than `maxAttempts` times. Soonest first. `fftaIds` narrows to those.
   */
  pending(options: {
    today: CalendarDate;
    maxAttempts: number;
    fftaIds?: readonly string[];
  }): Promise<PendingMandate[]>;
  /** Also sets the competition's foam targets flag from a `parsed` reading ("yes" only). */
  save(reading: MandateReading): Promise<void>;
  /** Same file under a new link: only the link changes, the reading stays. */
  keepReading(fftaId: string, mandateUrl: string, readAt: Date): Promise<void>;
}
