import type { Knex } from 'knex';

/**
 * Outside a transaction: SQLite cannot turn foreign keys off inside one, and going back rebuilds `archers`, which other
 * tables reference.
 */
export const config = { transaction: false };

/**
 * Passwords (2026-10-25). A member may add one (optional): `archers.password_hash`, argon2id, `NULL` = none, never
 * touched by the member import. One password per person: an admin's moves there and `admins` keeps only who is an
 * admin. One sign-in: a site session opened with the password (`sessions.opened_with_password`) opens the panel, so
 * the admin sessions go. Admins sign in to the site again once, with their password, to open the panel.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('archers', (table) => {
    table.text('password_hash');
  });
  await knex('archers')
    .whereIn('licence_number', knex('admins').select('archer_licence_number'))
    .update({
      password_hash: knex('admins')
        .select('password_hash')
        .where('admins.archer_licence_number', knex.ref('archers.licence_number')),
    });
  // First: it references `admins`, rebuilt by the column drop below.
  await knex.schema.dropTable('admin_sessions');
  await knex.schema.alterTable('admins', (table) => {
    table.dropColumn('password_hash');
  });
  await knex.schema.alterTable('sessions', (table) => {
    table.boolean('opened_with_password').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('sessions', (table) => {
    table.dropColumn('opened_with_password');
  });
  await knex.schema.alterTable('admins', (table) => {
    table.text('password_hash');
  });
  await knex('admins').update({
    password_hash: knex('archers')
      .select('password_hash')
      .where('archers.licence_number', knex.ref('admins.archer_licence_number')),
  });
  await knex.schema.createTable('admin_sessions', (table) => {
    table.text('token_hash').notNullable().primary();
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
  await knex.schema.alterTable('archers', (table) => {
    table.dropColumn('password_hash');
  });
}
