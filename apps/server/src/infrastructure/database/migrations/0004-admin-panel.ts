import type { Knex } from 'knex';

// Copied on purpose: a migration must not change when app constants change.
const OLD_STATUSES = ['received', 'awaiting_payment', 'sent_to_organizer', 'confirmed', 'full', 'cancelled'];
/** "En attente de paiement" is dropped: the payment has its own field. */
const NEW_STATUSES = ['received', 'sent_to_organizer', 'confirmed', 'full', 'cancelled'];

const KEPT_COLUMNS = [
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
  'payment_status',
  'payment_reference',
  'club_note',
  'cancelled_at',
  'created_at',
  'updated_at',
  'payment_method',
];

/** Admins (members with a password), their sessions, the member list imports, and who changed a registration. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('admins', (table) => {
    table
      .text('archer_licence_number')
      .notNullable()
      .primary()
      .references('licence_number')
      .inTable('archers')
      .onDelete('RESTRICT');
    table.text('password_hash').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('admin_sessions', (table) => {
    table.text('token_hash').notNullable().primary();
    // Removing an admin ends their sessions.
    table
      .text('archer_licence_number')
      .notNullable()
      .references('archer_licence_number')
      .inTable('admins')
      .onDelete('CASCADE');
    table.text('expires_at').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['expires_at']);
  });

  await knex.schema.createTable('member_imports', (table) => {
    table.increments('id');
    table.timestamp('imported_at').notNullable().defaultTo(knex.fn.now());
    /** `NULL` when imported from the command line. */
    table.text('imported_by').references('licence_number').inTable('archers').onDelete('RESTRICT');
    table.integer('member_count').notNullable();
    table.integer('added').notNullable();
    table.integer('updated').notNullable();
    table.integer('deactivated').notNullable();
    table.integer('unchanged').notNullable();
  });

  await knex('registrations').where({ status: 'awaiting_payment' }).update({ status: 'received' });
  await rebuildRegistrations(knex, NEW_STATUSES, true);
}

export async function down(knex: Knex): Promise<void> {
  await rebuildRegistrations(knex, OLD_STATUSES, false);
  await knex.schema.dropTable('member_imports');
  await knex.schema.dropTable('admin_sessions');
  await knex.schema.dropTable('admins');
}

/** SQLite cannot change a CHECK constraint: the table is copied into a new one. No table points to it. */
async function rebuildRegistrations(knex: Knex, statuses: string[], withUpdatedBy: boolean): Promise<void> {
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
    table.enu('status', statuses).notNullable().defaultTo('received');
    table.enu('payment_status', ['to_pay', 'paid']).notNullable().defaultTo('to_pay');
    table.text('payment_reference').notNullable();
    table.text('club_note');
    table.timestamp('cancelled_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.enu('payment_method', ['cash', 'cheque', 'transfer']);
    /** The admin who changed the row last. */
    if (withUpdatedBy) table.text('updated_by').references('licence_number').inTable('archers').onDelete('RESTRICT');
  });

  const columns = KEPT_COLUMNS.join(', ');
  await knex.raw(`insert into registrations_new (${columns}) select ${columns} from registrations`);
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
