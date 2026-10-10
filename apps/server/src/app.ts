import type { Knex } from 'knex';

import { AdminAccounts } from './application/admin-accounts.ts';
import { AdminAuthentication } from './application/admin-authentication.ts';
import { AdminCompetitionOverview } from './application/admin-competition-overview.ts';
import { AdminRegistrations } from './application/admin-registrations.ts';
import { Authentication } from './application/authentication.ts';
import { ClubMembers } from './application/club-members.ts';
import { ClubRegistrations } from './application/club-registrations.ts';
import { CompetitionEdits } from './application/competition-edits.ts';
import { ListUpcomingCompetitions } from './application/list-upcoming-competitions.ts';
import type { Clock } from './application/ports/clock.ts';
import type { ScraperRuns } from './application/scraper-runs.ts';
import { BunPasswordHasher } from './infrastructure/bun-password-hasher.ts';
import { SqliteAdminRepository } from './infrastructure/database/sqlite-admin-repository.ts';
import { SqliteArcherRepository } from './infrastructure/database/sqlite-archer-repository.ts';
import { SqliteCompetitionOverrideRepository } from './infrastructure/database/sqlite-competition-override-repository.ts';
import { SqliteCompetitionRepository } from './infrastructure/database/sqlite-competition-repository.ts';
import { SqliteMandateReadings } from './infrastructure/database/sqlite-mandate-readings.ts';
import { SqliteMemberListRepository } from './infrastructure/database/sqlite-member-list-repository.ts';
import { SqliteRegistrationRepository } from './infrastructure/database/sqlite-registration-repository.ts';
import { SqliteSessionStore } from './infrastructure/database/sqlite-session-store.ts';
import { organizerSpreadsheet } from './infrastructure/exports/organizer-spreadsheet.ts';
import { InMemoryLoginAttemptLimiter } from './infrastructure/in-memory-login-attempt-limiter.ts';
import { readMemberExport } from './infrastructure/members/ffta-member-export.ts';
import { createRoutes } from './presentation/http/routes.ts';

/**
 * Never reached by a person, even after many typos, but a script trying the ~25,000 possible birth dates of one
 * member needs about 9 days: it protects the members' (including minors') birth dates.
 */
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_SIGN_INS = { licence: 30, address: 200 };
/** Admins are few and type a password they chose: a lower limit is still enough for typos. */
const MAX_FAILED_ADMIN_SIGN_INS = { licence: 10, address: 50 };

/**
 * Wires the application; the composition root for `main.ts` and the HTTP tests. `scraperRuns` comes from outside:
 * `main.ts` gives it the real process launcher, the tests a fake one.
 */
export function createApp(database: Knex, clock: Clock, scraperRuns: ScraperRuns) {
  const archers = new SqliteArcherRepository(database);
  const competitions = new SqliteCompetitionRepository(database);
  const registrations = new SqliteRegistrationRepository(database);
  const admins = new SqliteAdminRepository(database);
  const overrides = new SqliteCompetitionOverrideRepository(database);
  const passwordHasher = new BunPasswordHasher();
  return createRoutes({
    listUpcomingCompetitions: new ListUpcomingCompetitions(competitions, registrations, clock),
    authentication: new Authentication(
      archers,
      new SqliteSessionStore(database, 'sessions'),
      new InMemoryLoginAttemptLimiter(SIGN_IN_WINDOW_MS, MAX_FAILED_SIGN_INS),
      clock,
    ),
    clubRegistrations: new ClubRegistrations(competitions, registrations, clock),
    adminAuthentication: new AdminAuthentication(
      archers,
      admins,
      new SqliteSessionStore(database, 'admin_sessions'),
      passwordHasher,
      new InMemoryLoginAttemptLimiter(SIGN_IN_WINDOW_MS, MAX_FAILED_ADMIN_SIGN_INS),
      clock,
    ),
    adminAccounts: new AdminAccounts(archers, admins, passwordHasher),
    adminRegistrations: new AdminRegistrations(competitions, registrations, archers, clock),
    adminCompetitionOverview: new AdminCompetitionOverview(
      competitions,
      registrations,
      new SqliteMandateReadings(database),
      overrides,
      clock,
    ),
    competitionEdits: new CompetitionEdits(overrides, clock),
    clubMembers: new ClubMembers(new SqliteMemberListRepository(database), admins, clock),
    scraperRuns,
    readMemberExport,
    organizerSpreadsheet,
  });
}
