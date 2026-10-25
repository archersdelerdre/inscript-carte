import type { Knex } from 'knex';

import type { AdminAccount, AdminRepository } from '../../domain/admin-repository.ts';

export class SqliteAdminRepository implements AdminRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async find(archerLicenceNumber: string): Promise<AdminAccount | null> {
    const row: { must_change_password: 0 | 1 } | undefined = await this.#database('admins')
      .where({ archer_licence_number: archerLicenceNumber })
      .first('must_change_password');
    return row ? { mustChangePassword: row.must_change_password === 1 } : null;
  }

  async licenceNumbers(): Promise<string[]> {
    return this.#database('admins').pluck('archer_licence_number');
  }

  async save(archerLicenceNumber: string, { mustChangePassword }: AdminAccount): Promise<void> {
    const values = { must_change_password: mustChangePassword };
    await this.#database('admins')
      .insert({ archer_licence_number: archerLicenceNumber, ...values })
      .onConflict('archer_licence_number')
      .merge({ ...values, updated_at: this.#database.fn.now() });
  }

  async remove(archerLicenceNumber: string): Promise<boolean> {
    return (await this.#database('admins').where({ archer_licence_number: archerLicenceNumber }).delete()) > 0;
  }
}
