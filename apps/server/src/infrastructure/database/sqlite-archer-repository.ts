import type { Sex } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { ArcherRepository } from '../../domain/archer-repository.ts';
import type { Archer, ArcherContact } from '../../domain/archer.ts';
import { creditCentsColumn } from './member-credit.ts';

type ArcherRow = {
  licence_number: string;
  full_name: string;
  sex: Sex;
  birth_date: string;
  is_active: 0 | 1;
  club_pays_registrations: 0 | 1;
  password_hash: string | null;
  credit_cents: number;
};

export class SqliteArcherRepository implements ArcherRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async findByLicenceNumber(licenceNumber: string): Promise<Archer | null> {
    const row: ArcherRow | undefined = await this.#database('archers')
      .where({ licence_number: licenceNumber })
      .first('archers.*', creditCentsColumn(this.#database));
    return row
      ? {
          licenceNumber: row.licence_number,
          fullName: row.full_name,
          sex: row.sex,
          birthDate: row.birth_date,
          isActive: row.is_active === 1,
          clubPaysRegistrations: row.club_pays_registrations === 1,
          hasPassword: row.password_hash !== null,
          creditCents: row.credit_cents,
        }
      : null;
  }

  async contactOf(licenceNumber: string): Promise<ArcherContact> {
    const row: { email: string | null; phone: string | null } | undefined = await this.#database('archers')
      .where({ licence_number: licenceNumber })
      .first('email', 'phone');
    return { email: row?.email ?? null, phone: row?.phone ?? null };
  }

  async passwordHash(licenceNumber: string): Promise<string | null> {
    const row: { password_hash: string | null } | undefined = await this.#database('archers')
      .where({ licence_number: licenceNumber })
      .first('password_hash');
    return row?.password_hash ?? null;
  }

  async savePasswordHash(licenceNumber: string, passwordHash: string | null): Promise<void> {
    await this.#database('archers')
      .where({ licence_number: licenceNumber })
      .update({ password_hash: passwordHash, updated_at: this.#database.fn.now() });
  }
}
