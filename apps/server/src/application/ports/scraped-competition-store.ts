import type { GeoPosition } from '@inscript-carte/shared';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type { CompetitionDetail, ListedCompetition } from './ffta-calendar.ts';

/** What a run needs to know about a competition already stored. */
export type StoredListing = {
  fftaId: string;
  /** `null` for rows the scraper never wrote (the legacy import). */
  fingerprint: string | null;
  startDate: CalendarDate;
  missingSince: CalendarDate | null;
};

/** A competition read on both pages, ready to store. The list's values win: they are what the fingerprint covers. */
export type ScrapedCompetition = {
  listed: ListedCompetition;
  fingerprint: string;
  detail: CompetitionDetail;
  departmentCode: string;
  position: GeoPosition | null;
};

/** Every write is short and in small batches, so the app can write while a run stores its results. */
export interface ScrapedCompetitionStore {
  listings(): Promise<StoredListing[]>;
  /** Adds or replaces them, listed now: clears `missing_since`. Never touches `has_foam_targets`. */
  save(competitions: readonly ScrapedCompetition[], listedAt: Date): Promise<void>;
  /**
   * One competition from its detail page alone (an admin's re-scrape): no fingerprint, so the next full run reads it
   * again with its list card. Keeps a stored Para-tir flag (only the list knows it) and `has_foam_targets`.
   */
  saveDetail(
    detail: CompetitionDetail,
    departmentCode: string,
    position: GeoPosition | null,
    readAt: Date,
  ): Promise<void>;
  markListed(fftaIds: readonly string[], listedAt: Date): Promise<void>;
  markMissing(fftaIds: readonly string[], since: CalendarDate): Promise<void>;
}

/** Finds a place's position when the FFTA gives none (the address service). */
export interface PlaceLocator {
  locate(place: string, departmentCode: string): Promise<GeoPosition | null>;
}
