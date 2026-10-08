import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { ScraperReport } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import { createDatabase } from '../infrastructure/database/connection.ts';
import { SqliteScraperRunStore } from '../infrastructure/database/sqlite-scraper-run-store.ts';
import { ExecuteScraperRun, ScraperRuns } from './scraper-runs.ts';
import type { SyncFftaCalendar } from './sync-ffta-calendar.ts';

const clock = { today: () => '2026-10-08', now: () => new Date('2026-10-08T03:00:00Z') };
let database: Knex;
let store: SqliteScraperRunStore;

beforeEach(async () => {
  database = createDatabase(':memory:');
  await database.migrate.latest();
  store = new SqliteScraperRunStore(database);
});
afterEach(() => database.destroy());

const report = (aborted: string | null): ScraperReport => ({
  dryRun: false,
  aborted,
  pages: 75,
  listed: 1857,
  added: 3,
  changed: 1,
  unchanged: 1853,
  back: 0,
  missing: 0,
  detailsRead: 4,
  detailsLeft: 0,
  skippedAbroad: 0,
  skippedUnreadable: 0,
  positions: { fromFfta: 4, geocoded: 0, notFound: 0, notTried: 0 },
  mandates: null,
  problems: [],
  durationMs: 80_000,
});

/** A sync that ends with `outcome`: a report, or a thrown error. */
function sync(outcome: ScraperReport | Error): SyncFftaCalendar {
  const end = async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { run: end, runOne: end } as unknown as SyncFftaCalendar;
}

async function finished(outcome: ScraperReport | Error) {
  const started = await new ScraperRuns(store, null, clock).startHere({ fftaId: null, dryRun: false });
  if (!started.ok) throw new Error('no lock');
  await new ExecuteScraperRun(store, sync(outcome), clock).execute(started.run);
  return store.findById(started.run.id);
}

test('a run that went through succeeds, with its report, and frees the lock', async () => {
  expect(await finished(report(null))).toMatchObject({ status: 'succeeded', error: null, report: { added: 3 } });
  expect(await store.current(new Date(0))).toBeNull();
});

test('a run that stopped (Cloudflare, list not trusted) fails with its reason and its report', async () => {
  expect(await finished(report('La liste FFTA n’est pas fiable'))).toMatchObject({
    status: 'failed',
    error: 'La liste FFTA n’est pas fiable',
    report: { listed: 1857 },
  });
});

test('a run that crashed fails with the error, and frees the lock', async () => {
  expect(await finished(new Error('disk full'))).toMatchObject({
    status: 'failed',
    error: 'Erreur inattendue : disk full',
  });
  expect(await store.current(new Date(0))).toBeNull();
});
