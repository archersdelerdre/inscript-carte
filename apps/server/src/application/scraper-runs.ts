import type { ScraperProgress, ScraperReport } from '@inscript-carte/shared';

import type { Archer } from '../domain/archer.ts';
import type { Clock } from './ports/clock.ts';
import type { ScraperLauncher, ScraperRun, ScraperRunStore } from './ports/scraper-run-store.ts';
import type { SyncFftaCalendar } from './sync-ffta-calendar.ts';

/** The running process writes its heartbeat this often… */
export const HEARTBEAT_EVERY_MS = 10_000;
/** …so a run silent for this long is a dead process (crash, server restart). */
const STALE_AFTER_MS = 2 * 60_000;
/** Progress is written at most this often: the list pages and detail pages come about every second. */
const PROGRESS_EVERY_MS = 2_000;
const RECENT_RUNS = 10;
const FFTA_ID = /^\d{1,9}$/;

export type StartRunRequest = { kind?: unknown; fftaId?: unknown };
export type StartRunResult =
  | { ok: true; run: ScraperRun }
  | { ok: false; reason: 'invalid_request' | 'scraper_unavailable' }
  | { ok: false; reason: 'scraper_busy'; run: ScraperRun };

/** The server's side: who may start a run, and what the admin pages show. */
export class ScraperRuns {
  readonly #store: ScraperRunStore;
  /** `null` when the server has no browser (`CHROME_PATH` not set): runs cannot start. */
  readonly #launcher: ScraperLauncher | null;
  readonly #clock: Clock;

  constructor(store: ScraperRunStore, launcher: ScraperLauncher | null, clock: Clock) {
    this.#store = store;
    this.#launcher = launcher;
    this.#clock = clock;
  }

  get available(): boolean {
    return this.#launcher !== null;
  }

  #staleBefore(): Date {
    return new Date(this.#clock.now().getTime() - STALE_AFTER_MS);
  }

  async status(): Promise<{ current: ScraperRun | null; recent: ScraperRun[] }> {
    return { current: await this.#store.current(this.#staleBefore()), recent: await this.#store.recent(RECENT_RUNS) };
  }

  /**
   * Takes the lock and starts the process: a full run, or one competition (`fftaId`). `startedBy` is `null` for the
   * night run. Whoever asks second (another admin, the night run) gets the run already going.
   */
  async start(request: StartRunRequest, startedBy: Archer | null): Promise<StartRunResult> {
    const fftaId = typeof request.fftaId === 'string' && FFTA_ID.test(request.fftaId) ? request.fftaId : null;
    const isFull = request.kind === 'full';
    if (!isFull && !(request.kind === 'competition' && fftaId)) return { ok: false, reason: 'invalid_request' };
    if (!this.#launcher) return { ok: false, reason: 'scraper_unavailable' };

    const started = await this.#store.start(
      {
        kind: isFull ? 'full' : 'competition',
        fftaId: isFull ? null : fftaId,
        dryRun: false,
        startedBy: startedBy?.licenceNumber ?? null,
      },
      this.#clock.now(),
      this.#staleBefore(),
    );
    if (!started.ok) return { ok: false, reason: 'scraper_busy', run: started.running };
    this.#launcher.launch(started.run.id);
    return { ok: true, run: started.run };
  }

  /** For the command line: the same lock, with no process to launch (it is the command itself). */
  async startHere(run: { fftaId: string | null; dryRun: boolean }) {
    return this.#store.start(
      { kind: run.fftaId ? 'competition' : 'full', fftaId: run.fftaId, dryRun: run.dryRun, startedBy: null },
      this.#clock.now(),
      this.#staleBefore(),
    );
  }
}

/** The scraper process's side: does the run its row describes, and keeps the row up to date for the admins. */
export class ExecuteScraperRun {
  readonly #store: ScraperRunStore;
  readonly #sync: SyncFftaCalendar;
  readonly #clock: Clock;

  constructor(store: ScraperRunStore, sync: SyncFftaCalendar, clock: Clock) {
    this.#store = store;
    this.#sync = sync;
    this.#clock = clock;
  }

  async execute(
    run: ScraperRun,
    options: { maxDetails?: number; maxMandates?: number; onProgress?: (progress: ScraperProgress) => void } = {},
  ): Promise<ScraperReport | null> {
    let lastProgress: ScraperProgress | null = null;
    let lastWrite = 0;
    const write = (progress: ScraperProgress | null) => {
      lastWrite = this.#clock.now().getTime();
      void this.#store.heartbeat(run.id, progress, this.#clock.now());
    };
    // Even during a long page, the heartbeat says the process is alive.
    const heartbeat = setInterval(() => write(lastProgress), HEARTBEAT_EVERY_MS);
    const onProgress = (progress: ScraperProgress) => {
      const stepChanged = progress.step !== lastProgress?.step;
      lastProgress = progress;
      if (stepChanged || this.#clock.now().getTime() - lastWrite >= PROGRESS_EVERY_MS) write(progress);
      options.onProgress?.(progress);
    };

    try {
      const report =
        run.kind === 'competition' && run.fftaId
          ? await this.#sync.runOne(run.fftaId, { dryRun: run.dryRun, onProgress })
          : await this.#sync.run({
              dryRun: run.dryRun,
              maxDetails: options.maxDetails,
              maxMandates: options.maxMandates,
              onProgress,
            });
      await this.#store.finish(
        run.id,
        report.aborted ? 'failed' : 'succeeded',
        { report, ...(report.aborted ? { error: report.aborted } : {}) },
        this.#clock.now(),
      );
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#store.finish(run.id, 'failed', { error: `Erreur inattendue : ${message}` }, this.#clock.now());
      return null;
    } finally {
      clearInterval(heartbeat);
    }
  }
}
