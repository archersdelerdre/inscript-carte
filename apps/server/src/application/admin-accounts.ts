import type { AdminRepository } from '../domain/admin-repository.ts';
import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { PasswordHasher } from './ports/password-hasher.ts';

export const MIN_ADMIN_PASSWORD_LENGTH = 10;

export type SetAdminPasswordResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'unknown_member' | 'password_too_short' };

/** Who is an admin. From the command line only: no admin can create another one from the panel (yet). */
export class AdminAccounts {
  readonly #archers: ArcherRepository;
  readonly #admins: AdminRepository;
  readonly #hasher: PasswordHasher;

  constructor(archers: ArcherRepository, admins: AdminRepository, hasher: PasswordHasher) {
    this.#archers = archers;
    this.#admins = admins;
    this.#hasher = hasher;
  }

  /** Makes an active member an admin, or changes their password. */
  async setPassword(licenceNumber: string, password: string): Promise<SetAdminPasswordResult> {
    const archer = await this.#archers.findByLicenceNumber(licenceNumber.trim().toUpperCase());
    if (!archer?.isActive) return { ok: false, reason: 'unknown_member' };
    if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return { ok: false, reason: 'password_too_short' };
    const created = (await this.#admins.findPasswordHash(archer.licenceNumber)) === null;
    await this.#admins.save(archer.licenceNumber, await this.#hasher.hash(password));
    return { ok: true, created };
  }

  /** Also ends their admin sessions. `false` when the member was not an admin. */
  async remove(licenceNumber: string): Promise<boolean> {
    return this.#admins.remove(licenceNumber.trim().toUpperCase());
  }
}
