import type { Archer } from '../domain/archer.ts';
import type { CompetitionOverrideRepository, EditableCompetition } from '../domain/competition-override-repository.ts';
import { checkOverrides } from '../domain/competition-overrides.ts';
import type { Clock } from './ports/clock.ts';

export type SaveEditsResult = { ok: true } | { ok: false; reason: 'not_found' | 'invalid_request' };

/** Admins correct a competition by hand; their values win over the FFTA's until they put them back. */
export class CompetitionEdits {
  readonly #overrides: CompetitionOverrideRepository;
  readonly #clock: Clock;

  constructor(overrides: CompetitionOverrideRepository, clock: Clock) {
    this.#overrides = overrides;
    this.#clock = clock;
  }

  editable(competitionId: string): Promise<EditableCompetition | null> {
    return this.#overrides.editable(competitionId);
  }

  /** Replaces every edit: a field left out goes back to the FFTA value. */
  async save(admin: Archer, competitionId: string, raw: unknown): Promise<SaveEditsResult> {
    const current = await this.#overrides.editable(competitionId);
    if (!current) return { ok: false, reason: 'not_found' };
    const overrides = checkOverrides(raw, current.ffta);
    if (!overrides) return { ok: false, reason: 'invalid_request' };
    // A link the FFTA did not have opens the "late mandate" window from the day it was first given.
    const mandateAddedOn =
      overrides.mandateUrl && !current.ffta.mandateUrl ? (current.overrideMandateAddedOn ?? this.#clock.today()) : null;
    await this.#overrides.save(competitionId, overrides, mandateAddedOn, admin.licenceNumber);
    return { ok: true };
  }
}
