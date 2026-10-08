import type { Discipline } from './discipline.ts';
import type { AgeCategory } from './ffta-category.ts';
import type { MandateDeparture, MandatePrice } from './mandate.ts';
import type { BowType, Distance, PaymentMethod, PaymentStatus, RegistrationStatus, Sex } from './registration.ts';

/** Bun route patterns; the client fills the `:params` with `apiPath`. */
export const API_ROUTES = {
  health: '/api/health',
  competitions: '/api/competitions',
  session: '/api/session',
  competitionRegistrations: '/api/competitions/:competitionId/registrations',
  myRegistrations: '/api/me/registrations',
  myRegistration: '/api/me/registrations/:registrationId',
  adminSession: '/api/admin/session',
  adminPassword: '/api/admin/session/password',
  adminCompetitions: '/api/admin/competitions',
  adminCompetitionRegistrations: '/api/admin/competitions/:competitionId/registrations',
  adminCompetitionExport: '/api/admin/competitions/:competitionId/export',
  adminRegistration: '/api/admin/registrations/:registrationId',
  adminPaymentReference: '/api/admin/payment-references/:paymentReference',
  adminMemberImport: '/api/admin/members/import',
  adminMembers: '/api/admin/members',
  adminMember: '/api/admin/members/:licenceNumber',
  adminMemberAdminRights: '/api/admin/members/:licenceNumber/admin',
  adminScraper: '/api/admin/scraper',
  adminScraperRuns: '/api/admin/scraper/runs',
  /** Server-sent events: the `ScraperStatusResponse` at once, then each time it changes. */
  adminScraperEvents: '/api/admin/scraper/events',
} as const;

export function apiPath(route: string, params: Record<string, string | number>): string {
  return route.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(String(params[name])));
}

/** Error bodies always have this shape; the client turns the code into a French message. */
export type ApiError = {
  error:
    | 'not_found'
    | 'invalid_request'
    | 'not_signed_in'
    | 'invalid_credentials'
    | 'too_many_attempts'
    | 'registration_closed'
    | 'already_registered'
    | 'cannot_withdraw'
    /** No valid admin session: the admin must type their password again. */
    | 'admin_sign_in_required'
    /** A signed-in member who is not in the admin list. */
    | 'not_admin'
    | 'status_change_not_allowed'
    | 'invalid_member_export'
    /** An admin with a generated password must choose their own before anything else. */
    | 'password_change_required'
    | 'password_too_short'
    /** An admin cannot deactivate themselves or remove their own admin rights. */
    | 'cannot_change_self'
    | 'member_inactive'
    | 'already_admin'
    /** An FFTA scraper run is already going (`ScraperBusyResponse` also gives it). */
    | 'scraper_busy'
    /** The server has no browser to read the FFTA site with (`CHROME_PATH` not set). */
    | 'scraper_unavailable';
};

/** Admin passwords have at least this many characters. */
export const MIN_ADMIN_PASSWORD_LENGTH = 10;

export type HealthResponse = {
  status: 'ok';
};

export type GeoPosition = {
  latitude: number;
  longitude: number;
};

/** Dates are calendar dates in ISO format: `YYYY-MM-DD`. */
export type CompetitionDto = {
  id: string;
  title: string;
  discipline: Discipline;
  isPostponed: boolean;
  hasParaTir: boolean;
  /** Shot on foam targets ("cibles mousses"). Not known yet for any competition: the scraper will fill it. */
  hasFoamTargets: boolean;
  startDate: string;
  endDate: string;
  clubRegistrationDeadline: string;
  organizerClub: string | null;
  town: string;
  departmentCode: string;
  /** Always set: competitions whose place is unknown are not in the public list. */
  position: GeoPosition;
  mandateUrl: string | null;
  /**
   * The départs read in the mandate, in order: départ N is the Nth. `null` when the mandate was not read (or lists
   * none): the form then offers 1 to `DEFAULT_DEPARTURE_COUNT`.
   */
  departures: MandateDeparture[] | null;
  /** Club archers registered (on at least one départ not cancelled), each counted once. Public: names are protected. */
  clubArcherCount: number;
};

export type ListCompetitionsResponse = {
  competitions: CompetitionDto[];
};

export type SignInRequest = {
  licenceNumber: string;
  /** `YYYY-MM-DD` */
  birthDate: string;
};

/** The full birth date is never sent back: the birth year is enough to compute the FFTA category. */
export type SignedInArcher = {
  licenceNumber: string;
  fullName: string;
  sex: Sex;
  birthYear: number;
  /** Shows the "Administration" button; the admin page still asks for the admin password. */
  isAdmin: boolean;
};

export type SessionResponse = {
  archer: SignedInArcher;
};

