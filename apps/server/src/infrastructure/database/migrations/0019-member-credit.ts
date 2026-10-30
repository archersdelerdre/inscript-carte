import type { Knex } from 'knex';

/**
 * Credit (« avoir », 2026-10-30): a départ to refund can be kept as credit instead (`credited`, the amount in
 * `credit_cents`), and the archer pays a later registration with it (method `credit`). Every move of a member's credit
 * is one `member_credits` row: the balance is their sum. SQLite cannot change a CHECK constraint, so the registrations
 * are copied into a new table (as in 0008).
 */
const PAYMENT_STATUSES = ['to_pay', 'paid', 'nothing_due', 'to_refund', 'refunded'];
const PAYMENT_METHODS = ['cash', 'cheque', 'transfer'];
const COLUMNS = [
  'id',
  'competition_ffta_id',
  'archer_licence_number',
  'departure',
  'bow_type',
  'category',
  'trispot',
  'distance',
  'contact',
  'status',
  'payment_reference',
  'club_note',
  'cancelled_at',
  'updated_by',
  'created_at',
  'updated_at',
  'carpool',
].join(', ');

type Rebuild = { withCredit: boolean; paymentStatusSql: string; paymentMethodSql: string };

async function rebuild(knex: Knex, { withCredit, paymentStatusSql, paymentMethodSql }: Rebuild): Promise<void> {
  await knex.schema.createTable('registrations_new', (table) => {
    table.increments('id');
    table.text('competition_ffta_id').notNullable().references('ffta_id').inTable('competitions').onDelete('RESTRICT');
    table
      .text('archer_licence_number')
      .notNullable()
      .references('licence_number')
      .inTable('archers')
      .onDelete('RESTRICT');
    table.integer('departure').notNullable().checkPositive();
    table.enu('bow_type', ['classique', 'poulies', 'arc_nu', 'chasse', 'longbow']).notNullable();
    table.text('category');
    table.boolean('trispot').notNullable().defaultTo(false);
    table.enu('distance', ['nationales', 'internationales']);
    table.text('contact');
    table
      .enu('status', ['received', 'sent_to_organizer', 'confirmed', 'full', 'cancelled'])
      .notNullable()
      .defaultTo('received');
    table
      .enu('payment_status', withCredit ? [...PAYMENT_STATUSES, 'credited'] : PAYMENT_STATUSES)
      .notNullable()
      .defaultTo('to_pay');
    table.enu('payment_method', withCredit ? [...PAYMENT_METHODS, 'credit'] : PAYMENT_METHODS);
    table.text('payment_reference').notNullable();
    table.text('club_note');
    table.timestamp('cancelled_at');
    table.text('updated_by').references('licence_number').inTable('archers').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.boolean('carpool').notNullable().defaultTo(false);
    if (withCredit) table.integer('credit_cents').checkPositive();
  });
  await knex.raw(
    `insert into registrations_new (${COLUMNS}, payment_status, payment_method)
     select ${COLUMNS}, ${paymentStatusSql}, ${paymentMethodSql} from registrations`,
  );
  await knex.schema.dropTable('registrations');
  await knex.schema.renameTable('registrations_new', 'registrations');
  await knex.schema.alterTable('registrations', (table) => {
    table.index(['archer_licence_number']);
    table.index(['payment_reference']);
    table.unique(['competition_ffta_id', 'archer_licence_number', 'departure'], {
      indexName: 'registrations_active_unique',
      predicate: knex.whereRaw("status <> 'cancelled'"),
    });
  });
}

export async function up(knex: Knex): Promise<void> {
  await rebuild(knex, { withCredit: true, paymentStatusSql: 'payment_status', paymentMethodSql: 'payment_method' });
  await knex.schema.createTable('member_credits', (table) => {
    table.increments('id');
    table
      .text('archer_licence_number')
      .notNullable()
      .references('licence_number')
      .inTable('archers')
      .onDelete('RESTRICT');
    /** Positive: credit given; negative: credit spent, taken back or given back. */
    table.integer('amount_cents').notNullable();
    // No foreign key: a later copy of `registrations` (to change a CHECK) would have to rebuild this table too.
    table.integer('registration_id');
    table.text('payment_reference');
    table.text('created_by').references('licence_number').inTable('archers').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['archer_licence_number']);
  });
}

/** Credit kept goes back to « À rembourser »; départs paid with credit stay « Payé », without a method. */
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('member_credits');
  await rebuild(knex, {
    withCredit: false,
    paymentStatusSql: "case payment_status when 'credited' then 'to_refund' else payment_status end",
    paymentMethodSql: "case payment_method when 'credit' then null else payment_method end",
  });
}
