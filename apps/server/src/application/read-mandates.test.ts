import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { Knex } from 'knex';

import { createDatabase } from '../infrastructure/database/connection.ts';
import { SqliteMandateStore } from '../infrastructure/database/sqlite-mandate-store.ts';
import type { MandateDocument, MandateExtractor, MandateFetcher } from './ports/mandates.ts';
import { MAX_MANDATE_ATTEMPTS, ReadMandates } from './read-mandates.ts';

const TODAY = '2026-10-09';
const clock = { today: () => TODAY, now: () => new Date(`${TODAY}T03:00:00Z`) };

const goodAnswer = (foamTargets = 'not_mentioned') => ({
  departures: [{ date: '2026-11-14', label: 'Samedi matin', registrationOpens: '08:00', shootingStarts: '09:00' }],
  prices: [
    { audience: 'adult', departures: 1, amountEuros: 9 },
    { audience: 'adult', departures: 2, amountEuros: 16 },
  ],
  foamTargets,
  evidence: { departures: null, prices: '1 tir 9 €, 2 tirs 16 €', foamTargets: null },
});

let database: Knex;
let store: SqliteMandateStore;
/** What each mandate link downloads to: its file's hash, or an error. */
let files: Record<string, string | Error>;
/** The LLM's answer for each file hash. */
let answers: Record<string, unknown>;
let llmCalls: string[];

const fetcher: MandateFetcher = {
  fetch: async (url) => {
    const file = files[url];
    if (file === undefined || file instanceof Error) throw file ?? new Error('404');
    return { sha256: file, pageCount: 2, pageImages: [new Uint8Array([1])], text: '' } satisfies MandateDocument;
  },
};
const extractor: MandateExtractor = {
  extract: async (document) => {
    llmCalls.push(document.sha256);
    return { answer: answers[document.sha256], model: 'z-ai/glm-5.3-flash', costUsd: 0.0013 };
  },
};
const read = (options: { fftaIds?: string[]; limit?: number } = {}) =>
  new ReadMandates(fetcher, extractor, store, clock).run({ today: TODAY, ...options });

/** Every column given, so a multi-row insert never turns a missing one into NULL. */
const competition = (ffta_id: string, overrides: Record<string, unknown> = {}) => ({
  ffta_id,
  title: `CONCOURS ${ffta_id}`,
  discipline: 'salle',
  status: 'scheduled',
  start_date: '2026-11-14',
  end_date: '2026-11-15',
  town: 'NANTES',
  department_code: '44',
  mandate_url: `https://extranet.ffta.fr/medias/documents_epreuves/${ffta_id}.pdf`,
  missing_since: null,
  ...overrides,
});
const urlOf = (id: string) => `https://extranet.ffta.fr/medias/documents_epreuves/${id}.pdf`;
const mandateRow = (id: string) => database('competition_mandates').where({ ffta_id: id }).first();

beforeEach(async () => {
  database = createDatabase(':memory:');
  await database.migrate.latest();
  store = new SqliteMandateStore(database);
  files = {};
  answers = {};
  llmCalls = [];
});
afterEach(() => database.destroy());

test('reads a new mandate, stores what it says, and marks the foam targets it names', async () => {
  await database('competitions').insert([competition('1'), competition('2')]);
  files = { [urlOf('1')]: 'hash-1', [urlOf('2')]: 'hash-2' };
  answers = { 'hash-1': goodAnswer('yes'), 'hash-2': goodAnswer() };

  expect(await read()).toEqual({ read: 2, unchanged: 0, invalid: 0, failed: 0, left: 0, costUsd: 0.0026 });
  const row = await mandateRow('1');
  expect(row).toMatchObject({ status: 'parsed', sha256: 'hash-1', attempts: 1, model: 'z-ai/glm-5.3-flash' });
  expect(JSON.parse(row.data).prices).toEqual(goodAnswer().prices);
  expect(await database('competitions').orderBy('ffta_id').pluck('has_foam_targets')).toEqual([1, 0]);

  // Read once: the next run has nothing to do.
  expect(await read()).toMatchObject({ read: 0 });
  expect(llmCalls).toEqual(['hash-1', 'hash-2']);
});

