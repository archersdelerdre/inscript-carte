import {
  canChangePayment,
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
/** No départ costs that much: a typing mistake. */
const MAX_CREDIT_CENTS = 100_000;
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
export type RegistrationUpdateForm = {
  status?: unknown;
  paymentStatus?: unknown;
  credit?: unknown;
  clubNote?: unknown;
};

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_request' | 'status_change_not_allowed' | 'credit_already_used' };

type RegistrationUpdate = {
  status?: RegistrationStatus;
  paymentStatus?: PaymentStatus;
  /** With `paymentStatus: 'credited'`: the amount kept. */
  creditCents?: number;
  clubNote?: string | null;
};

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
    if (update.paymentStatus && !canChangePayment(registration.paymentStatus, update.paymentStatus)) {
      return { ok: false, reason: 'invalid_request' };
    }
    // A new credit needs its amount, and only a new one.
    const newCredit = update.paymentStatus === 'credited' && registration.paymentStatus !== 'credited';
    if (newCredit !== (update.creditCents !== undefined)) return { ok: false, reason: 'invalid_request' };
    const archer = await this.#archers.findByLicenceNumber(registration.archerLicenceNumber);
    const change = changeOf(registration, update, this.#clock.today(), archer?.clubPaysRegistrations ?? false);
    const settled = settleCredit(registration, change, update, archer?.creditCents ?? 0);
    if (!settled) return { ok: false, reason: 'credit_already_used' };
    await this.#registrations.save([settled.change], admin.licenceNumber);
    return { ok: true };
  }

  /** One archer pays all their départs of one competition together: the change applies to all of them. */
  async updatePaymentReference(
    admin: Archer,
    paymentReference: string,
    form: RegistrationUpdateForm,
  ): Promise<UpdateResult> {
    const update = parseUpdate(form, false);
    // Credit is given one départ at a time, with its own amount.
    if (!update || update.paymentStatus === 'credited') return { ok: false, reason: 'invalid_request' };
    const registrations = await this.#registrations.forPaymentReference(paymentReference);
    if (registrations.length === 0) return { ok: false, reason: 'not_found' };
    const today = this.#clock.today();
    // One reference belongs to one archer.
    const archer = await this.#archers.findByLicenceNumber(registrations[0]!.archerLicenceNumber);
    const clubPays = archer?.clubPaysRegistrations ?? false;
    let creditCents = archer?.creditCents ?? 0;
    const changes: RegistrationChange[] = [];
    for (const registration of registrations) {
      const rowUpdate = forReferenceRow(registration, update);
      if (!rowUpdate) continue;
      const settled = settleCredit(
        registration,
        changeOf(registration, rowUpdate, today, clubPays),
        rowUpdate,
        creditCents,
      );
      if (!settled) return { ok: false, reason: 'credit_already_used' };
      changes.push(settled.change);
      creditCents = settled.creditCents;
    }
    if (changes.length > 0) await this.#registrations.save(changes, admin.licenceNumber);
    return { ok: true };
  }
}

/** For a whole reference, a payment state only replaces these ones: « Tout marquer remboursé » leaves « Payé » as is. */
const REFERENCE_PAYMENT_FROM: Record<PaymentStatus, readonly PaymentStatus[]> = {
  to_pay: ['paid'],
  paid: ['to_pay'],
  nothing_due: ['to_pay'],
  to_refund: ['refunded'],
  refunded: ['to_refund'],
  credited: [],
};

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
 * One row's part of a reference change. Cancelled départs keep their status (the archer registers again instead),
 * but their payment can still change: one paid then cancelled is refunded too. `null` when the row is left
 * untouched, so it does not show this admin as the last one who changed it.
 */
function forReferenceRow(registration: Registration, update: RegistrationUpdate): RegistrationUpdate | null {
  const rowUpdate: RegistrationUpdate = {};
  if (update.status && registration.status !== 'cancelled') rowUpdate.status = update.status;
  if (update.paymentStatus && REFERENCE_PAYMENT_FROM[update.paymentStatus].includes(registration.paymentStatus)) {
    rowUpdate.paymentStatus = update.paymentStatus;
  }
  return Object.keys(rowUpdate).length > 0 ? rowUpdate : null;
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
  if (form.credit !== undefined) {
    const cents = typeof form.credit === 'number' ? Math.round(form.credit * 100) : Number.NaN;
    if (!(cents > 0 && cents <= MAX_CREDIT_CENTS) || Math.abs(cents - (form.credit as number) * 100) > 1e-6)
      return null;
    update.creditCents = cents;
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
 * change without a payment choice moves the payment along (`paymentForStatus`). The credit is settled after
 * (`settleCredit`).
 */
function changeOf(
  registration: Registration,
  update: RegistrationUpdate,
  today: CalendarDate,
  clubPays: boolean,
): RegistrationChange {
  const status = update.status ?? registration.status;
  const note = update.clubNote === undefined ? registration.clubNote : update.clubNote;
  const cancels = status === 'cancelled' && registration.status !== 'cancelled';
  return {
    id: registration.id,
    status,
    paymentStatus: update.paymentStatus ?? paymentForStatus(status, registration.paymentStatus, clubPays),
    clubNote: cancels ? [note, `Annulée par le club le ${toFrenchDate(today)}`].filter(Boolean).join('\n') : note,
    creditCents: registration.creditCents,
    creditMoveCents: 0,
    ...(cancels ? { cancelledAt: today } : {}),
  };
}

/**
 * The credit side of one change, given the archer's credit before it (`creditCents`). Kept as credit: the amount
 * goes to the credit. Leaving « Gardé en avoir » takes it back, only while the archer still has it: otherwise an
 * admin's choice is refused (`null`), and a départ back on track through its status is to pay again (its credit
 * already paid something else).
 */
function settleCredit(
  registration: Registration,
  change: RegistrationChange,
  update: RegistrationUpdate,
  creditCents: number,
): { change: RegistrationChange; creditCents: number } | null {
  const wasCredited = registration.paymentStatus === 'credited';
  if (change.paymentStatus === 'credited') {
    if (wasCredited) return { change, creditCents };
    const kept = update.creditCents!;
    return { change: { ...change, creditCents: kept, creditMoveCents: kept }, creditCents: creditCents + kept };
  }
  if (!wasCredited) return { change, creditCents };
  const kept = registration.creditCents ?? 0;
  if (creditCents >= kept) {
    return { change: { ...change, creditCents: null, creditMoveCents: -kept }, creditCents: creditCents - kept };
  }
  if (update.paymentStatus) return null;
  return { change: { ...change, paymentStatus: 'to_pay', creditCents: null }, creditCents };
}
