import {
  ageCategory,
  BOW_TYPES,
  DISTANCES,
  MAX_DEPARTURE,
  PAYMENT_METHODS,
  type AgeCategory,
  type BowType,
  type DepartureChoice,
  type Distance,
} from '@inscript-carte/shared';

import { birthYear, type Archer } from '../domain/archer.ts';
import { toFrenchDate } from '../domain/calendar-date.ts';
import type { CompetitionRepository } from '../domain/competition-repository.ts';
import { clubRegistrationDeadline, type Competition } from '../domain/competition.ts';
import type { RegistrationRepository } from '../domain/registration-repository.ts';
import { canWithdraw, isClubRegistrationOpen, type Registration } from '../domain/registration.ts';
import type { Clock } from './ports/clock.ts';

const MAX_CONTACT_LENGTH = 200;

/** The registration form, as sent; every field is checked here. */
export type RegistrationForm = {
  departures: unknown;
  trispot: unknown;
  carpool: unknown;
  distance: unknown;
  contact: unknown;
  paymentMethod: unknown;
};

export type RegisterResult =
  | { ok: true; departures: number[]; category: AgeCategory; paymentReference: string; paymentDeadline: string }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'registration_closed' | 'already_registered' };

export type RegistrantGroup = { fullName: string; bowType: BowType; departures: number[]; carpool: boolean };

export type MyRegistration = { registration: Registration; competition: Competition; canWithdraw: boolean };

export type WithdrawResult = { ok: true } | { ok: false; reason: 'not_found' | 'cannot_withdraw' };

/** Registration through the club, for signed-in members. */
export class ClubRegistrations {
  readonly #competitions: CompetitionRepository;
  readonly #registrations: RegistrationRepository;
  readonly #clock: Clock;

  constructor(competitions: CompetitionRepository, registrations: RegistrationRepository, clock: Clock) {
    this.#competitions = competitions;
    this.#registrations = registrations;
    this.#clock = clock;
  }

  async register(archer: Archer, competitionId: string, form: RegistrationForm): Promise<RegisterResult> {
    const competition = await this.#competitions.findById(competitionId);
    if (!competition) return { ok: false, reason: 'not_found' };
    if (!isClubRegistrationOpen(competition, this.#clock.today())) return { ok: false, reason: 'registration_closed' };

    const departures = parseDepartures(form.departures);
    const paymentMethod = PAYMENT_METHODS.find((value) => value === form.paymentMethod);
    // Distances only exist for "Extérieur" competitions, where they are required.
    const distance = DISTANCES.find((value) => value === form.distance) ?? null;
    const distanceValid = competition.discipline === 'exterieur' ? distance !== null : form.distance === null;
    const contact = typeof form.contact === 'string' ? form.contact.trim() : null;
    if (
      !departures ||
      typeof form.trispot !== 'boolean' ||
      typeof form.carpool !== 'boolean' ||
      !paymentMethod ||
      !distanceValid ||
      (form.contact !== null && contact === null) ||
      (contact !== null && contact.length > MAX_CONTACT_LENGTH)
    ) {
      return { ok: false, reason: 'invalid_request' };
    }

    const taken = await this.#registrations.activeDepartures(competition.id, archer.licenceNumber);
    if (departures.some(({ departure }) => taken.includes(departure))) {
      return { ok: false, reason: 'already_registered' };
    }

    const category = ageCategory(birthYear(archer), competition.startDate);
    const result = await this.#registrations.add({
      competitionId: competition.id,
      archerLicenceNumber: archer.licenceNumber,
      departures,
      category,
      trispot: form.trispot,
      carpool: form.carpool,
      distance: distance satisfies Distance | null,
      contact: contact || null,
      paymentMethod,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      departures: departures.map(({ departure }) => departure),
      category,
      paymentReference: result.paymentReference,
      paymentDeadline: clubRegistrationDeadline(competition),
    };
  }

  /** `null` when the competition does not exist. Only for signed-in members: names are private. */
  async registrants(competitionId: string): Promise<RegistrantGroup[] | null> {
    if (!(await this.#competitions.findById(competitionId))) return null;
    const registrants = await this.#registrations.activeRegistrants(competitionId);
    // One request (or a later one for another départ) may have said so: the archer is interested for the competition.
    const carpoolers = new Set(registrants.filter(({ carpool }) => carpool).map((r) => r.archerLicenceNumber));
    const groups = new Map<string, RegistrantGroup>();
    for (const registrant of registrants) {
      const key = `${registrant.archerLicenceNumber}|${registrant.bowType}`;
      const group = groups.get(key);
      if (group) group.departures.push(registrant.departure);
      else
        groups.set(key, {
          fullName: registrant.fullName,
          bowType: registrant.bowType,
          departures: [registrant.departure],
          carpool: carpoolers.has(registrant.archerLicenceNumber),
        });
    }
    return [...groups.values()]
      .map((group) => ({ ...group, departures: group.departures.toSorted((a, b) => a - b) }))
      .toSorted((a, b) => a.fullName.localeCompare(b.fullName, 'fr'));
  }

  /** "Mon suivi": cancelled rows stay in the database for the club, but the archer no longer sees them. */
  async mine(archer: Archer): Promise<MyRegistration[]> {
    const registrations = (await this.#registrations.forArcher(archer.licenceNumber)).filter(
      (registration) => registration.status !== 'cancelled',
    );
    const competitions = new Map<string, Competition>();
    for (const id of new Set(registrations.map((registration) => registration.competitionId))) {
      const competition = await this.#competitions.findById(id);
      if (competition) competitions.set(id, competition);
    }
    const today = this.#clock.today();
    return registrations
      .flatMap((registration) => {
        const competition = competitions.get(registration.competitionId);
        return competition
          ? [{ registration, competition, canWithdraw: canWithdraw(registration, competition, today) }]
          : [];
      })
      .toSorted(
        (a, b) =>
          a.competition.startDate.localeCompare(b.competition.startDate) ||
          a.registration.departure - b.registration.departure,
      );
  }

  async withdraw(archer: Archer, registrationId: number): Promise<WithdrawResult> {
    const registration = await this.#registrations.findById(registrationId);
    // Someone else's registration looks like a missing one.
    if (!registration || registration.archerLicenceNumber !== archer.licenceNumber) {
      return { ok: false, reason: 'not_found' };
    }
    const competition = await this.#competitions.findById(registration.competitionId);
    const today = this.#clock.today();
    if (!competition || !canWithdraw(registration, competition, today)) return { ok: false, reason: 'cannot_withdraw' };

    await this.#registrations.withdraw(registrationId, `Retirée par l'archer le ${toFrenchDate(today)}`, today);
    return { ok: true };
  }
}

/** One to MAX_DEPARTURE distinct départs, each with a known bow, sorted by départ number. */
function parseDepartures(value: unknown): DepartureChoice[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const choices = value.flatMap((item: unknown): DepartureChoice[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { departure, bowType } = item as Record<string, unknown>;
    const bow = BOW_TYPES.find((known) => known === bowType);
    return Number.isInteger(departure) && (departure as number) >= 1 && (departure as number) <= MAX_DEPARTURE && bow
      ? [{ departure: departure as number, bowType: bow }]
      : [];
  });
  const distinct = new Set(choices.map(({ departure }) => departure)).size === choices.length;
  return choices.length === value.length && distinct ? choices.toSorted((a, b) => a.departure - b.departure) : null;
}
