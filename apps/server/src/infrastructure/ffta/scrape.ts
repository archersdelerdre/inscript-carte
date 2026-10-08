/**
 * One run of the FFTA scraper: `bun run scrape [--dry-run] [--max-details N]`. `--dry-run` reads everything and shows
 * what would change, writing nothing. Prints counts only (no names, emails or phone numbers). Needs `CHROME_PATH`.
 */
import { parseArgs } from 'node:util';

import { SyncFftaCalendar, type SyncProgress } from '../../application/sync-ffta-calendar.ts';
import { config } from '../config.ts';
import { createDatabase } from '../database/connection.ts';
import { SqliteScrapedCompetitionStore } from '../database/sqlite-scraped-competition-store.ts';
import { GeoplateformePlaceLocator } from '../geocoding/geoplateforme-place-locator.ts';
import { SystemClock } from '../system-clock.ts';
import { FftaBrowser } from './ffta-browser.ts';
import { BrowserFftaCalendar } from './ffta-calendar.ts';

const { values: options } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false }, 'max-details': { type: 'string' } },
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

function progressLine(progress: SyncProgress): string {
  if (progress.step === 'list') return `Liste : page ${progress.page}, ${progress.found} concours`;
  if (progress.step === 'details') return `Fiches : ${progress.done}/${progress.total}`;
  return 'Enregistrement…';
}

const database = createDatabase(config.databasePath);
const browser = await FftaBrowser.open(config.chromePath);
try {
  await database.migrate.latest();
  const sync = new SyncFftaCalendar(
    new BrowserFftaCalendar(browser),
    new SqliteScrapedCompetitionStore(database),
    new GeoplateformePlaceLocator(),
    new SystemClock(),
  );
  const report = await sync.run({
    dryRun: options['dry-run'],
    maxDetails,
    onProgress: (progress) => process.stdout.write(`\r${progressLine(progress).padEnd(50)}`),
  });
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
  if (report.aborted) process.exitCode = 1;
} finally {
  await browser.close();
  await database.destroy();
}
