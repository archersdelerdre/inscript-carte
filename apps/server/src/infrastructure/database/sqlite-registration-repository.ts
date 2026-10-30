import type {
  AgeCategory,
  BowType,
  Distance,
  PaymentMethod,
  PaymentStatus,
  RegistrationStatus,
  Sex,
} from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type {
  AddRegistrationsResult,
  Registrant,
  RegistrationChange,
  RegistrationCount,
  RegistrationDetails,
  RegistrationRepository,
} from '../../domain/registration-repository.ts';
import type { NewRegistration, Registration } from '../../domain/registration.ts';
import { addCreditMove, creditCentsColumn } from './member-credit.ts';

type RegistrationRow = {
  id: number;
  competition_ffta_id: string;
  archer_licence_number: string;
  departure: number;
  bow_type: BowType;
  category: AgeCategory;
  status: RegistrationStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  payment_reference: string;
  club_note: string | null;
  trispot: 0 | 1;
  carpool: 0 | 1;
  distance: Distance | null;
  contact: string | null;
  /** SQLite `CURRENT_TIMESTAMP`: `YYYY-MM-DD HH:MM:SS`, UTC. */
  created_at: string;
  updated_by: string | null;
  credit_cents: number | null;
};

const ACTIVE = (query: Knex.QueryBuilder) => query.whereNot('registrations.status', 'cancelled');

