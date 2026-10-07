import type { Knex } from 'knex';

import type { SessionStore } from '../../application/ports/session-store.ts';

export class SqliteSessionStore implements SessionStore {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async create(archerLicenceNumber: string, expiresAt: Date): Promise<string> {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await this.#database('sessions').where('expires_at', '<=', new Date().toISOString()).delete();
    await this.#database('sessions').insert({
      token_hash: hash(token),
      archer_licence_number: archerLicenceNumber,
      expires_at: expiresAt.toISOString(),
    });
    return token;
  }

  async findLicenceNumber(token: string, now: Date): Promise<string | null> {
    const row: { archer_licence_number: string } | undefined = await this.#database('sessions')
      .where({ token_hash: hash(token) })
      .andWhere('expires_at', '>', now.toISOString())
      .first('archer_licence_number');
    return row?.archer_licence_number ?? null;
  }

  async delete(token: string): Promise<void> {
    await this.#database('sessions')
      .where({ token_hash: hash(token) })
      .delete();
  }
}

function hash(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}