/** Usually the same bow on every départ, but an archer may shoot each départ with a different one. */
export type DepartureChoice = {
  departure: number;
  bowType: BowType;
};

export type RegistrationRequest = {
  departures: DepartureChoice[];
  trispot: boolean;
  /** Would like to share a car from the club. */
  carpool: boolean;
  /** Required for "Extérieur" competitions, `null` otherwise. */
  distance: Distance | null;
  contact: string | null;
  paymentMethod: PaymentMethod;
};

export type RegistrationCreatedResponse = {
  departures: number[];
  category: AgeCategory;
  /** One reference per archer and competition (a later request reuses it), to give when paying the club. */
  paymentReference: string;
  /** The club deadline: pay before it. */
  paymentDeadline: string;
};

export type CompetitionRegistrantDto = {
  fullName: string;
  bowType: BowType;
  departures: number[];
  /** Interested in carpooling from the club, so the members can organize together. */
  carpool: boolean;
};

export type ListCompetitionRegistrantsResponse = {
  registrants: CompetitionRegistrantDto[];
};

/** One row per départ, like the club's sheet. */
export type MyRegistrationDto = {
  id: number;
  competitionId: string;
  competitionTitle: string;
  startDate: string;
  endDate: string;
  departure: number;
  /** The mandate's name for that départ ("Après-midi"); `null` when the mandate was not read. */
  departureLabel: string | null;
  bowType: BowType;
  trispot: boolean;
  category: AgeCategory;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  /** `null` for registrations made before the payment method was asked. */
  paymentMethod: PaymentMethod | null;
  paymentReference: string;
  clubRegistrationDeadline: string;
  clubNote: string | null;
  canWithdraw: boolean;
  /** Interested in carpooling from the club. */
  carpool: boolean;
};

export type ListMyRegistrationsResponse = {
  registrations: MyRegistrationDto[];
};

export type AdminSignInRequest = {
  /** The admin is already signed in as a member; the password is their second step. */
  password: string;
};

export type AdminSessionResponse = {
  admin: {
    licenceNumber: string;
    fullName: string;
    /** Signed in with a password generated by another admin: nothing else works until it is changed. */
    mustChangePassword: boolean;
  };
};

export type ChangeAdminPasswordRequest = {
  /** Required, except at the first sign-in with a generated password (`mustChangePassword`). */
  currentPassword: string | null;
  newPassword: string;
};

/** A competition that has club registrations, as listed in the admin panel. */
export type AdminCompetitionDto = {
  id: string;
  title: string;
  discipline: Discipline;
  startDate: string;
  endDate: string;
  clubRegistrationDeadline: string;
  town: string;
  departmentCode: string;
  mandateUrl: string | null;
  /** What the mandate says, from a checked reading of its current link; `null` when not read or not given. */
  departures: MandateDeparture[] | null;
  prices: MandatePrice[] | null;
  isPostponed: boolean;
  /** Cancelled by the organizer while the club still has registrations. */
  isCancelled: boolean;
  isFinished: boolean;
  /** Rows (one per départ) in each status. */
  statusCounts: Record<RegistrationStatus, number>;
  /** Rows not cancelled and not paid yet. */
  toPayCount: number;
};

export type ListAdminCompetitionsResponse = {
  /** Upcoming first (soonest first), then finished ones (latest first). */
  competitions: AdminCompetitionDto[];
};

/** One row per départ, with everything the secretary needs. Never the birth date. */
export type AdminRegistrationDto = {
  id: number;
  licenceNumber: string;
  fullName: string;
  sex: Sex;
  category: AgeCategory;
  departure: number;
  /** The mandate's name for that départ ("Après-midi"); `null` when the mandate was not read. */
  departureLabel: string | null;
  bowType: BowType;
  trispot: boolean;
  carpool: boolean;
  distance: Distance | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string;
  paymentStatus: PaymentStatus;
  status: RegistrationStatus;
  contact: string | null;
  clubNote: string | null;
  /** ISO date and time (UTC) of the request. */
  createdAt: string;
  /** The admin who changed the row last; `null` if no admin changed it. */
  updatedByName: string | null;
};

export type AdminCompetitionRegistrationsResponse = {
  competition: AdminCompetitionDto;
  /** Sorted by payment reference, then départ. */
  registrations: AdminRegistrationDto[];
};

/** Only the fields to change are sent. `clubNote: null` (or blank) removes the note. */
export type UpdateRegistrationRequest = {
  status?: RegistrationStatus;
  paymentStatus?: PaymentStatus;
  clubNote?: string | null;
};

/** Applied to every départ of the reference that is not cancelled. */
export type UpdatePaymentReferenceRequest = {
  status?: RegistrationStatus;
  paymentStatus?: PaymentStatus;
};

