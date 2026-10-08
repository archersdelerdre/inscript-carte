/**
 * One FFTA scraper run. Started by the server as `scrape.ts --run <id>` (the run's row says what to do), or by hand:
 * `bun run scrape [--competition <id>] [--dry-run] [--max-details N]`. By hand it takes the same lock, so it never
 * runs next to another run, and the admins see it. `--dry-run` reads everything and writes nothing. Prints counts
 * only (no names, emails or phone numbers). Needs `CHROME_PATH`.
 */
import { parseArgs } from 'node:util';

import type { ScraperProgress, ScraperReport } from '@inscript-carte/shared';

import { ExecuteScraperRun, ScraperRuns } from '../../application/scraper-runs.ts';
import { SyncFftaCalendar } from '../../application/sync-ffta-calendar.ts';
import { config } from '../config.ts';
import { createDatabase } from '../database/connection.ts';
import { SqliteScrapedCompetitionStore } from '../database/sqlite-scraped-competition-store.ts';
import { SqliteScraperRunStore } from '../database/sqlite-scraper-run-store.ts';
import { GeoplateformePlaceLocator } from '../geocoding/geoplateforme-place-locator.ts';
import { SystemClock } from '../system-clock.ts';
import { FftaBrowser } from './ffta-browser.ts';
import { BrowserFftaCalendar } from './ffta-calendar.ts';

const { values: options } = parseArgs({
  options: {
    run: { type: 'string' },
    competition: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'max-details': { type: 'string' },
  },
});
const maxDetails = options['max-details'] === undefined ? Infinity : Number(options['max-details']);
if (!config.chromePath) {
  console.error('CHROME_PATH is not set: install chrome-headless-shell first (see AGENTS.md).');
  process.exit(1);
}
if (Number.isNaN(maxDetails) || maxDetails < 0) {
  console.error('--max-details expects a number.');
  process.exit(1);
}

function progressLine(progress: ScraperProgress): string {
  if (progress.step === 'list') return `Liste : page ${progress.page}, ${progress.found} concours`;
  if (progress.step === 'details') return `Fiches : ${progress.done}/${progress.total}`;
  return 'Enregistrement…';
}

function printReport(report: ScraperReport) {
  console.log(`\n${report.dryRun ? 'DRY RUN, nothing written. ' : ''}${Math.round(report.durationMs / 1000)} s`);
  if (report.aborted) console.log(`Stopped: ${report.aborted}`);
  console.log(
    `List: ${report.listed} competitions on ${report.pages} pages | new ${report.added}, changed ${report.changed}, ` +
      `unchanged ${report.unchanged} (back ${report.back}), missing ${report.missing}`,
  );
  console.log(
    `Details: ${report.detailsRead} read, ${report.detailsLeft} left for the next run, ` +
      `skipped ${report.skippedAbroad} abroad and ${report.skippedUnreadable} unreadable`,
  );
  const { fromFfta, geocoded, notFound, notTried } = report.positions;
  console.log(
    `Positions: ${fromFfta} from the FFTA, ${geocoded} geocoded, ${notFound} not found, ${notTried} not tried`,
  );
  const { problems } = report;
  console.log(problems.length === 0 ? 'No problem.' : `${problems.length} problem(s):\n${problems.join('\n')}`);
}

const clock = new SystemClock();
const database = createDatabase(config.databasePath);
try {
  await database.migrate.latest();
  const runStore = new SqliteScraperRunStore(database);

  let run;
  if (options.run) {
    run = await runStore.findById(Number(options.run));
    if (run?.status !== 'running') throw new Error(`Run ${options.run} is not waiting to run.`);
  } else {
    const started = await new ScraperRuns(runStore, null, clock).startHere({
      fftaId: options.competition ?? null,
      dryRun: options['dry-run'],
    });
    if (!started.ok) {
      console.error(
        `A run is already going (run ${started.running.id}, started ${started.running.startedAt.toISOString()}).`,
      );
      process.exit(1);
    }
    run = started.run;
  }

  let browser;
  try {
    browser = await FftaBrowser.open(config.chromePath, { noSandbox: config.chromeNoSandbox });
  } catch (error) {
    // The lock is taken: the run must not stay "running" until it looks dead.
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    await runStore.finish(run.id, 'failed', { error: `Le navigateur n'a pas pu démarrer : ${message}` }, clock.now());
    throw error;
  }
  try {
    const sync = new SyncFftaCalendar(
      new BrowserFftaCalendar(browser),
      new SqliteScrapedCompetitionStore(database),
      new GeoplateformePlaceLocator(),
      clock,
    );
    const report = await new ExecuteScraperRun(runStore, sync, clock).execute(run, {
      maxDetails,
      onProgress: (progress) => process.stdout.write(`\r${progressLine(progress).padEnd(50)}`),
    });
    if (report) printReport(report);
    else console.log('\nThe run failed: see its error in the admin page.');
    if (!report || report.aborted) process.exitCode = 1;
  } finally {
    await browser.close();
  }
} finally {
  await database.destroy();
}
