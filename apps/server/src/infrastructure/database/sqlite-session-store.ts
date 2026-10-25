import type { Knex } from 'knex';

import type { Session, SessionStore } from '../../application/ports/session-store.ts';

/** Only the token's SHA-256 is stored: a copy of the database alone cannot be used to sign in. */
export class SqliteSessionStore implements SessionStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create(archerLicenceNumber: string, expiresAt: Date, now: Date, openedWithPassword: boolean): Promise<string> {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await this.#database('sessions').where('expires_at', '<=', now.toISOString()).delete();
    await this.#database('sessions').insert({
      token_hash: hash(token),
      archer_licence_number: archerLicenceNumber,
      expires_at: expiresAt.toISOString(),
      opened_with_password: openedWithPassword,
    });
    return token;
  }

  async find(token: string, now: Date): Promise<Session | null> {
    const row: { archer_licence_number: string; opened_with_password: 0 | 1 } | undefined = await this.#database(
      'sessions',
    )
      .where({ token_hash: hash(token) })
      .andWhere('expires_at', '>', now.toISOString())
      .first('archer_licence_number', 'opened_with_password');
    return row
      ? { archerLicenceNumber: row.archer_licence_number, openedWithPassword: row.opened_with_password === 1 }
      : null;
  }

  async markOpenedWithPassword(token: string): Promise<void> {
    await this.#database('sessions')
      .where({ token_hash: hash(token) })
      .update({ opened_with_password: true });
  }

  async delete(token: string): Promise<void> {
    await this.#database('sessions')
      .where({ token_hash: hash(token) })
      .delete();
  }

  async deleteOthers(archerLicenceNumber: string, keepToken: string): Promise<void> {
    await this.#database('sessions')
      .where({ archer_licence_number: archerLicenceNumber })
      .whereNot({ token_hash: hash(keepToken) })
      .delete();
  }
}

function hash(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}
