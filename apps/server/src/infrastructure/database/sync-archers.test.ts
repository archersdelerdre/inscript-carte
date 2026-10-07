import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { Knex } from 'knex';

import type { Archer } from '../../domain/archer.ts';
import { createDatabase } from './connection.ts';
import { syncArchers } from './sync-archers.ts';

let database: Knex;

beforeEach(async () => {
  database = createDatabase(':memory:');
  await database.migrate.latest();
});

afterEach(() => database.destroy());

const archer = (licenceNumber: string, overrides: Partial<Archer> = {}): Archer => ({
  licenceNumber,
  fullName: `ARCHER ${licenceNumber}`,
  sex: 'female',
  birthDate: '1990-01-01',
  isActive: true,
  ...overrides,
});

const activeLicences = () =>
  database('archers').where({ is_active: true }).orderBy('licence_number').pluck('licence_number');

test('adds, updates and deactivates members to match the latest export', async () => {
  await syncArchers(database, [archer('0000001A'), archer('0000002B'), archer('0000003C')]);

  const result = await syncArchers(database, [
    archer('0000001A'),
    archer('0000002B', { fullName: 'NEW NAME' }),
    archer('0000004D'),
  ]);

  expect(result).toEqual({ added: 1, updated: 1, deactivated: 1, unchanged: 1 });
  expect(await activeLicences()).toEqual(['0000001A', '0000002B', '0000004D']);
  const renamed = await database('archers').where({ licence_number: '0000002B' }).first();
  expect(renamed.full_name).toBe('NEW NAME');
  // Members who left are kept (their registrations point to them), only deactivated.
  const departed = await database('archers').where({ licence_number: '0000003C' }).first();
  expect(departed.is_active).toBe(0);
});

test('reactivates a member who comes back in a later export', async () => {
  await syncArchers(database, [archer('0000001A'), archer('0000002B')]);
  await syncArchers(database, [archer('0000001A')]);

  const result = await syncArchers(database, [archer('0000001A'), archer('0000002B')]);

  expect(result).toEqual({ added: 0, updated: 1, deactivated: 0, unchanged: 1 });
  expect(await activeLicences()).toEqual(['0000001A', '0000002B']);
});
