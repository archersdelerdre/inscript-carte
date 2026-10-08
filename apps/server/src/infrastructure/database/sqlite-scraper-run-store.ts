import type { ScraperProgress, ScraperReport, ScraperRunKind, ScraperRunStatus } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type {
  NewScraperRun,
  ScraperRun,
  ScraperRunStore,
  StartResult,
} from '../../application/ports/scraper-run-store.ts';

type RunRow = {
  id: number;
  kind: ScraperRunKind;
  ffta_id: string | null;
  dry_run: 0 | 1;
  started_by: string | null;
  started_by_name: string | null;
  status: ScraperRunStatus;
  progress: string | null;
  report: string | null;
  error: string | null;
  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
};

function toRun(row: RunRow): ScraperRun {
  return {
    id: row.id,
    kind: row.kind,
    fftaId: row.ffta_id,
    dryRun: row.dry_run === 1,
    startedBy: row.started_by,
    startedByName: row.started_by_name,
    status: row.status,
    progress: row.progress ? (JSON.parse(row.progress) as ScraperProgress) : null,
    report: row.report ? (JSON.parse(row.report) as ScraperReport) : null,
    error: row.error,
    startedAt: new Date(row.started_at),
    heartbeatAt: new Date(row.heartbeat_at),
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
  };
}

const isUniqueViolation = (error: unknown) => error instanceof Error && /UNIQUE/.test(error.message);

export class SqliteScraperRunStore implements ScraperRunStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  #runs(database: Knex | Knex.Transaction = this.#database) {
    return database('scraper_runs')
      .leftJoin('archers', 'archers.licence_number', 'scraper_runs.started_by')
      .select('scraper_runs.*', 'archers.full_name as started_by_name');
  }

  async start(run: NewScraperRun, now: Date, staleBefore: Date): Promise<StartResult> {
    return this.#database.transaction(async (transaction) => {
      await transaction('scraper_runs')
        .where({ status: 'running' })
        .where('heartbeat_at', '<', staleBefore.toISOString())
        .update({
          status: 'interrupted',
          error: 'Le processus ne donnait plus de nouvelles (arrêt du serveur ?).',
          finished_at: now.toISOString(),
        });
      try {
        const [id] = await transaction('scraper_runs').insert({
          kind: run.kind,
          ffta_id: run.fftaId,
          dry_run: run.dryRun,
          started_by: run.startedBy,
          status: 'running',
          started_at: now.toISOString(),
          heartbeat_at: now.toISOString(),
        });
        const row: RunRow = await this.#runs(transaction).where('scraper_runs.id', id).first();
        return { ok: true, run: toRun(row) };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const row: RunRow = await this.#runs(transaction).where('scraper_runs.status', 'running').first();
        return { ok: false, running: toRun(row) };
      }
    });
  }

  async findById(id: number): Promise<ScraperRun | null> {
    const row: RunRow | undefined = await this.#runs().where('scraper_runs.id', id).first();
    return row ? toRun(row) : null;
  }

  async current(staleBefore: Date): Promise<ScraperRun | null> {
    const row: RunRow | undefined = await this.#runs()
      .where('scraper_runs.status', 'running')
      .where('scraper_runs.heartbeat_at', '>=', staleBefore.toISOString())
      .first();
    return row ? toRun(row) : null;
  }

  async recent(limit: number): Promise<ScraperRun[]> {
    const rows: RunRow[] = await this.#runs()
      .whereNot('scraper_runs.status', 'running')
      .orderBy('scraper_runs.id', 'desc')
      .limit(limit);
    return rows.map(toRun);
  }

  async heartbeat(id: number, progress: ScraperProgress | null, now: Date): Promise<void> {
    await this.#database('scraper_runs')
      .where({ id, status: 'running' })
      .update({ heartbeat_at: now.toISOString(), ...(progress ? { progress: JSON.stringify(progress) } : {}) });
  }

  async finish(
    id: number,
    status: 'succeeded' | 'failed',
    result: { report?: ScraperReport; error?: string },
    now: Date,
  ): Promise<void> {
    await this.#database('scraper_runs')
      .where({ id })
      .update({
        status,
        report: result.report ? JSON.stringify(result.report) : null,
        error: result.error ?? null,
        finished_at: now.toISOString(),
        heartbeat_at: now.toISOString(),
      });
  }

  async failIfRunning(id: number, error: string, now: Date): Promise<void> {
    await this.#database('scraper_runs')
      .where({ id, status: 'running' })
      .update({ status: 'failed', error, finished_at: now.toISOString() });
  }
}
