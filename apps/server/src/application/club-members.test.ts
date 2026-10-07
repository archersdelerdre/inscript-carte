import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { Knex } from 'knex';

import type { Archer } from '../domain/archer.ts';
import { createDatabase } from '../infrastructure/database/connection.ts';
import { SqliteAdminRepository } from '../infrastructure/database/sqlite-admin-repository.ts';
import { SqliteMemberListRepository } from '../infrastructure/database/sqlite-member-list-repository.ts';
import { ClubMembers } from './club-members.ts';

let database: Knex;
let memberList: ClubMembers;

beforeEach(async () => {
  database = createDatabase(':memory:');
  await database.migrate.latest();
  memberList = new ClubMembers(new SqliteMemberListRepository(database), new SqliteAdminRepository(database), {
    today: () => '2026-10-07',
    now: () => new Date('2026-10-07T10:00:00Z'),
  });
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
  await memberList.import([archer('0000001A'), archer('0000002B'), archer('0000003C')], null);

  const result = await memberList.import(
    [archer('0000001A'), archer('0000002B', { fullName: 'NEW NAME' }), archer('0000004D')],
    null,
  );

  expect(result).toEqual({ added: 1, updated: 1, deactivated: 1, unchanged: 1 });
  expect(await activeLicences()).toEqual(['0000001A', '0000002B', '0000004D']);
  const renamed = await database('archers').where({ licence_number: '0000002B' }).first();
  expect(renamed.full_name).toBe('NEW NAME');
  // Members who left are kept (their registrations point to them), only deactivated.
  const departed = await database('archers').where({ licence_number: '0000003C' }).first();
  expect(departed.is_active).toBe(0);
});

test('reactivates a member who comes back in a later export', async () => {
  await memberList.import([archer('0000001A'), archer('0000002B')], null);
  await memberList.import([archer('0000001A')], null);

  const result = await memberList.import([archer('0000001A'), archer('0000002B')], null);

  expect(result).toEqual({ added: 0, updated: 1, deactivated: 0, unchanged: 1 });
  expect(await activeLicences()).toEqual(['0000001A', '0000002B']);
});

test('remembers the last import and who made it', async () => {
  expect(await memberList.status()).toEqual({ lastImport: null, activeMemberCount: 0 });

  await memberList.import([archer('0000001A'), archer('0000002B')], null);
  await memberList.import([archer('0000001A')], '0000001A');

  expect(await memberList.status()).toEqual({
    lastImport: {
      importedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      importedByName: 'ARCHER 0000001A',
      memberCount: 1,
      added: 0,
      updated: 0,
      deactivated: 1,
      unchanged: 1,
    },
    activeMemberCount: 1,
  });
});
