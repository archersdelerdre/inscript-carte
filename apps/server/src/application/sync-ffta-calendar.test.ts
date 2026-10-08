import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Knex } from 'knex';

import { createDatabase } from '../infrastructure/database/connection.ts';
import { SqliteScrapedCompetitionStore } from '../infrastructure/database/sqlite-scraped-competition-store.ts';
import type { CompetitionDetail, FftaCalendar, ListedCompetition } from './ports/ffta-calendar.ts';
import type { PlaceLocator } from './ports/scraped-competition-store.ts';
import { listingFingerprint, planSync, SyncFftaCalendar } from './sync-ffta-calendar.ts';

const TODAY = '2026-10-08';
const clock = { today: () => TODAY, now: () => new Date(`${TODAY}T03:00:00Z`) };

function listed(fftaId: string, overrides: Partial<ListedCompetition> = {}): ListedCompetition {
  return {
    fftaId,
    title: `CONCOURS ${fftaId}`,
    town: 'SAINT HERBLAIN',
    startDate: '2026-11-14',
    endDate: '2026-11-14',
    status: 'scheduled',
    discipline: 'salle',
    hasParaTir: false,
    organizerClub: 'ARCHERS DE TEST',
    organizerEmail: null,
    mandateUrl: null,
    ...overrides,
  };
}

function detail(competition: ListedCompetition, overrides: Partial<CompetitionDetail> = {}): CompetitionDetail {
  return {
    ...competition,
    championship: 'Individuel Tir à 18m 2027',
    hasDuels: false,
    regionalCommittee: 'COMITE REGIONAL DES PAYS DE LA LOIRE',
    departmentalCommittee: 'COMITE DEPARTEMENTAL LOIRE ATLANTIQUE',
    venue: 'GYMNASE DES TESTS',
    streetLines: ['12 RUE DE L EXEMPLE'],
    postalCode: '44800',
    city: 'SAINT HERBLAIN',
    country: 'FRANCE',
    position: { latitude: 47.21, longitude: -1.65 },
    departmentCode: '44',
    phone: null,
    email: 'club@example.org',
    website: null,
    ...overrides,
  };
}
const stored = (
  fftaId: string,
  fingerprint: string | null,
  startDate = '2026-11-14',
  missingSince: string | null = null,
) => ({
  fftaId,
  fingerprint,
  startDate,
  missingSince,
});

/** The FFTA site: this list, and these detail pages (a missing one throws, like Cloudflare). */
function calendar(list: ListedCompetition[], details: Record<string, CompetitionDetail | null>): FftaCalendar {
  return {
    readList: async () => ({ competitions: list, pages: 1, complete: true, problems: [] }),
    readCompetition: async (fftaId) => {
      if (!(fftaId in details)) throw new Error('Cloudflare blocked');
      return { detail: details[fftaId] ?? null, problems: [] };
    },
  };
}

describe('planSync', () => {
  test('sorts the list into new, changed and unchanged, and finds the ones back on the list', () => {
    const plan = planSync(
      [listed('1'), listed('2'), listed('3'), listed('4')],
      [
        stored('2', listingFingerprint(listed('2'))),
        stored('3', listingFingerprint(listed('3', { status: 'postponed' }))),
        stored('4', listingFingerprint(listed('4')), '2026-11-14', '2026-10-01'),
      ],
      TODAY,
      true,
    );
    expect(plan.added.map(({ fftaId }) => fftaId)).toEqual(['1']);
    expect(plan.changed.map(({ fftaId }) => fftaId)).toEqual(['3']);
    expect(plan.unchanged).toEqual(['2', '4']);
    expect(plan.back).toEqual(['4']);
  });

  test('reads again the rows the scraper never wrote (the legacy import)', () => {
    expect(planSync([listed('1')], [stored('1', null)], TODAY, true).changed).toHaveLength(1);
  });

  test('calls missing only upcoming rows not already missing, and only after a complete list', () => {
    const rows = [
      stored('gone', 'x'),
      stored('past', 'x', '2026-10-01'),
      stored('already', 'x', '2026-11-14', '2026-10-05'),
    ];
    expect(planSync([], rows, TODAY, true).missing).toEqual(['gone']);
    expect(planSync([], rows, TODAY, false).missing).toEqual([]);
  });
});

