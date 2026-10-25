import { MIN_ADMIN_PASSWORD_LENGTH } from '@inscript-carte/shared';

import type { AdminRepository } from '../domain/admin-repository.ts';
import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { Archer } from '../domain/archer.ts';
import type { PasswordHasher } from './ports/password-hasher.ts';

/** No 0/O, 1/I/L: the password is read aloud or copied by hand. 31¹² ≈ 2⁵⁹ possibilities. */
const GENERATED_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GENERATED_GROUPS = 3;
const GENERATED_GROUP_LENGTH = 4;

export type SetAdminPasswordResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'unknown_member' | 'password_too_short' };

export type GrantAdminResult =
  /** `password`: the generated one, `null` when the member already has their own (it stays, for both). */
  { ok: true; password: string | null } | { ok: false; reason: 'not_found' | 'member_inactive' | 'already_admin' };

export type RevokeAdminResult = { ok: true } | { ok: false; reason: 'not_found' | 'cannot_change_self' };

/**
 * Who is an admin: from the command line (own password) or from the panel. One password per person (the user's
 * choice, 2026-10-25): an admin's password is their member password, asked at both sign-ins.
 */
export class AdminAccounts {
  readonly #archers: ArcherRepository;
  readonly #admins: AdminRepository;
  readonly #hasher: PasswordHasher;

  constructor(archers: ArcherRepository, admins: AdminRepository, hasher: PasswordHasher) {
    this.#archers = archers;
    this.#admins = admins;
    this.#hasher = hasher;
  }

  /** Command line: makes an active member an admin, or changes their password. The person types it themselves. */
  async setPassword(licenceNumber: string, password: string): Promise<SetAdminPasswordResult> {
    const archer = await this.#archers.findByLicenceNumber(licenceNumber.trim().toUpperCase());
    if (!archer?.isActive) return { ok: false, reason: 'unknown_member' };
    if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return { ok: false, reason: 'password_too_short' };
    const created = (await this.#admins.find(archer.licenceNumber)) === null;
    await this.#archers.savePasswordHash(archer.licenceNumber, await this.#hasher.hash(password));
    await this.#admins.save(archer.licenceNumber, { mustChangePassword: false });
    return { ok: true, created };
  }

  /**
   * Panel. A member who already has a password keeps it. Otherwise the server generates one, shown once to the admin
   * who grants the rights; the new admin must replace it at first sign-in to the panel, so the one who granted the
   * rights never knows the password in use.
   */
  async grant(licenceNumber: string): Promise<GrantAdminResult> {
    const archer = await this.#archers.findByLicenceNumber(licenceNumber);
    if (!archer) return { ok: false, reason: 'not_found' };
    if (!archer.isActive) return { ok: false, reason: 'member_inactive' };
    if (await this.#admins.find(archer.licenceNumber)) return { ok: false, reason: 'already_admin' };
    if (archer.hasPassword) {
      await this.#admins.save(archer.licenceNumber, { mustChangePassword: false });
      return { ok: true, password: null };
    }
    const password = generatePassword();
    await this.#archers.savePasswordHash(archer.licenceNumber, await this.#hasher.hash(password));
    await this.#admins.save(archer.licenceNumber, { mustChangePassword: true });
    return { ok: true, password };
  }

  /**
   * Panel: an admin cannot remove their own rights (the club would risk having no admin left). The password stays: it
   * is still the member's.
   */
  async revoke(by: Archer, licenceNumber: string): Promise<RevokeAdminResult> {
    if (licenceNumber === by.licenceNumber) return { ok: false, reason: 'cannot_change_self' };
    return (await this.#admins.remove(licenceNumber)) ? { ok: true } : { ok: false, reason: 'not_found' };
  }

  async isAdmin(licenceNumber: string): Promise<boolean> {
    return (await this.#admins.find(licenceNumber)) !== null;
  }

  /** Command line. Their panel closes at once. `false` when the member was not an admin. */
  async remove(licenceNumber: string): Promise<boolean> {
    return this.#admins.remove(licenceNumber.trim().toUpperCase());
  }
}

/** `K7QM-4XPA-9TWE` */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(GENERATED_GROUPS * GENERATED_GROUP_LENGTH));
  const characters = [...bytes].map((value) => GENERATED_ALPHABET[value % GENERATED_ALPHABET.length]);
  const groups: string[] = [];
  for (let start = 0; start < characters.length; start += GENERATED_GROUP_LENGTH) {
    groups.push(characters.slice(start, start + GENERATED_GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}
