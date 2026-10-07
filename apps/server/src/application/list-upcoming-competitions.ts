import type { CompetitionRepository } from '../domain/competition-repository.ts';
import { isFinished, type Competition } from '../domain/competition.ts';
import type { RegistrationRepository } from '../domain/registration-repository.ts';
import type { Clock } from './ports/clock.ts';

export type UpcomingCompetition = {
  competition: Competition;
  clubRegistrationCount: number;
};

export class ListUpcomingCompetitions {
  readonly #competitions: CompetitionRepository;
  readonly #registrations: RegistrationRepository;
  readonly #clock: Clock;

  constructor(competitions: CompetitionRepository, registrations: RegistrationRepository, clock: Clock) {
    this.#competitions = competitions;
    this.#registrations = registrations;
    this.#clock = clock;
  }

  async execute(): Promise<UpcomingCompetition[]> {
    const today = this.#clock.today();
    const [all, counts] = await Promise.all([
      this.#competitions.findAll(),
      this.#registrations.countActiveByCompetition(),
    ]);
    return all
      .filter((competition) => competition.status !== 'cancelled' && !isFinished(competition, today))
      .toSorted((a, b) => a.startDate.localeCompare(b.startDate))
      .map((competition) => ({ competition, clubRegistrationCount: counts.get(competition.id) ?? 0 }));
  }
}
