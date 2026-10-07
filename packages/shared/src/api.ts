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
    | 'cannot_withdraw';
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
