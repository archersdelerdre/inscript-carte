import type {
  AdminCompetitionDto,
  AdminMemberDto,
  AdminRegistrationDto,
  CompetitionDto,
  MyRegistrationDto,
  SignedInArcher,
} from '@inscript-carte/shared';

import type { AdminCompetition } from '../../application/admin-registrations.ts';
import type { ClubMember } from '../../application/club-members.ts';
import type { MyRegistration } from '../../application/club-registrations.ts';
import type { UpcomingCompetition } from '../../application/list-upcoming-competitions.ts';
import { birthYear, type Archer } from '../../domain/archer.ts';
import { clubRegistrationDeadline } from '../../domain/competition.ts';
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
    departure: registration.departure,
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
    isPostponed: competition.status === 'postponed',
    isCancelled: competition.status === 'cancelled',
    isFinished,
    statusCounts,
    toPayCount,
  };
}

export function toAdminRegistrationDto({
  registration,
  fullName,
  sex,
  updatedByName,
}: RegistrationDetails): AdminRegistrationDto {
  return {
    id: registration.id,
    licenceNumber: registration.archerLicenceNumber,
    fullName,
    sex,
    category: registration.category,
    departure: registration.departure,
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
