import type { Discipline } from '@inscript-carte/shared';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type { CompetitionStatus } from '../../domain/competition.ts';

/** One competition as the FFTA calendar list shows it. */
export type ListedCompetition = {
  fftaId: string;
  /** The FFTA title without its " à TOWN" end. */
  title: string;
  /** What follows the last " à " of the FFTA title. */
  town: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  status: CompetitionStatus;
  discipline: Discipline;
  hasParaTir: boolean;
  organizerClub: string | null;
  organizerEmail: string | null;
  mandateUrl: string | null;
};

/** Everything the detail page of one competition shows. */
export type CompetitionDetail = {
  fftaId: string;
  title: string;
  town: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  status: CompetitionStatus;
  discipline: Discipline;
  hasParaTir: boolean;
  /** "Individuel Tir à 18m 2027": the championship the competition counts for. */
  championship: string | null;
  hasDuels: boolean | null;
  regionalCommittee: string | null;
  departmentalCommittee: string | null;
  organizerClub: string | null;
  /** "GYMNASE ECHANNEAUX": the bold line(s) under "Lieu". */
  venue: string | null;
  streetLines: string[];
  postalCode: string | null;
  city: string | null;
  country: string | null;
  /** The venue's postal code first (where the archers go), else its committees; `null` abroad. */
  departmentCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  mandateUrl: string | null;
};

/** `problems` is FFTA text that could not be read (never personal data): one bad card never stops a run. */
export type CalendarRead = {
  competitions: ListedCompetition[];
  pages: number;
  /** `false` when the reading stopped before the list's end: then nothing may be called missing. */
  complete: boolean;
  problems: string[];
};
export type CompetitionPage = { detail: CompetitionDetail | null; problems: string[] };

/** The FFTA website. Throws when it cannot be read at all (Cloudflare): nothing may be trusted then. */
export interface FftaCalendar {
  /** Every competition from `today` for a year, Para-tir merged as a flag. */
  readList(today: CalendarDate, onPage: (page: number, found: number) => void): Promise<CalendarRead>;
  readCompetition(fftaId: string): Promise<CompetitionPage>;
}
