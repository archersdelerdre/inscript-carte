import { createApp } from './app.ts';
import { config } from './infrastructure/config.ts';
import { createDatabase } from './infrastructure/database/connection.ts';
import { SystemClock } from './infrastructure/system-clock.ts';

const database = createDatabase(config.databasePath);
const [, appliedMigrations] = await database.migrate.latest();
if (appliedMigrations.length > 0) console.log(`Applied migrations: ${appliedMigrations.join(', ')}`);

const server = Bun.serve({
  port: config.port,
  routes: createApp(database, new SystemClock()),
  fetch: () => Response.json({ error: 'not_found' }, { status: 404 }),
});

console.log(`Server listening on ${server.url}`);