test('only reads upcoming, listed, not cancelled competitions that have a mandate', async () => {
  await database('competitions').insert([
    competition('past', { start_date: '2026-09-01', end_date: '2026-09-01' }),
    competition('cancelled', { status: 'cancelled' }),
    competition('missing', { missing_since: '2026-10-01' }),
    competition('none', { mandate_url: null }),
    competition('upcoming'),
  ]);
  files = { [urlOf('upcoming')]: 'hash-u' };
  answers = { 'hash-u': goodAnswer() };
  await read();
  expect(await database('competition_mandates').pluck('ffta_id')).toEqual(['upcoming']);
});

test('a new link to the very same file is not sent to the LLM again', async () => {
  await database('competitions').insert(competition('1'));
  files = { [urlOf('1')]: 'hash-1', 'https://extranet.ffta.fr/new.pdf': 'hash-1' };
  answers = { 'hash-1': goodAnswer() };
  await read();
  await database('competitions').update({ mandate_url: 'https://extranet.ffta.fr/new.pdf' });

  expect(await read()).toMatchObject({ read: 0, unchanged: 1 });
  expect(llmCalls).toEqual(['hash-1']);
  expect(await mandateRow('1')).toMatchObject({ status: 'parsed', mandate_url: 'https://extranet.ffta.fr/new.pdf' });
});

test('a mandate that keeps failing is tried a few times, then waits for a new link', async () => {
  await database('competitions').insert(competition('1'));
  files = { [urlOf('1')]: new Error('the FFTA server answers 500') };
  for (let run = 1; run <= MAX_MANDATE_ATTEMPTS; run++) expect(await read()).toMatchObject({ failed: 1 });
  expect(await mandateRow('1')).toMatchObject({
    status: 'failed',
    attempts: MAX_MANDATE_ATTEMPTS,
    problems: 'Le mandat n’a pas pu être ouvert : the FFTA server answers 500.',
  });
  expect(await read()).toMatchObject({ failed: 0 });

  const problems: string[] = [];
  await database('competitions').update({ mandate_url: 'https://extranet.ffta.fr/still-broken.pdf' });
  await new ReadMandates(fetcher, extractor, store, clock).run({
    today: TODAY,
    onProblem: (fftaId, problem) => problems.push(`${fftaId}: ${problem}`),
  });
  expect(problems).toEqual(['1: Le mandat n’a pas pu être ouvert : 404.']);

  // The organizer uploads another mandate: it is read, and the tries start again.
  await database('competitions').update({ mandate_url: 'https://extranet.ffta.fr/fixed.pdf' });
  files['https://extranet.ffta.fr/fixed.pdf'] = 'hash-fixed';
  answers = { 'hash-fixed': goodAnswer() };
  expect(await read()).toMatchObject({ read: 1 });
  expect(await mandateRow('1')).toMatchObject({ status: 'parsed', attempts: 1 });
});

test('an answer the checks refuse is kept as it came, never as data, and the foam flag is left alone', async () => {
  await database('competitions').insert(competition('1', { has_foam_targets: true }));
  files = { [urlOf('1')]: 'hash-1' };
  answers = { 'hash-1': { ...goodAnswer(), prices: [{ audience: 'adult', departures: 1, amountEuros: 900 }] } };

  expect(await read()).toMatchObject({ invalid: 1 });
  const row = await mandateRow('1');
  expect(row).toMatchObject({ status: 'invalid', data: null });
  expect(JSON.parse(row.raw_answer).prices[0].amountEuros).toBe(900);
  expect(row.problems).toContain('prices.0.amountEuros');
  expect(await database('competitions').pluck('has_foam_targets')).toEqual([1]);
});

test('reads at most `limit` mandates, soonest first, and one competition when asked', async () => {
  await database('competitions').insert([
    competition('later', { start_date: '2027-01-09', end_date: '2027-01-09' }),
    competition('soon'),
  ]);
  files = { [urlOf('later')]: 'hash-l', [urlOf('soon')]: 'hash-s' };
  answers = { 'hash-l': { ...goodAnswer(), departures: [] }, 'hash-s': goodAnswer() };

  expect(await read({ limit: 1 })).toMatchObject({ read: 1, left: 1 });
  expect(llmCalls).toEqual(['hash-s']);
  expect(await read({ fftaIds: ['later'] })).toMatchObject({ read: 1, left: 0 });
});
