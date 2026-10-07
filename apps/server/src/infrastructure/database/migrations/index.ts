import type { Knex } from 'knex';

import * as initialSchema from './0001-initial-schema.ts';
import * as sessions from './0002-sessions.ts';
import * as paymentMethod from './0003-payment-method.ts';
import * as adminPanel from './0004-admin-panel.ts';
import * as adminPasswordChange from './0005-admin-password-change.ts';
import * as keepMissingMembers from './0006-keep-missing-members.ts';

/** Listed explicitly so migrations survive `bun build`. Append new ones at the end; never rename. */
const migrations: Record<string, Knex.Migration> = {
  '0001-initial-schema': initialSchema,
  '0002-sessions': sessions,
  '0003-payment-method': paymentMethod,
  '0004-admin-panel': adminPanel,
  '0005-admin-password-change': adminPasswordChange,
  '0006-keep-missing-members': keepMissingMembers,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