export class SqliteRegistrationRepository implements RegistrationRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async countActiveArchersByCompetition(): Promise<Map<string, number>> {
    const rows: { competition_ffta_id: string; count: number }[] = await this.#database('registrations')
      .modify(ACTIVE)
      .groupBy('competition_ffta_id')
      .select('competition_ffta_id')
      .countDistinct({ count: 'archer_licence_number' });
    return new Map(rows.map((row) => [row.competition_ffta_id, Number(row.count)]));
  }

  async countAll(): Promise<RegistrationCount[]> {
    const rows: {
      competition_ffta_id: string;
      status: RegistrationStatus;
      payment_status: PaymentStatus;
      count: number;
    }[] = await this.#database('registrations')
      .groupBy('competition_ffta_id', 'status', 'payment_status')
      .select('competition_ffta_id', 'status', 'payment_status')
      .count({ count: '*' });
    return rows.map((row) => ({
      competitionId: row.competition_ffta_id,
      status: row.status,
      paymentStatus: row.payment_status,
      count: Number(row.count),
    }));
  }

  async activeDepartures(competitionId: string, archerLicenceNumber: string): Promise<number[]> {
    return this.#database('registrations')
      .modify(ACTIVE)
      .where({ competition_ffta_id: competitionId, archer_licence_number: archerLicenceNumber })
      .pluck('departure');
  }

  async add(registration: NewRegistration): Promise<AddRegistrationsResult> {
    try {
      return await this.#database.transaction(async (transaction) => {
        const where = {
          competition_ffta_id: registration.competitionId,
          archer_licence_number: registration.archerLicenceNumber,
        };
        const creditUsed = registration.creditUsedCents;
        if (creditUsed !== null) {
          const archer: { credit_cents: number } | undefined = await transaction('archers')
            .where({ licence_number: registration.archerLicenceNumber })
            .first(creditCentsColumn(transaction));
          if (!archer || archer.credit_cents < creditUsed) return { ok: false, reason: 'credit_too_low' } as const;
          // The credit pays the whole competition: the earlier départs still unpaid too.
          await transaction('registrations')
            .where({ ...where, payment_status: 'to_pay' })
            .whereNotIn('status', ['full', 'cancelled'])
            .update({ payment_status: 'paid', payment_method: 'credit', updated_at: transaction.fn.now() });
        }
        // One reference per archer and competition: a second request (another départ) joins the first one, even if its
        // départs were all withdrawn, so the club sees one payment.
        const existing: { payment_reference: string } | undefined = await transaction('registrations')
          .where(where)
          .orderBy('id')
          .first('payment_reference');
        // Otherwise a club-wide counter, like the old sheet: R-0001, R-0002…
        const { last } = (await transaction('registrations')
          .max({ last: transaction.raw('cast(substr(payment_reference, 3) as integer)') })
          .first()) as { last: number | null };
        const paymentReference = existing?.payment_reference ?? `R-${String((last ?? 0) + 1).padStart(4, '0')}`;
        await transaction('registrations').insert(
          registration.departures.map(({ departure, bowType }) => ({
            ...where,
            departure,
            bow_type: bowType,
            category: registration.category,
            trispot: registration.trispot,
            carpool: registration.carpool,
            distance: registration.distance,
            contact: registration.contact,
            payment_method: registration.paymentMethod,
            payment_status: registration.paymentStatus,
            payment_reference: paymentReference,
          })),
        );
        if (creditUsed !== null && creditUsed > 0) {
          await addCreditMove(transaction, {
            archerLicenceNumber: registration.archerLicenceNumber,
            amountCents: -creditUsed,
            paymentReference,
          });
        }
        // Covoiturage is the archer's answer for the whole competition: the latest request wins on every active départ.
        await transaction('registrations')
          .modify(ACTIVE)
          .where(where)
          .update({ carpool: registration.carpool, updated_at: transaction.fn.now() });
        return { ok: true, paymentReference } as const;
      });
    } catch (error) {
      // Two requests at the same time for the same départ: the partial unique index keeps only one.
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { ok: false, reason: 'already_registered' };
      }
      throw error;
    }
  }

  async activeRegistrants(competitionId: string): Promise<Registrant[]> {
    const rows: {
      archer_licence_number: string;
      full_name: string;
      category: AgeCategory;
      sex: Sex;
      bow_type: BowType;
      departure: number;
      carpool: 0 | 1;
    }[] = await this.#database('registrations')
      .modify(ACTIVE)
      .join('archers', 'archers.licence_number', 'registrations.archer_licence_number')
      .where({ competition_ffta_id: competitionId })
      .select(
        'registrations.archer_licence_number',
        'archers.full_name',
        'registrations.category',
        'archers.sex',
        'registrations.bow_type',
        'registrations.departure',
        'registrations.carpool',
      );
    return rows.map((row) => ({
      archerLicenceNumber: row.archer_licence_number,
      fullName: row.full_name,
      category: row.category,
      sex: row.sex,
      bowType: row.bow_type,
      departure: row.departure,
      carpool: row.carpool === 1,
    }));
  }

  async forArcher(archerLicenceNumber: string): Promise<Registration[]> {
    const rows = await this.#database<RegistrationRow>('registrations')
      .where({ archer_licence_number: archerLicenceNumber })
      .orderBy('id');
    return rows.map(toRegistration);
  }

  async detailsForCompetition(competitionId: string): Promise<RegistrationDetails[]> {
    const rows: (RegistrationRow & {
      full_name: string;
      sex: Sex;
      updated_by_name: string | null;
      club_pays_registrations: 0 | 1;
    })[] = await this.#database('registrations')
      .join('archers', 'archers.licence_number', 'registrations.archer_licence_number')
      .leftJoin('archers as editors', 'editors.licence_number', 'registrations.updated_by')
      .where({ competition_ffta_id: competitionId })
      .orderBy(['registrations.payment_reference', 'registrations.departure'])
      .select(
        'registrations.*',
        'archers.full_name',
        'archers.sex',
        'archers.club_pays_registrations',
        'editors.full_name as updated_by_name',
      );
    return rows.map((row) => ({
      registration: toRegistration(row),
      fullName: row.full_name,
      sex: row.sex,
      updatedByName: row.updated_by_name,
      clubPaysRegistrations: row.club_pays_registrations === 1,
    }));
  }

  async forPaymentReference(paymentReference: string): Promise<Registration[]> {
    const rows = await this.#database<RegistrationRow>('registrations')
      .where({ payment_reference: paymentReference })
      .orderBy('departure');
    return rows.map(toRegistration);
  }

  async findById(id: number): Promise<Registration | null> {
    const row = await this.#database<RegistrationRow>('registrations').where({ id }).first();
    return row ? toRegistration(row) : null;
  }

  async withdraw(
    id: number,
    note: string,
    today: CalendarDate,
    payment: Pick<RegistrationChange, 'paymentStatus' | 'creditCents' | 'creditMoveCents'>,
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await transaction('registrations').where({ id }).update({
        status: 'cancelled',
        payment_status: payment.paymentStatus,
        credit_cents: payment.creditCents,
        club_note: note,
        cancelled_at: today,
        updated_at: transaction.fn.now(),
      });
      await moveCredit(transaction, id, payment.creditMoveCents);
    });
  }

  async save(changes: readonly RegistrationChange[], updatedBy: string): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      for (const change of changes) {
        await transaction('registrations')
          .where({ id: change.id })
          .update({
            status: change.status,
            payment_status: change.paymentStatus,
            credit_cents: change.creditCents,
            club_note: change.clubNote,
            ...(change.cancelledAt ? { cancelled_at: change.cancelledAt } : {}),
            updated_by: updatedBy,
            updated_at: transaction.fn.now(),
          });
        await moveCredit(transaction, change.id, change.creditMoveCents, updatedBy);
      }
    });
  }
}

async function moveCredit(
  transaction: Knex.Transaction,
  registrationId: number,
  amountCents: number,
  createdBy?: string,
): Promise<void> {
  if (amountCents === 0) return;
  const row: Pick<RegistrationRow, 'archer_licence_number' | 'payment_reference'> = await transaction('registrations')
    .where({ id: registrationId })
    .first('archer_licence_number', 'payment_reference');
  await addCreditMove(transaction, {
    archerLicenceNumber: row.archer_licence_number,
    amountCents,
    registrationId,
    paymentReference: row.payment_reference,
    ...(createdBy && { createdBy }),
  });
}

function toRegistration(row: RegistrationRow): Registration {
  return {
    id: row.id,
    competitionId: row.competition_ffta_id,
    archerLicenceNumber: row.archer_licence_number,
    departure: row.departure,
    bowType: row.bow_type,
    category: row.category,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    clubNote: row.club_note,
    trispot: row.trispot === 1,
    carpool: row.carpool === 1,
    distance: row.distance,
    contact: row.contact,
    createdAt: `${row.created_at.replace(' ', 'T')}Z`,
    updatedBy: row.updated_by,
    creditCents: row.credit_cents,
  };
}
