import type { Knex } from 'knex';

import * as initialSchema from './0001-initial-schema.ts';
import * as carpool from './0002-carpool.ts';
import * as archerContact from './0003-archer-contact.ts';
import * as foamTargets from './0004-foam-targets.ts';
import * as fftaDetails from './0005-ffta-details.ts';
import * as scraperRuns from './0006-scraper-runs.ts';
import * as competitionMandates from './0007-competition-mandates.ts';
import * as refundPaymentStates from './0008-refund-payment-states.ts';
import * as mandateAddedOn from './0009-mandate-added-on.ts';
import * as competitionOverrides from './0010-competition-overrides.ts';
import * as rhythmOverride from './0011-rhythm-override.ts';
import * as pricesByCategory from './0012-prices-by-category.ts';
import * as rhythmList from './0013-rhythm-list.ts';
import * as clubPaysRegistrations from './0014-club-pays-registrations.ts';
import * as dateDepartures from './0015-date-departures.ts';
import * as rhythmOverridesList from './0016-rhythm-overrides-list.ts';
import * as memberPassword from './0017-member-password.ts';
import * as inscriptarcUrl from './0018-inscriptarc-url.ts';
import * as memberCredit from './0019-member-credit.ts';

/** Listed explicitly so migrations survive `bun build`. Append new ones at the end; never rename. */
const migrations: Record<string, Knex.Migration> = {
  '0001-initial-schema': initialSchema,
  '0002-carpool': carpool,
  '0003-archer-contact': archerContact,
  '0004-foam-targets': foamTargets,
  '0005-ffta-details': fftaDetails,
  '0006-scraper-runs': scraperRuns,
  '0007-competition-mandates': competitionMandates,
  '0008-refund-payment-states': refundPaymentStates,
  '0009-mandate-added-on': mandateAddedOn,
  '0010-competition-overrides': competitionOverrides,
  '0011-rhythm-override': rhythmOverride,
  '0012-prices-by-category': pricesByCategory,
  '0013-rhythm-list': rhythmList,
  '0014-club-pays-registrations': clubPaysRegistrations,
  '0015-date-departures': dateDepartures,
  '0016-rhythm-overrides-list': rhythmOverridesList,
  '0017-member-password': memberPassword,
  '0018-inscriptarc-url': inscriptarcUrl,
  '0019-member-credit': memberCredit,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations),
  getMigrationName: (name) => name,
  getMigration: async (name) => migrations[name]!,
};
