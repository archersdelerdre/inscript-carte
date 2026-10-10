import {
  canChangeStatus,
  PAYMENT_STATUSES,
  paymentForStatus,
  REGISTRATION_STATUSES,
  type PaymentStatus,
  type RegistrationStatus,
} from '@inscript-carte/shared';

import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { Archer, Responsible } from '../domain/archer.ts';
import { toFrenchDate, type CalendarDate } from '../domain/calendar-date.ts';
import type { CompetitionRepository } from '../domain/competition-repository.ts';
import { isFinished, type Competition } from '../domain/competition.ts';
import type {
  RegistrationChange,
  RegistrationCount,
  RegistrationDetails,
  RegistrationRepository,
} from '../domain/registration-repository.ts';
import type { Registration } from '../domain/registration.ts';
import type { Clock } from './ports/clock.ts';

const MAX_CLUB_NOTE_LENGTH = 500;
/** What the organizer must receive: the club still counts on these départs. */
const SENT_STATUSES: readonly RegistrationStatus[] = ['received', 'sent_to_organizer', 'confirmed'];

export type AdminCompetition = {
  competition: Competition;
  isFinished: boolean;
  statusCounts: Record<RegistrationStatus, number>;
  toPayCount: number;
  /** Paid départs the club no longer counts on: their money goes back to the archer. */
  toRefundCount: number;
};

export type CompetitionRegistrations = { competition: AdminCompetition; registrations: RegistrationDetails[] };

export type OrganizerList = {
  competition: Competition;
  registrations: RegistrationDetails[];
  responsible: Responsible;
};

/** The request body, as sent; every field is checked here. Missing fields stay as they are. */
export type RegistrationUpdateForm = { status?: unknown; paymentStatus?: unknown; clubNote?: unknown };

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'status_change_not_allowed' };

type RegistrationUpdate = { status?: RegistrationStatus; paymentStatus?: PaymentStatus; clubNote?: string | null };

/** The club secretary's work: follow registrations, change statuses and payments, prepare the organizer's list. */
export class AdminRegistrations {
  readonly #competitions: CompetitionRepository;
  readonly #registrations: RegistrationRepository;
  readonly #archers: ArcherRepository;
  readonly #clock: Clock;

  constructor(
    competitions: CompetitionRepository,
    registrations: RegistrationRepository,
    archers: ArcherRepository,
    clock: Clock,
  ) {
    this.#competitions = competitions;
    this.#registrations = registrations;
    this.#archers = archers;
    this.#clock = clock;
  }

  /** Competitions with at least one registration (even cancelled): upcoming soonest first, then finished latest first. */
  async competitions(): Promise<AdminCompetition[]> {
    const countsByCompetition = new Map<string, RegistrationCount[]>();
    for (const count of await this.#registrations.countAll()) {
      countsByCompetition.set(count.competitionId, [...(countsByCompetition.get(count.competitionId) ?? []), count]);
    }
    const today = this.#clock.today();
    const result: AdminCompetition[] = [];
    for (const [id, counts] of countsByCompetition) {
      const competition = await this.#competitions.findById(id);
      if (competition) result.push(summarize(competition, counts, today));
    }
    return result.toSorted(
      (a, b) =>
        Number(a.isFinished) - Number(b.isFinished) ||
        (a.isFinished
          ? b.competition.startDate.localeCompare(a.competition.startDate)
          : a.competition.startDate.localeCompare(b.competition.startDate)),
    );
  }

