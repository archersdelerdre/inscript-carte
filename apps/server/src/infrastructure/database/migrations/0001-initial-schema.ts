import type { Knex } from 'knex';

// Value lists are copied here on purpose: a migration must not change when app constants change.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('competitions', (table) => {
    table.text('ffta_id').notNullable().primary();
    table.text('title').notNullable();
    table
      .enu('discipline', ['salle', 'exterieur', 'campagne', '3d', 'nature', 'beursault', 'loisirs', 'autres'])
      .notNullable();
    table.enu('status', ['scheduled', 'postponed', 'cancelled']).notNullable().defaultTo('scheduled');
    table.text('start_date').notNullable();
    table.text('end_date').notNullable();
    table.text('organizer_club');
    table.text('organizer_email');
    table.text('town').notNullable();
    table.text('department_code').notNullable();
    table.double('latitude');
    table.double('longitude');
    table.boolean('has_para_tir').notNullable().defaultTo(false);
    table.text('mandate_url');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['start_date']);
    table.index(['department_code', 'start_date']);
  });

  await knex.schema.createTable('archers', (table) => {
    table.text('licence_number').notNullable().primary();
    table.text('full_name').notNullable();
    table.enu('sex', ['female', 'male']).notNullable();
    table.text('birth_date').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('registrations', (table) => {
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
      .enu('status', ['received', 'awaiting_payment', 'sent_to_organizer', 'confirmed', 'full', 'cancelled'])
      .notNullable()
      .defaultTo('received');
    table.enu('payment_status', ['to_pay', 'paid']).notNullable().defaultTo('to_pay');
    table.text('payment_reference').notNullable();
    table.text('club_note');
    table.timestamp('cancelled_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['archer_licence_number']);
    table.index(['payment_reference']);
    table.unique(['competition_ffta_id', 'archer_licence_number', 'departure'], {
      indexName: 'registrations_active_unique',
      predicate: knex.whereRaw("status <> 'cancelled'"),
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('registrations');
  await knex.schema.dropTable('archers');
  await knex.schema.dropTable('competitions');
}
