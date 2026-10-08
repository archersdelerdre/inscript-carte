import type { MandateCounts } from '@inscript-carte/shared';

import type { CalendarDate } from '../domain/calendar-date.ts';
import { checkMandateData } from '../domain/mandate.ts';
import type { Clock } from './ports/clock.ts';
import type { MandateExtractor, MandateFetcher, MandateStore, PendingMandate } from './ports/mandates.ts';

/** A mandate that keeps failing is left alone after this many tries, until its link changes. */
export const MAX_MANDATE_ATTEMPTS = 3;
/** The LLM and the FFTA's file server are not the FFTA website: a few at once is fine. */
const CONCURRENCY = 3;

export type ReadMandatesOptions = {
  today: CalendarDate;
  /** Only these competitions (an admin's re-scrape of one). */
  fftaIds?: readonly string[];
  /**
   * Read them again even when already read, same file included (an admin found a wrong reading). A failed or
   * refused new reading never replaces a good one.
   */
  force?: boolean;
  /** At most this many in one run; the rest waits for the next. */
  limit?: number;
  onProgress?: (done: number, total: number) => void;
  /** One plain sentence per mandate that was not read, for the run's report. */
  onProblem?: (fftaId: string, problem: string) => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]!;

/**
 * Reads the mandates of the competitions that need it: download, one image per page, the LLM, then the checks. A
 * mandate that fails never stops the others, nor the run: it is tried again next time.
 */
export class ReadMandates {
  readonly #fetcher: MandateFetcher;
  readonly #extractor: MandateExtractor;
  readonly #store: MandateStore;
  readonly #clock: Clock;

  constructor(fetcher: MandateFetcher, extractor: MandateExtractor, store: MandateStore, clock: Clock) {
    this.#fetcher = fetcher;
    this.#extractor = extractor;
    this.#store = store;
    this.#clock = clock;
  }

  async run({
    today,
    fftaIds,
    force = false,
    limit = Infinity,
    onProgress = () => {},
    onProblem = () => {},
  }: ReadMandatesOptions): Promise<MandateCounts> {
    const pending = await this.#store.pending({ today, maxAttempts: MAX_MANDATE_ATTEMPTS, fftaIds, force });
    const reading = pending.slice(0, limit);
    const counts: MandateCounts = {
      read: 0,
      unchanged: 0,
      invalid: 0,
      failed: 0,
      left: pending.length - reading.length,
      costUsd: 0,
    };
    let done = 0;
    onProgress(done, reading.length);
    const queue = [...reading];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const problem = await this.#readOne(next, counts, force);
        if (problem) onProblem(next.fftaId, problem);
        onProgress(++done, reading.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, reading.length) }, worker));
    counts.costUsd = Math.round(counts.costUsd * 1e6) / 1e6;
    return counts;
  }

  /** The reason it was not read, if it was not. */
  async #readOne(mandate: PendingMandate, counts: MandateCounts, force: boolean): Promise<string | null> {
    const { fftaId, mandateUrl, previous } = mandate;
    const attempts = (!force && previous?.mandateUrl === mandateUrl ? previous.attempts : 0) + 1;
    const base = { fftaId, mandateUrl, attempts, rawAnswer: null, model: null, costUsd: null, data: null };
    // A forced re-read that goes wrong keeps the good reading there was.
    const keepsGood = force && previous?.status === 'parsed';
    const failure = async (problem: string, reading: () => Promise<void>) => {
      if (keepsGood) return `${problem} La lecture précédente du mandat est gardée.`;
      await reading();
      return problem;
    };

    let document;
    try {
      document = await this.#fetcher.fetch(mandateUrl);
    } catch (error) {
      counts.failed++;
      // The download, or turning the PDF into pages: both happen before the LLM.
      const problems = [`Le mandat n’a pas pu être ouvert : ${messageOf(error)}.`];
      return failure(problems[0]!, () =>
        this.#store.save({
          ...base,
          sha256: null,
          status: 'failed',
          problems,
          pageCount: null,
          readAt: this.#clock.now(),
        }),
      );
    }
    if (!force && previous?.status === 'parsed' && previous.sha256 === document.sha256) {
      counts.unchanged++;
      await this.#store.keepReading(fftaId, mandateUrl, this.#clock.now());
      return null;
    }

    const saved = { ...base, sha256: document.sha256, pageCount: document.pageCount };
    let answer;
    try {
      answer = await this.#extractor.extract(document, mandate);
    } catch (error) {
      counts.failed++;
      const problems = [`La lecture du mandat n’a pas abouti : ${messageOf(error)}.`];
      return failure(problems[0]!, () =>
        this.#store.save({ ...saved, status: 'failed', problems, readAt: this.#clock.now() }),
      );
    }
    counts.costUsd += answer.costUsd ?? 0;

    const check = checkMandateData(answer.answer, mandate);
    const reading = { ...saved, model: answer.model, costUsd: answer.costUsd, readAt: this.#clock.now() };
    if (check.ok) {
      counts.read++;
      await this.#store.save({ ...reading, status: 'parsed', data: check.data, problems: [] });
      return null;
    }
    counts.invalid++;
    const rawAnswer = JSON.stringify(answer.answer);
    return failure(`La réponse du LLM a été refusée par les contrôles (${check.problems[0]}).`, () =>
      this.#store.save({ ...reading, status: 'invalid', rawAnswer, problems: check.problems }),
    );
  }
}