  /** Every row, cancelled ones included. `null` when the competition does not exist. */
  async competitionRegistrations(competitionId: string): Promise<CompetitionRegistrations | null> {
    const competition = await this.#competitions.findById(competitionId);
    if (!competition) return null;
    const registrations = await this.#registrations.detailsForCompetition(competitionId);
    const counts = registrations.map(({ registration }) => ({
      competitionId,
      status: registration.status,
      paymentStatus: registration.paymentStatus,
      count: 1,
    }));
    return { competition: summarize(competition, counts, this.#clock.today()), registrations };
  }

  /**
   * The départs to send to the organizer (not cancelled, not refused for lack of places), by départ then name. The
   * panel's filters narrow it: usually only the paid départs are sent. `invalid` when a filter value is unknown.
   * The admin who asks is the club's contact on the file, with their stored email and phone.
   */
  async organizerList(
    admin: Archer,
    competitionId: string,
    filters: { status?: unknown; paymentStatus?: unknown },
  ): Promise<OrganizerList | 'not_found' | 'invalid'> {
    const status =
      filters.status === undefined ? undefined : REGISTRATION_STATUSES.find((known) => known === filters.status);
    const paymentStatus =
      filters.paymentStatus === undefined
        ? undefined
        : PAYMENT_STATUSES.find((known) => known === filters.paymentStatus);
    if ((filters.status !== undefined && !status) || (filters.paymentStatus !== undefined && !paymentStatus)) {
      return 'invalid';
    }
    const competition = await this.#competitions.findById(competitionId);
    if (!competition) return 'not_found';
    const registrations = (await this.#registrations.detailsForCompetition(competitionId))
      .filter(
        ({ registration }) =>
          SENT_STATUSES.includes(registration.status) &&
          (!status || registration.status === status) &&
          (!paymentStatus || registration.paymentStatus === paymentStatus),
      )
      .toSorted(
        (a, b) => a.registration.departure - b.registration.departure || a.fullName.localeCompare(b.fullName, 'fr'),
      );
    const responsible = { fullName: admin.fullName, ...(await this.#archers.contactOf(admin.licenceNumber)) };
    return { competition, registrations, responsible };
  }

  async updateRegistration(admin: Archer, registrationId: number, form: RegistrationUpdateForm): Promise<UpdateResult> {
    const update = parseUpdate(form, true);
    if (!update) return { ok: false, reason: 'invalid_request' };
    const registration = await this.#registrations.findById(registrationId);
    if (!registration) return { ok: false, reason: 'not_found' };
    if (update.status && !canChangeStatus(registration.status, update.status)) {
      return { ok: false, reason: 'status_change_not_allowed' };
    }
    const change = changeOf(registration, update, this.#clock.today());
    await this.#registrations.save([change], admin.licenceNumber);
    return { ok: true };
  }

  /** One archer pays all their départs of one competition together: the change applies to all of them. */
  async updatePaymentReference(
    admin: Archer,
    paymentReference: string,
    form: RegistrationUpdateForm,
  ): Promise<UpdateResult> {
    const update = parseUpdate(form, false);
    if (!update) return { ok: false, reason: 'invalid_request' };
    // Cancelled départs stay as they are, so every other one can take the new status.
    const registrations = (await this.#registrations.forPaymentReference(paymentReference)).filter(
      (registration) => registration.status !== 'cancelled',
    );
    if (registrations.length === 0) return { ok: false, reason: 'not_found' };
    const today = this.#clock.today();
    const changes = registrations.flatMap((registration) => {
      const rowUpdate = forReferenceRow(registration, update);
      return rowUpdate ? [changeOf(registration, rowUpdate, today)] : [];
    });
    if (changes.length > 0) await this.#registrations.save(changes, admin.licenceNumber);
    return { ok: true };
  }
}

function summarize(
  competition: Competition,
  counts: readonly RegistrationCount[],
  today: CalendarDate,
): AdminCompetition {
  const statusCounts = Object.fromEntries(REGISTRATION_STATUSES.map((status) => [status, 0])) as Record<
    RegistrationStatus,
    number
  >;
  let toPayCount = 0;
  let toRefundCount = 0;
  for (const { status, paymentStatus, count } of counts) {
    statusCounts[status] += count;
    if (paymentStatus === 'to_pay') toPayCount += count;
    if (paymentStatus === 'to_refund') toRefundCount += count;
  }
  return { competition, isFinished: isFinished(competition, today), statusCounts, toPayCount, toRefundCount };
}

/**
 * "Tout marquer payé" / "Tout remettre en attente" only move départs between those two states: the others (nothing
 * to pay, to refund, refunded) are left as they are. `null` when the row is left untouched, so it does not show this
 * admin as the last one who changed it.
 */
function forReferenceRow(registration: Registration, update: RegistrationUpdate): RegistrationUpdate | null {
  const switches = update.paymentStatus === 'paid' || update.paymentStatus === 'to_pay';
  if (!switches || registration.paymentStatus === 'paid' || registration.paymentStatus === 'to_pay') return update;
  if (update.status === undefined) return null;
  const { paymentStatus: _ignored, ...statusOnly } = update;
  return statusOnly;
}

/** `null` when the form is not valid or changes nothing. */
function parseUpdate(form: RegistrationUpdateForm, allowNote: boolean): RegistrationUpdate | null {
  const update: RegistrationUpdate = {};
  if (form.status !== undefined) {
    const status = REGISTRATION_STATUSES.find((known) => known === form.status);
    if (!status) return null;
    update.status = status;
  }
  if (form.paymentStatus !== undefined) {
    const paymentStatus = PAYMENT_STATUSES.find((known) => known === form.paymentStatus);
    if (!paymentStatus) return null;
    update.paymentStatus = paymentStatus;
  }
  if (form.clubNote !== undefined) {
    if (!allowNote || (form.clubNote !== null && typeof form.clubNote !== 'string')) return null;
    const note = form.clubNote?.trim() ?? '';
    if (note.length > MAX_CLUB_NOTE_LENGTH) return null;
    update.clubNote = note || null;
  }
  return Object.keys(update).length > 0 ? update : null;
}

/**
 * The new values of one row; the status change was checked before. Cancelling adds a line to the note. A status
 * change without a payment choice moves the payment along (`paymentForStatus`).
 */
function changeOf(registration: Registration, update: RegistrationUpdate, today: CalendarDate): RegistrationChange {
  const status = update.status ?? registration.status;
  const note = update.clubNote === undefined ? registration.clubNote : update.clubNote;
  const cancels = status === 'cancelled' && registration.status !== 'cancelled';
  return {
    id: registration.id,
    status,
    paymentStatus: update.paymentStatus ?? paymentForStatus(status, registration.paymentStatus),
    clubNote: cancels ? [note, `Annulée par le club le ${toFrenchDate(today)}`].filter(Boolean).join('\n') : note,
    ...(cancels ? { cancelledAt: today } : {}),
  };
}
