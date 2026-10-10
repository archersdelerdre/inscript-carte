import type { CompetitionFields, FftaDetailsDto } from '@inscript-carte/shared';

import type { CalendarDate } from './calendar-date.ts';
import type { CompetitionOverrides } from './competition-overrides.ts';

/** Read on the FFTA detail page; never edited. */
export type FftaDetails = FftaDetailsDto;

export type EditableCompetition = {
  /** The FFTA values; départs and prices from the checked reading of the FFTA mandate link. */
  ffta: CompetitionFields;
  overrides: CompetitionOverrides;
  /** The day an admin gave a mandate link the FFTA did not have. */
  overrideMandateAddedOn: CalendarDate | null;
  details: FftaDetails;
  updatedByName: string | null;
  updatedAt: string | null;
};

export interface CompetitionOverrideRepository {
  editable(competitionId: string): Promise<EditableCompetition | null>;
  /** Replaces every edit of the competition; no edit at all removes its row. */
  save(
    competitionId: string,
    overrides: CompetitionOverrides,
    mandateAddedOn: CalendarDate | null,
    updatedBy: string,
  ): Promise<void>;
  editedIds(): Promise<Set<string>>;
}
