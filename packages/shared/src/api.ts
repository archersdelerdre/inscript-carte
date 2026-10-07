import type { Discipline } from './discipline.ts';
import type { AgeCategory } from './ffta-category.ts';
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
  adminCompetitions: '/api/admin/competitions',
  adminCompetitionRegistrations: '/api/admin/competitions/:competitionId/registrations',
  adminCompetitionExport: '/api/admin/competitions/:competitionId/export',
  adminRegistration: '/api/admin/registrations/:registrationId',
  adminPaymentReference: '/api/admin/payment-references/:paymentReference',
  adminMemberImport: '/api/admin/members/import',
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
    | 'invalid_member_export';
};

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
  startDate: string;
  endDate: string;
  clubRegistrationDeadline: string;
  organizerClub: string | null;
  town: string;
  departmentCode: string;
  /** `null` when the town could not be located. */
  position: GeoPosition | null;
  mandateUrl: string | null;
  /** Club members registered (not cancelled). Public: only names are protected. */
  clubRegistrationCount: number;
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
  /** Required for "Extérieur" competitions, `null` otherwise. */
  distance: Distance | null;
  contact: string | null;
  paymentMethod: PaymentMethod;
};

export type RegistrationCreatedResponse = {
  departures: number[];
  category: AgeCategory;
  /** One reference for the whole request, to give when paying the club. */
  paymentReference: string;
  /** The club deadline: pay before it. */
  paymentDeadline: string;
};

export type CompetitionRegistrantDto = {
  fullName: string;
  bowType: BowType;
  departures: number[];
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
  bowType: BowType;
  category: AgeCategory;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  /** `null` for registrations made before the payment method was asked. */
  paymentMethod: PaymentMethod | null;
  paymentReference: string;
  clubRegistrationDeadline: string;
  clubNote: string | null;
  canWithdraw: boolean;
};

export type ListMyRegistrationsResponse = {
  registrations: MyRegistrationDto[];
};

export type AdminSignInRequest = {
  /** The admin is already signed in as a member; the password is their second step. */
  password: string;
};

export type AdminSessionResponse = {
  admin: { licenceNumber: string; fullName: string };
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
  bowType: BowType;
  trispot: boolean;
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

export type MemberImportDto = {
  /** ISO date and time (UTC). */
  importedAt: string;
  /** `null` when imported from the command line. */
  importedByName: string | null;
  memberCount: number;
  added: number;
  updated: number;
  deactivated: number;
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
