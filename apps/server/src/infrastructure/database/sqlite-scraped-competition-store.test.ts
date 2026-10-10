import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { Knex } from 'knex';

import type { CompetitionDetail } from '../../application/ports/ffta-calendar.ts';
import { createDatabase } from './connection.ts';
import { SqliteScrapedCompetitionStore } from './sqlite-scraped-competition-store.ts';

const detail = (mandateUrl: string | null): CompetitionDetail => ({
  fftaId: '90001',
  title: 'CONCOURS SALLE',
  town: 'NANTES',
  startDate: '2027-01-09',
  endDate: '2027-01-09',
  status: 'scheduled',
  discipline: 'salle',
  hasParaTir: false,
  championship: null,
  hasDuels: null,
  regionalCommittee: null,
  departmentalCommittee: null,
  organizerClub: null,
  venue: null,
  streetLines: [],
  postalCode: '44000',
  city: 'NANTES',
  country: 'FRANCE',
  departmentCode: '44',
  phone: null,
  email: null,
  website: null,
  mandateUrl,
});

let database: Knex;
let store: SqliteScrapedCompetitionStore;

beforeEach(async () => {
  database = createDatabase(':memory:');
  await database.migrate.latest();
  store = new SqliteScrapedCompetitionStore(database);
});

afterEach(() => database.destroy());

const save = (mandateUrl: string | null, today: string) => {
  const read = detail(mandateUrl);
  const listed = { ...read, organizerEmail: null };
  return store.save(
    [{ listed, fingerprint: today, detail: read, departmentCode: '44', position: null }],
    new Date(),
    today,
  );
};

const addedOn = async () =>
  (await database('competitions').where({ ffta_id: '90001' }).first('mandate_added_on')).mandate_added_on;

test('the mandate day is the first run that sees a link, kept for another file, cleared when the link goes', async () => {
  await save(null, '2026-11-01');
  expect(await addedOn()).toBeNull();

  await save('https://extranet.ffta.fr/a.pdf', '2026-11-02');
  expect(await addedOn()).toBe('2026-11-02');

  // The organizer uploads a new file: archers already had the mandate.
  await save('https://extranet.ffta.fr/b.pdf', '2026-11-05');
  await store.saveDetail(detail('https://extranet.ffta.fr/b.pdf'), '44', null, new Date(), '2026-11-06');
  expect(await addedOn()).toBe('2026-11-02');

  await save(null, '2026-11-07');
  expect(await addedOn()).toBeNull();
  await store.saveDetail(detail('https://extranet.ffta.fr/c.pdf'), '44', null, new Date(), '2026-11-08');
  expect(await addedOn()).toBe('2026-11-08');
});

test('a link stored before the day was tracked keeps an unknown day', async () => {
  await save('https://extranet.ffta.fr/a.pdf', '2026-11-02');
  await database('competitions').update({ mandate_added_on: null });

  await save('https://extranet.ffta.fr/a.pdf', '2026-11-03');
  expect(await addedOn()).toBeNull();
});
