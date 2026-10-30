import type { Knex } from 'knex';

/** The credit (« avoir ») of the `archers` row in the statement, in cents: the sum of its moves. */
const CREDIT_CENTS_SQL = `(select coalesce(sum(moves.amount_cents), 0) from member_credits as moves
  where moves.archer_licence_number = archers.licence_number)`;

/** Selects the credit as `credit_cents`. */
export function creditCentsColumn(database: Knex | Knex.Transaction): Knex.Raw {
  return database.raw(`${CREDIT_CENTS_SQL} as credit_cents`);
}

/** One move of a member's credit; `amountCents` positive when given, negative when spent or taken back. */
export type CreditMove = {
  archerLicenceNumber: string;
  amountCents: number;
  registrationId?: number;
  paymentReference?: string;
  createdBy?: string;
};

export async function addCreditMove(database: Knex | Knex.Transaction, move: CreditMove): Promise<void> {
  await database('member_credits').insert({
    archer_licence_number: move.archerLicenceNumber,
    amount_cents: move.amountCents,
    registration_id: move.registrationId ?? null,
    payment_reference: move.paymentReference ?? null,
    created_by: move.createdBy ?? null,
  });
}
