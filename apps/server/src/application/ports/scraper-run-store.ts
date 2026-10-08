import type { ScraperProgress, ScraperReport, ScraperRunKind, ScraperRunStatus } from '@inscript-carte/shared';

export type ScraperRun = {
  id: number;
  kind: ScraperRunKind;
  fftaId: string | null;
  dryRun: boolean;
  /** Licence number; `null` for the night run and the command line. */
  startedBy: string | null;
  startedByName: string | null;
  status: ScraperRunStatus;
  progress: ScraperProgress | null;
  report: ScraperReport | null;
  error: string | null;
  startedAt: Date;
  heartbeatAt: Date;
  finishedAt: Date | null;
};

export type NewScraperRun = Pick<ScraperRun, 'kind' | 'fftaId' | 'dryRun' | 'startedBy'>;

export type StartResult = { ok: true; run: ScraperRun } | { ok: false; running: ScraperRun };

/** The runs, and the lock: at most one `running` row (a unique index), whoever tries to start one. */
export interface ScraperRunStore {
  /**
   * Takes the lock, or says which run holds it. A `running` row with no heartbeat since `staleBefore` is a process
   * that died (crash, restart): it is marked `interrupted` first, so a dead run never blocks the button for good.
   */
  start(run: NewScraperRun, now: Date, staleBefore: Date): Promise<StartResult>;
  findById(id: number): Promise<ScraperRun | null>;
  /** The live `running` row, if its heartbeat is recent. */
  current(staleBefore: Date): Promise<ScraperRun | null>;
  /** Finished runs, latest first. */
  recent(limit: number): Promise<ScraperRun[]>;
  heartbeat(id: number, progress: ScraperProgress | null, now: Date): Promise<void>;
  finish(
    id: number,
    status: 'succeeded' | 'failed',
    result: { report?: ScraperReport; error?: string },
    now: Date,
  ): Promise<void>;
  /** For a process that ended without finishing its row: only touches a row still `running`. */
  failIfRunning(id: number, error: string, now: Date): Promise<void>;
}

/** Starts the scraper process for a run row; returns at once, the process writes its row itself. */
export interface ScraperLauncher {
  launch(runId: number): void;
}