describe('SyncFftaCalendar', () => {
  let database: Knex;
  let store: SqliteScrapedCompetitionStore;
  let located: string[];
  const locator: PlaceLocator = {
    locate: async (place, departmentCode) => {
      located.push(`${place}|${departmentCode}`);
      return { latitude: 47, longitude: -1 };
    },
  };

  const sync = (list: ListedCompetition[], details: Record<string, CompetitionDetail | null>) =>
    new SyncFftaCalendar(calendar(list, details), store, locator, clock);
  const rows = () => database('competitions').orderBy('ffta_id');

  beforeEach(async () => {
    database = createDatabase(':memory:');
    await database.migrate.latest();
    store = new SqliteScrapedCompetitionStore(database);
    located = [];
  });
  afterEach(() => database.destroy());

  test('stores a new competition with its detail page, the FFTA position, and no geocoding', async () => {
    const one = listed('1');
    const report = await sync([one], { 1: detail(one) }).run({ dryRun: false });
    expect(report).toMatchObject({ aborted: null, added: 1, detailsRead: 1, positions: { fromFfta: 1, geocoded: 0 } });
    expect(await rows()).toMatchObject([
      {
        ffta_id: '1',
        title: 'CONCOURS 1',
        department_code: '44',
        latitude: 47.21,
        venue: 'GYMNASE DES TESTS',
        street_lines: '12 RUE DE L EXEMPLE',
        postal_code: '44800',
        list_fingerprint: listingFingerprint(one),
        missing_since: null,
      },
    ]);
    expect(located).toEqual([]);
  });

  test('geocodes the commune of the postal line when the FFTA gives no position', async () => {
    const one = listed('1', { town: 'GYMNASE MUNICIPAL' });
    await sync([one], { 1: detail(one, { position: null }) }).run({ dryRun: false });
    expect(located).toEqual(['SAINT HERBLAIN|44']);
    expect(await rows()).toMatchObject([{ latitude: 47, longitude: -1 }]);
  });

  test('a dry run reads everything but writes nothing and geocodes nothing', async () => {
    const one = listed('1');
    const report = await sync([one], { 1: detail(one, { position: null }) }).run({ dryRun: true });
    expect(report).toMatchObject({ dryRun: true, added: 1, detailsRead: 1, positions: { notTried: 1 } });
    expect(await rows()).toEqual([]);
    expect(located).toEqual([]);
  });

  test('reads an unchanged competition no more, and keeps what the scraper does not own', async () => {
    const one = listed('1');
    await sync([one], { 1: detail(one) }).run({ dryRun: false });
    await database('competitions').update({ has_foam_targets: true });

    const report = await sync([one], {}).run({ dryRun: false });
    expect(report).toMatchObject({ unchanged: 1, detailsRead: 0 });

    const changed = listed('1', { status: 'cancelled' });
    await sync([changed], { 1: detail(changed) }).run({ dryRun: false });
    expect(await rows()).toMatchObject([{ status: 'cancelled', has_foam_targets: 1 }]);
  });

  test('marks an upcoming competition gone from the list as missing, and clears it when it comes back', async () => {
    const one = listed('1');
    await sync([one], { 1: detail(one) }).run({ dryRun: false });

    expect((await sync([], {}).run({ dryRun: false })).missing).toBe(1);
    expect(await rows()).toMatchObject([{ missing_since: TODAY }]);

    expect((await sync([one], {}).run({ dryRun: false })).back).toBe(1);
    expect(await rows()).toMatchObject([{ missing_since: null }]);
  });

  test('skips a competition abroad and an unreadable page, and keeps them to read again', async () => {
    const abroad = listed('1');
    const unreadable = listed('2');
    const report = await sync([abroad, unreadable], { 1: detail(abroad, { departmentCode: null }), 2: null }).run({
      dryRun: false,
    });
    expect(report).toMatchObject({ skippedAbroad: 1, skippedUnreadable: 1 });
    expect(await rows()).toEqual([]);
  });

  test('reads at most `maxDetails` pages, and stops reading (keeping what it has) when the site blocks', async () => {
    const [one, two, three] = [listed('1'), listed('2'), listed('3')];
    const capped = await sync([one, two, three], { 1: detail(one), 2: detail(two), 3: detail(three) }).run({
      dryRun: false,
      maxDetails: 1,
    });
    expect(capped).toMatchObject({ detailsRead: 1, detailsLeft: 2 });

    // 2 can be read, then the site blocks on 3.
    const blocked = await sync([one, two, three], { 2: detail(two) }).run({ dryRun: false });
    expect(blocked).toMatchObject({ detailsRead: 1, detailsLeft: 1, aborted: null });
    expect((await rows()).map(({ ffta_id }) => ffta_id)).toEqual(['1', '2']);
  });

  test('writes nothing when the list cannot be read, or is far shorter than what is known', async () => {
    const failing: FftaCalendar = {
      readList: async () => {
        throw new Error('Cloudflare blocked');
      },
      readCompetition: async () => ({ detail: null, problems: [] }),
    };
    const blocked = await new SyncFftaCalendar(failing, store, locator, clock).run({ dryRun: false });
    expect(blocked.aborted).toContain('Cloudflare blocked');

    const known = Array.from({ length: 120 }, (_, index) => listed(String(index)));
    await sync(known, Object.fromEntries(known.map((competition) => [competition.fftaId, detail(competition)]))).run({
      dryRun: false,
    });
    const short = await sync(known.slice(0, 10), {}).run({ dryRun: false });
    expect(short.aborted).toContain('pas fiable');
    expect(await database('competitions').whereNotNull('missing_since').pluck('ffta_id')).toEqual([]);
  });
});