/** One club member in the admin list. Never the birth date: the category is computed by the server. */
export type AdminMemberDto = {
  licenceNumber: string;
  fullName: string;
  sex: Sex;
  /** Category of the current season. */
  category: AgeCategory;
  /** `false` for members missing from the last FFTA export: they can no longer sign in. */
  isActive: boolean;
  isAdmin: boolean;
};

export type ListAdminMembersResponse = {
  /** Sorted by name. */
  members: AdminMemberDto[];
};

export type UpdateMemberRequest = {
  /** Until the next FFTA import, which sets it again from the file. */
  isActive: boolean;
};

export type GrantAdminResponse = {
  /** Shown once to the admin who granted the rights; the new admin must replace it at first sign-in. */
  password: string;
};

export type MemberImportDto = {
  /** ISO date and time (UTC). */
  importedAt: string;
  /** `null` when imported from the command line. */
  importedByName: string | null;
  memberCount: number;
  added: number;
  updated: number;
  unchanged: number;
};

export type MemberImportStatusResponse = {
  lastImport: MemberImportDto | null;
  activeMemberCount: number;
};

export type MemberImportResponse = MemberImportStatusResponse & { lastImport: MemberImportDto };

export const MEMBER_EXPORT_PROBLEMS = [
  'unreadable',
  'too_large',
  'empty',
  'missing_column',
  'no_members',
  'invalid_licence',
  'duplicate_licence',
  'missing_name',
  'unknown_sex',
  'invalid_birth_date',
] as const;
export type MemberExportProblem = (typeof MEMBER_EXPORT_PROBLEMS)[number];

/** Why an uploaded member list was refused. Nothing is imported in that case. */
export type MemberExportErrorResponse = {
  error: 'invalid_member_export';
  problem: MemberExportProblem;
  /** Line in the spreadsheet, when the problem is on one row. */
  line: number | null;
  /** The column title or the wrong value (never a name or a birth date). */
  detail: string | null;
};

/** What an FFTA scraper run is doing now. */
export type ScraperProgress =
  | { step: 'list'; page: number; found: number }
  | { step: 'details'; done: number; total: number }
  | { step: 'saving' }
  | { step: 'mandates'; done: number; total: number };

/** The mandates (organizers' PDFs) a run sent to the LLM. */
export type MandateCounts = {
  /** Read and checked: their départs, prices and foam targets are stored. */
  read: number;
  /** A new link, but the very same file as before: nothing sent to the LLM. */
  unchanged: number;
  /** The LLM answered something the checks refused: kept to look at, tried again later. */
  invalid: number;
  /** Download, page images or LLM call failed: tried again by a later run. */
  failed: number;
  /** Beyond the run's limit: read by a later run. */
  left: number;
  /** What OpenRouter billed, in US dollars. */
  costUsd: number;
};

/** The counts of a finished run. Never names, emails or phone numbers: FFTA text in `problems` only. */
export type ScraperReport = {
  dryRun: boolean;
  /** Why nothing was written; `null` when the run went through. */
  aborted: string | null;
  pages: number;
  listed: number;
  added: number;
  changed: number;
  unchanged: number;
  back: number;
  missing: number;
  detailsRead: number;
  /** Beyond the run's limit: read by a later run. */
  detailsLeft: number;
  /** Read, but not stored: abroad (no département), or a detail page that could not be read. */
  skippedAbroad: number;
  skippedUnreadable: number;
  /** Every position comes from the address service (postal code and commune); a dry run tries none. */
  positions: { geocoded: number; notFound: number; notTried: number };
  /** `null` when the run read no mandate: a dry run, or no OpenRouter key on this server. */
  mandates: MandateCounts | null;
  problems: string[];
  durationMs: number;
};

export type ScraperRunKind = 'full' | 'competition';
export type ScraperRunStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';

export type ScraperRunDto = {
  id: number;
  kind: ScraperRunKind;
  /** Only for `competition` runs. */
  fftaId: string | null;
  dryRun: boolean;
  /** `null` for the night run and the command line. */
  startedByName: string | null;
  status: ScraperRunStatus;
  progress: ScraperProgress | null;
  report: ScraperReport | null;
  error: string | null;
  /** ISO date and time (UTC). */
  startedAt: string;
  finishedAt: string | null;
};

export type ScraperStatusResponse = {
  /** `false` when the server has no browser: runs cannot start. */
  available: boolean;
  current: ScraperRunDto | null;
  /** The last finished runs, latest first. */
  recent: ScraperRunDto[];
};

export type StartScraperRunRequest = { kind: 'full' } | { kind: 'competition'; fftaId: string };
export type StartScraperRunResponse = { run: ScraperRunDto };
export type ScraperBusyResponse = { error: 'scraper_busy'; run: ScraperRunDto };
