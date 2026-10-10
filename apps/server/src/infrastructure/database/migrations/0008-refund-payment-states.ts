import type { Knex } from 'knex';

/**
 * Five payment states instead of two (2026-10-10): « Rien à payer » and « À rembourser » are stored now, plus
 * « Remboursé ». SQLite cannot change a CHECK constraint, so the table is copied into a new one with the new list.
 * Existing rows: a « Plus de place » or cancelled départ not paid has nothing to pay, a paid one is to refund.
 */
const NEW = ['to_pay', 'paid', 'nothing_due', 'to_refund', 'refunded'];
const OLD = ['to_pay', 'paid'];

async function rebuild(knex: Knex, paymentStatuses: string[], paymentStatusSql: string): Promise<void> {
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
    table.enu('payment_status', paymentStatuses).notNullable().defaultTo('to_pay');
    table.enu('payment_method', ['cash', 'cheque', 'transfer']);
    table.text('payment_reference').notNullable();
    table.text('club_note');
    table.timestamp('cancelled_at');
    table.text('updated_by').references('licence_number').inTable('archers').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.boolean('carpool').notNullable().defaultTo(false);
  });
  const columns = [
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
    'payment_method',
    'payment_reference',
    'club_note',
    'cancelled_at',
    'updated_by',
    'created_at',
    'updated_at',
    'carpool',
  ].join(', ');
  await knex.raw(
    `insert into registrations_new (${columns}, payment_status) select ${columns}, ${paymentStatusSql} from registrations`,
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
  await rebuild(
    knex,
    NEW,
    `case when status in ('full', 'cancelled') then
       case payment_status when 'paid' then 'to_refund' else 'nothing_due' end
     else payment_status end`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await rebuild(knex, OLD, `case when payment_status in ('paid', 'to_refund') then 'paid' else 'to_pay' end`);
}
