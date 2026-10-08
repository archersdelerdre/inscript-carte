/**
 * Locates every upcoming competition again from its stored postal code and commune, like the scraper now does. For
 * the positions stored when the scraper still trusted the FFTA's map point (some were hundreds of km off).
 * `bun run db:relocate [--dry-run]`: `--dry-run` counts what would change and writes nothing. Counts only.
 */
import type { GeoPosition } from '@inscript-carte/shared';

import { config } from '../config.ts';
import { GeoplateformePlaceLocator } from '../geocoding/geoplateforme-place-locator.ts';
import { SystemClock } from '../system-clock.ts';
import { createDatabase } from './connection.ts';

/** The address service allows 50 requests per second; a few at a time is plenty. */
const CONCURRENCY = 4;
/** Closer than this, the old point was fine (a hall at the edge of town). */
const MOVED_KM = 2;

type Row = {
  ffta_id: string;
  department_code: string;
  postal_code: string | null;
  city: string | null;
  town: string;
  latitude: number | null;
  longitude: number | null;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function kilometres(a: GeoPosition, b: GeoPosition): number {
  const h =
    Math.sin(radians(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const dryRun = Bun.argv.includes('--dry-run');
const database = createDatabase(config.databasePath);
const locator = new GeoplateformePlaceLocator();
try {
  const rows: Row[] = await database('competitions')
    .where('end_date', '>=', new SystemClock().today())
    .select('ffta_id', 'department_code', 'postal_code', 'city', 'town', 'latitude', 'longitude');
  const counts = { competitions: rows.length, moved: 0, located: 0, sameAsBefore: 0, notFound: 0, failed: 0 };
  const located = new Map<string, Promise<GeoPosition | null>>();
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const place = { postalCode: row.postal_code, city: row.city, town: row.town };
      const key = `${place.postalCode}|${place.city ?? place.town}|${row.department_code}`;
      if (!located.has(key)) located.set(key, locator.locate(place, row.department_code));
      let position;
      try {
        position = await located.get(key);
      } catch {
        counts.failed++;
        continue;
      }
      if (!position) {
        // Kept as it was: an old point is better than none, and the run reports these in its count.
        counts.notFound++;
        continue;
      }
      const before =
        row.latitude === null || row.longitude === null ? null : { latitude: row.latitude, longitude: row.longitude };
      if (!before) counts.located++;
      else if (kilometres(before, position) > MOVED_KM) counts.moved++;
      else counts.sameAsBefore++;
      if (!dryRun) await database('competitions').where({ ffta_id: row.ffta_id }).update(position);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(dryRun ? 'DRY RUN, nothing written.' : 'Written.');
  console.log(
    `${counts.competitions} upcoming competitions: ${counts.moved} moved by more than ${MOVED_KM} km, ` +
      `${counts.located} located (had no position), ${counts.sameAsBefore} where they were, ` +
      `${counts.notFound} not found (kept as they were), ${counts.failed} failed (address service error).`,
  );
} finally {
  await database.destroy();
}
