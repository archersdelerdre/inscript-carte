import type { CompetitionDto, MyRegistrationDto, SignedInArcher } from '@inscript-carte/shared';

import type { MyRegistration } from '../../application/club-registrations.ts';
import type { UpcomingCompetition } from '../../application/list-upcoming-competitions.ts';
import { birthYear, type Archer } from '../../domain/archer.ts';
import { clubRegistrationDeadline } from '../../domain/competition.ts';

export function toCompetitionDto({ competition, clubRegistrationCount }: UpcomingCompetition): CompetitionDto {
  return {
    id: competition.id,
    title: competition.title,
    discipline: competition.discipline,
    isPostponed: competition.status === 'postponed',
    hasParaTir: competition.hasParaTir,
    startDate: competition.startDate,
    endDate: competition.endDate,
    clubRegistrationDeadline: clubRegistrationDeadline(competition),
    organizerClub: competition.organizerClub,
    town: competition.town,
    departmentCode: competition.departmentCode,
    position: competition.position,
    mandateUrl: competition.mandateUrl,
    clubRegistrationCount,
  };
}

export function toSignedInArcher(archer: Archer): SignedInArcher {
  return {
    licenceNumber: archer.licenceNumber,
    fullName: archer.fullName,
    sex: archer.sex,
    birthYear: birthYear(archer),
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
