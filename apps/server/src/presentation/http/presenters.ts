import type {
  AdminCompetitionDto,
  AdminMemberDto,
  AdminRegistrationDto,
  CompetitionDto,
  CompetitionOverviewDto,
  MyRegistrationDto,
  ScraperRunDto,
  SignedInArcher,
} from '@inscript-carte/shared';

import type { CompetitionOverview } from '../../application/admin-competition-overview.ts';
import type { AdminCompetition } from '../../application/admin-registrations.ts';
import type { ClubMember } from '../../application/club-members.ts';
import type { MyRegistration } from '../../application/club-registrations.ts';
import type { UpcomingCompetition } from '../../application/list-upcoming-competitions.ts';
import type { ScraperRun } from '../../application/ports/scraper-run-store.ts';
import { birthYear, type Archer } from '../../domain/archer.ts';
import { clubRegistrationDeadline, departureLabel, type Competition } from '../../domain/competition.ts';
import type { RegistrationDetails } from '../../domain/registration-repository.ts';

export function toCompetitionDto({ competition, clubArcherCount }: UpcomingCompetition): CompetitionDto {
  return {
    id: competition.id,
    title: competition.title,
    discipline: competition.discipline,
    isPostponed: competition.status === 'postponed',
    hasParaTir: competition.hasParaTir,
    hasFoamTargets: competition.hasFoamTargets,
    startDate: competition.startDate,
    endDate: competition.endDate,
    clubRegistrationDeadline: clubRegistrationDeadline(competition),
    organizerClub: competition.organizerClub,
    town: competition.town,
    departmentCode: competition.departmentCode,
    position: competition.position,
    mandateUrl: competition.mandateUrl,
    departures: competition.departures ? [...competition.departures] : null,
    clubArcherCount,
  };
}

export function toSignedInArcher(archer: Archer, isAdmin: boolean): SignedInArcher {
  return {
    licenceNumber: archer.licenceNumber,
    fullName: archer.fullName,
    sex: archer.sex,
    birthYear: birthYear(archer),
    isAdmin,
  };
}

export function toMyRegistrationDto({ registration, competition, canWithdraw }: MyRegistration): MyRegistrationDto {
  return {
    id: registration.id,
    competitionId: competition.id,
    competitionTitle: competition.title,
    startDate: competition.startDate,
    endDate: competition.endDate,
    town: competition.town,
    departure: registration.departure,
    mandateDeparture: competition.departures?.[registration.departure - 1] ?? null,
    bowType: registration.bowType,
    carpool: registration.carpool,
    trispot: registration.trispot,
    category: registration.category,
    status: registration.status,
    paymentStatus: registration.paymentStatus,
    paymentMethod: registration.paymentMethod,
    paymentReference: registration.paymentReference,
    clubRegistrationDeadline: clubRegistrationDeadline(competition),
    clubNote: registration.clubNote,
    canWithdraw,
  };
}

export function toAdminCompetitionDto({
  competition,
  isFinished,
  statusCounts,
  toPayCount,
  toRefundCount,
}: AdminCompetition): AdminCompetitionDto {
  return {
    id: competition.id,
    title: competition.title,
    discipline: competition.discipline,
    startDate: competition.startDate,
    endDate: competition.endDate,
    clubRegistrationDeadline: clubRegistrationDeadline(competition),
    town: competition.town,
    departmentCode: competition.departmentCode,
    mandateUrl: competition.mandateUrl,
    departures: competition.departures ? [...competition.departures] : null,
    prices: competition.prices ? [...competition.prices] : null,
    isPostponed: competition.status === 'postponed',
    isCancelled: competition.status === 'cancelled',
    isFinished,
    statusCounts,
    toPayCount,
    toRefundCount,
  };
}

export function toCompetitionOverviewDto({
  competition,
  clubArcherCount,
  problems,
}: CompetitionOverview): CompetitionOverviewDto {
  return {
    id: competition.id,
    title: competition.title,
    discipline: competition.discipline,
    hasParaTir: competition.hasParaTir,
    startDate: competition.startDate,
    endDate: competition.endDate,
    town: competition.town,
    departmentCode: competition.departmentCode,
    isPostponed: competition.status === 'postponed',
    isCancelled: competition.status === 'cancelled',
    mandateUrl: competition.mandateUrl,
    clubArcherCount,
    problems,
  };
}

export function toAdminRegistrationDto(
  { registration, fullName, sex, updatedByName }: RegistrationDetails,
  competition: Competition,
): AdminRegistrationDto {
  return {
    id: registration.id,
    licenceNumber: registration.archerLicenceNumber,
    fullName,
    sex,
    category: registration.category,
    departure: registration.departure,
    departureLabel: departureLabel(competition, registration.departure),
    bowType: registration.bowType,
    trispot: registration.trispot,
    carpool: registration.carpool,
    distance: registration.distance,
    paymentMethod: registration.paymentMethod,
    paymentReference: registration.paymentReference,
    paymentStatus: registration.paymentStatus,
    status: registration.status,
    contact: registration.contact,
    clubNote: registration.clubNote,
    createdAt: registration.createdAt,
    updatedByName,
  };
}

/** The birth date stays on the server. */
export function toAdminMemberDto({ archer, category, isAdmin }: ClubMember): AdminMemberDto {
  return {
    licenceNumber: archer.licenceNumber,
    fullName: archer.fullName,
    sex: archer.sex,
    category,
    isActive: archer.isActive,
    isAdmin,
  };
}

/** Without the starter's licence number: the name is enough to know who asked. */
export function toScraperRunDto(run: ScraperRun): ScraperRunDto {
  return {
    id: run.id,
    kind: run.kind,
    fftaId: run.fftaId,
    dryRun: run.dryRun,
    startedByName: run.startedByName,
    status: run.status,
    progress: run.progress,
    report: run.report,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
