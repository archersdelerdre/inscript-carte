import type { Knex } from 'knex';

import * as initialSchema from './0001-initial-schema.ts';
import * as carpool from './0002-carpool.ts';
import * as archerContact from './0003-archer-contact.ts';
import * as foamTargets from './0004-foam-targets.ts';

/** Listed explicitly so migrations survive `bun build`. Append new ones at the end; never rename. */
const migrations: Record<string, Knex.Migration> = {
  '0001-initial-schema': initialSchema,
  '0002-carpool': carpool,
  '0003-archer-contact': archerContact,
  '0004-foam-targets': foamTargets,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
