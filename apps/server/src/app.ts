import type { Knex } from 'knex';

import { Authentication } from './application/authentication.ts';
import { ClubRegistrations } from './application/club-registrations.ts';
import { ListUpcomingCompetitions } from './application/list-upcoming-competitions.ts';
import type { Clock } from './application/ports/clock.ts';
import { SqliteArcherRepository } from './infrastructure/database/sqlite-archer-repository.ts';
import { SqliteCompetitionRepository } from './infrastructure/database/sqlite-competition-repository.ts';
import { SqliteRegistrationRepository } from './infrastructure/database/sqlite-registration-repository.ts';
import { SqliteSessionStore } from './infrastructure/database/sqlite-session-store.ts';
import { InMemoryLoginAttemptLimiter } from './infrastructure/in-memory-login-attempt-limiter.ts';
import { createRoutes } from './presentation/http/routes.ts';

/**
 * Never reached by a person, even after many typos, but a script trying the ~25,000 possible birth dates of one
 * member needs about 9 days: it protects the members' (including minors') birth dates.
 */
const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_SIGN_INS = { licence: 30, address: 200 };

/** Wires the application; the composition root for `main.ts` and the HTTP tests. */
export function createApp(database: Knex, clock: Clock) {
  const competitions = new SqliteCompetitionRepository(database);
  const registrations = new SqliteRegistrationRepository(database);
  return createRoutes({
    listUpcomingCompetitions: new ListUpcomingCompetitions(competitions, registrations, clock),
    authentication: new Authentication(
      new SqliteArcherRepository(database),
      new SqliteSessionStore(database),
      new InMemoryLoginAttemptLimiter(SIGN_IN_WINDOW_MS, MAX_FAILED_SIGN_INS),
      clock,
    ),
    clubRegistrations: new ClubRegistrations(competitions, registrations, clock),
  });
}
