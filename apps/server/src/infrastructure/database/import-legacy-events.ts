import type { Discipline } from '@inscript-carte/shared';

import { config } from '../config.ts';
import { geocodeTown, type GeocodedTown } from '../geocoding/town-geocoder.ts';
import { createDatabase } from './connection.ts';

/** One row of the old app's `events.json`, see `build()` in its `scraper.py`. */
type LegacyEvent = [
  id: string,
  title: string,
  startDate: string,
  endDate: string,
  disciplineCode: string,
  club: string,
  town: string,
  email: string,
  status: string,
  latitude: number | '',
  longitude: number | '',
  paraTir: '' | 'P',
  mandateUrl: string,
  departmentCode: string,
];

const DISCIPLINE_BY_CODE: Record<string, Discipline> = {
  S: 'salle',
  E: 'exterieur',
  C: 'campagne',
  T: '3d',
  N: 'nature',
  B: 'beursault',
  L: 'loisirs',
  A: 'autres',
};

const STATUS_BY_LABEL: Record<string, 'scheduled' | 'postponed'> = {
  '': 'scheduled',
  Reportée: 'postponed',
};

const path = Bun.argv[2];
if (!path) {
  console.error('Usage: bun run db:import-legacy-events <path/to/events.json>');
  process.exit(1);
}

const events: LegacyEvent[] = await Bun.file(path).json();
const database = createDatabase(config.databasePath);

const rows = events.map(
  ([
    id,
    title,
    startDate,
    endDate,
    disciplineCode,
    club,
    town,
    email,
    status,
    latitude,
    longitude,
    paraTir,
    mandateUrl,
    departmentCode,
  ]) => {
    const discipline = DISCIPLINE_BY_CODE[disciplineCode];
    if (!discipline) throw new Error(`Competition ${id}: unknown discipline code "${disciplineCode}"`);
    const competitionStatus = STATUS_BY_LABEL[status];
    if (!competitionStatus) throw new Error(`Competition ${id}: unknown status "${status}"`);

    return {
      ffta_id: id,
      title,
      discipline,
      status: competitionStatus,
      start_date: startDate,
      end_date: endDate,
      organizer_club: club || null,
      organizer_email: email || null,
      town,
      department_code: departmentCode,
      latitude: latitude === '' ? null : latitude,
      longitude: longitude === '' ? null : longitude,
      has_para_tir: paraTir === 'P',
      mandate_url: mandateUrl || null,
      updated_at: database.fn.now(),
    };
  },
);

const geocoded = new Map<string, GeocodedTown | null>();
for (const row of rows) {
  if (row.latitude !== null && row.longitude !== null) continue;
  const key = `${row.town}|${row.department_code}`;
  if (!geocoded.has(key)) {
    const result = await geocodeTown(row.town, row.department_code);
    console.log(
      `${result ? 'Located' : 'Not found'}: "${row.town}" (${row.department_code})`,
      result?.matchedPlace ?? '',
    );
    geocoded.set(key, result);
  }
  const position = geocoded.get(key);
  if (position) {
    row.latitude = position.latitude;
    row.longitude = position.longitude;
  }
}

try {
  await database.migrate.latest();
  await database.transaction(async (transaction) => {
    for (let start = 0; start < rows.length; start += 500) {
      await transaction('competitions')
        .insert(rows.slice(start, start + 500))
        .onConflict('ffta_id')
        .merge();
    }
  });
  console.log(`Imported ${rows.length} competitions from ${path}`);
} finally {
  await database.destroy();
}
