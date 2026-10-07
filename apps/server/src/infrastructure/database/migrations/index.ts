import type { Knex } from 'knex';

import * as initialSchema from './0001-initial-schema.ts';
import * as sessions from './0002-sessions.ts';
import * as paymentMethod from './0003-payment-method.ts';
import * as adminPanel from './0004-admin-panel.ts';

/** Listed explicitly so migrations survive `bun build`. Append new ones at the end; never rename. */
const migrations: Record<string, Knex.Migration> = {
  '0001-initial-schema': initialSchema,
  '0002-sessions': sessions,
  '0003-payment-method': paymentMethod,
  '0004-admin-panel': adminPanel,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
