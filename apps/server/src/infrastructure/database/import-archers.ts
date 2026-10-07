import { config } from '../config.ts';
import { readMemberExport } from '../members/ffta-member-export.ts';
import { createDatabase } from './connection.ts';
import { syncArchers } from './sync-archers.ts';

const path = Bun.argv[2];
if (!path) {
  console.error('Usage: bun run db:import-archers <path/to/member-export.xlsx>');
  process.exit(1);
}

// Personal data: only counts are printed, never names or birth dates.
const archers = await readMemberExport(path);
const database = createDatabase(config.databasePath);
try {
  await database.migrate.latest();
  const result = await syncArchers(database, archers);
  console.log(
    `${archers.length} members in the export: ${result.added} added, ${result.updated} updated, ` +
      `${result.unchanged} unchanged, ${result.deactivated} deactivated (missing from the export).`,
  );
} finally {
  await database.destroy();
}
