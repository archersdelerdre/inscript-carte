import type { CompetitionProblem } from '@inscript-carte/shared';

import type { CompetitionOverrideRepository } from '../domain/competition-override-repository.ts';
import type { CompetitionRepository } from '../domain/competition-repository.ts';
import { isFinished, type Competition } from '../domain/competition.ts';
import type { RegistrationRepository } from '../domain/registration-repository.ts';
import type { Clock } from './ports/clock.ts';
import type { MandateReadings, MandateReadingState } from './ports/mandate-readings.ts';
import { MAX_MANDATE_ATTEMPTS } from './read-mandates.ts';

export type CompetitionOverview = {
  competition: Competition;
  clubArcherCount: number;
  problems: CompetitionProblem[];
  isEdited: boolean;
};

/** The admins' table of every upcoming competition, the ones the public does not see included. */
export class AdminCompetitionOverview {
  readonly #competitions: CompetitionRepository;
  readonly #registrations: RegistrationRepository;
  readonly #readings: MandateReadings;
  readonly #overrides: CompetitionOverrideRepository;
  readonly #clock: Clock;

  constructor(
    competitions: CompetitionRepository,
    registrations: RegistrationRepository,
    readings: MandateReadings,
    overrides: CompetitionOverrideRepository,
    clock: Clock,
  ) {
    this.#competitions = competitions;
    this.#registrations = registrations;
    this.#readings = readings;
    this.#overrides = overrides;
    this.#clock = clock;
  }

  async list(): Promise<CompetitionOverview[]> {
    const today = this.#clock.today();
    const [all, counts, readings, edited] = await Promise.all([
      this.#competitions.findAll(),
      this.#registrations.countActiveArchersByCompetition(),
      this.#readings.all(),
      this.#overrides.editedIds(),
    ]);
    return all
      .filter((competition) => !isFinished(competition, today))
      .toSorted((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
      .map((competition) => ({
        competition,
        clubArcherCount: counts.get(competition.id) ?? 0,
        problems: problemsOf(competition, readings.get(competition.id)),
        isEdited: edited.has(competition.id),
      }));
  }
}

/** A reading only counts for the link the competition has now: an older one says nothing about the new file. */
export function problemsOf(competition: Competition, reading: MandateReadingState | undefined): CompetitionProblem[] {
  const problems: CompetitionProblem[] = [];
  if (!competition.position) problems.push({ kind: 'no_place' });
  if (competition.missingSince) problems.push({ kind: 'missing', since: competition.missingSince });
  if (!competition.mandateUrl) return problems;

  if (reading?.mandateUrl !== competition.mandateUrl) {
    problems.push({ kind: 'mandate_unread' });
  } else if (reading.status === 'parsed') {
    if (!competition.departures) problems.push({ kind: 'mandate_without_departures' });
    if (!competition.prices) problems.push({ kind: 'mandate_without_prices' });
  } else {
    problems.push({
      kind: reading.status === 'failed' ? 'mandate_failed' : 'mandate_refused',
      willRetry: reading.attempts < MAX_MANDATE_ATTEMPTS,
      details: reading.problems,
    });
  }
  return problems;
}
