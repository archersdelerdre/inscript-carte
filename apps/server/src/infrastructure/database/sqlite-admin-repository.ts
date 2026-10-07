import type { Knex } from 'knex';

import type { AdminRepository } from '../../domain/admin-repository.ts';

export class SqliteAdminRepository implements AdminRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async findPasswordHash(archerLicenceNumber: string): Promise<string | null> {
    const row: { password_hash: string } | undefined = await this.#database('admins')
      .where({ archer_licence_number: archerLicenceNumber })
      .first('password_hash');
    return row?.password_hash ?? null;
  }

  async save(archerLicenceNumber: string, passwordHash: string): Promise<void> {
    await this.#database('admins')
      .insert({ archer_licence_number: archerLicenceNumber, password_hash: passwordHash })
      .onConflict('archer_licence_number')
      .merge({ password_hash: passwordHash, updated_at: this.#database.fn.now() });
  }

  async remove(archerLicenceNumber: string): Promise<boolean> {
    return (await this.#database('admins').where({ archer_licence_number: archerLicenceNumber }).delete()) > 0;
  }
}
