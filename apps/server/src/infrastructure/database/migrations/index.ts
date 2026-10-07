import type { Knex } from 'knex';

import * as initialSchema from './0001-initial-schema.ts';

/** Listed explicitly so migrations survive `bun build`. Append new ones at the end; never rename. */
const migrations: Record<string, Knex.Migration> = {
  '0001-initial-schema': initialSchema,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
