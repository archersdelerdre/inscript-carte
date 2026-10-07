import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { Knex } from 'knex';

import { createDatabase } from './connection.ts';

let database: Knex;

beforeEach(async () => {
  database = createDatabase(':memory:');
  await database.migrate.latest();
  await database('competitions').insert({
    ffta_id: '26588',
    title: 'Concours Salle Carquefou',
    discipline: 'salle',
    start_date: '2027-01-09',
    end_date: '2027-01-10',
    organizer_club: "Les Archers de l'Erdre",
    town: 'Carquefou',
    department_code: '44',
  });
  await database('archers').insert({
    licence_number: '0123456A',
    full_name: 'DUPONT JEAN',
    sex: 'male',
    birth_date: '1980-05-12',
  });
});

afterEach(() => database.destroy());

const registration = {
  competition_ffta_id: '26588',
  archer_licence_number: '0123456A',
  departure: 1,
  bow_type: 'classique',
  payment_reference: 'R-0001',
};

test('an archer has at most one active registration per départ', async () => {
  await database('registrations').insert(registration);
  await expect(Promise.resolve(database('registrations').insert(registration))).rejects.toThrow(/UNIQUE/);

  await database('registrations').update({ status: 'cancelled' });
  await database('registrations').insert(registration);
  expect(await database('registrations').orderBy('id').pluck('status')).toEqual(['cancelled', 'received']);
});

test('registrations must point to an existing competition and archer', async () => {
  await expect(
    Promise.resolve(database('registrations').insert({ ...registration, competition_ffta_id: '99999' })),
  ).rejects.toThrow(/FOREIGN KEY/);
  await expect(
    Promise.resolve(database('registrations').insert({ ...registration, archer_licence_number: '9999999Z' })),
  ).rejects.toThrow(/FOREIGN KEY/);
});

test('a competition with registrations cannot be deleted', async () => {
  await database('registrations').insert(registration);
  await expect(Promise.resolve(database('competitions').delete())).rejects.toThrow(/FOREIGN KEY/);
});

test('enum and range columns reject unknown values', async () => {
  await expect(Promise.resolve(database('registrations').insert({ ...registration, status: 'paid' }))).rejects.toThrow(
    /CHECK/,
  );
  await expect(Promise.resolve(database('registrations').insert({ ...registration, departure: 0 }))).rejects.toThrow(
    /CHECK/,
  );
});

test('rollback removes every table', async () => {
  await database.migrate.rollback(undefined, true);
  const tables = await database('sqlite_master')
    .where({ type: 'table' })
    .whereRaw("name not like 'knex_%' and name not like 'sqlite_%'")
    .pluck('name');
  expect(tables).toEqual([]);
});

test('0004 moves "En attente de paiement" rows to "Reçue", then refuses that status', async () => {
  await database.migrate.down({ name: '0005-admin-password-change' });
  await database.migrate.down({ name: '0004-admin-panel' });
  await database('registrations').insert({ ...registration, status: 'awaiting_payment' });

  await database.migrate.latest();

  expect(await database('registrations').pluck('status')).toEqual(['received']);
  await expect(
    Promise.resolve(database('registrations').insert({ ...registration, departure: 2, status: 'awaiting_payment' })),
  ).rejects.toThrow(/CHECK/);
});
