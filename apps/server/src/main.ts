import { createApp } from './app.ts';
import { ScraperRuns } from './application/scraper-runs.ts';
import { appVersion } from './infrastructure/app-version.ts';
import { config } from './infrastructure/config.ts';
import { createDatabase } from './infrastructure/database/connection.ts';
import { SqliteScraperRunStore } from './infrastructure/database/sqlite-scraper-run-store.ts';
import { scheduleNightlyScraper } from './infrastructure/ffta/nightly-scraper.ts';
import { ProcessScraperLauncher } from './infrastructure/ffta/process-scraper-launcher.ts';
import { SystemClock } from './infrastructure/system-clock.ts';
import { createStaticFiles } from './presentation/http/static-files.ts';

const database = createDatabase(config.databasePath);
const [, appliedMigrations] = await database.migrate.latest();
if (appliedMigrations.length > 0) console.log(`Applied migrations: ${appliedMigrations.join(', ')}`);

const clock = new SystemClock();
const scraperRunStore = new SqliteScraperRunStore(database);
// Without a browser the scraper cannot run: the admin page says so, and no night run is scheduled.
const scraperRuns = new ScraperRuns(
  scraperRunStore,
  config.chromePath ? new ProcessScraperLauncher(scraperRunStore, clock) : null,
  clock,
);
if (scraperRuns.available) scheduleNightlyScraper(scraperRuns);
else console.log('FFTA scraper off: CHROME_PATH is not set.');

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });
const staticFiles = config.clientDistPath ? createStaticFiles(config.clientDistPath) : null;

const server = Bun.serve({
  port: config.port,
  routes: createApp(database, clock, scraperRuns),
  // Unknown API paths stay JSON errors; everything else is the client, when it is served from here.
  fetch: (request) =>
    staticFiles && !new URL(request.url).pathname.startsWith('/api/') ? staticFiles(request) : notFound(),
});

console.log(`Server listening on ${server.url}`);
console.log(`Version: ${await appVersion()}`);
