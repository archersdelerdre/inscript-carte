import type { Sex } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { ArcherRepository } from '../../domain/archer-repository.ts';
import type { Archer } from '../../domain/archer.ts';

type ArcherRow = {
  licence_number: string;
  full_name: string;
  sex: Sex;
  birth_date: string;
  is_active: 0 | 1;
};

export class SqliteArcherRepository implements ArcherRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async findByLicenceNumber(licenceNumber: string): Promise<Archer | null> {
    const row = await this.#database<ArcherRow>('archers').where({ licence_number: licenceNumber }).first();
    return row
      ? {
          licenceNumber: row.licence_number,
          fullName: row.full_name,
          sex: row.sex,
          birthDate: row.birth_date,
          isActive: row.is_active === 1,
        }
      : null;
  }
}
