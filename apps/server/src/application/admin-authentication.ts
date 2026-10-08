import { MIN_ADMIN_PASSWORD_LENGTH } from '@inscript-carte/shared';

import type { AdminRepository } from '../domain/admin-repository.ts';
import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { Archer } from '../domain/archer.ts';
import type { Clock } from './ports/clock.ts';
import type { LoginAttemptLimiter } from './ports/login-attempt-limiter.ts';
import type { PasswordHasher } from './ports/password-hasher.ts';
import type { SessionStore } from './ports/session-store.ts';

/**
 * One year (the user's choice, 2026-10-09): the secretary types the password once per device. Removing an admin, or
 * the member leaving the club, still ends the session at once.
 */
const ADMIN_SESSION_DAYS = 365;

export type AdminSignInResult =
  | { ok: true; token: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; reason: 'not_admin' | 'invalid_credentials' | 'too_many_attempts' };

export type SignedInAdmin = { archer: Archer; mustChangePassword: boolean };

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials' | 'too_many_attempts' | 'password_too_short' | 'invalid_request' };

/**
 * The second step after the member sign-in: a birth date can be guessed, so the panel also asks for the admin's
 * personal password.
 */
export class AdminAuthentication {
  readonly #archers: ArcherRepository;
  readonly #admins: AdminRepository;
  readonly #sessions: SessionStore;
  readonly #hasher: PasswordHasher;
  readonly #limiter: LoginAttemptLimiter;
  readonly #clock: Clock;

  constructor(
    archers: ArcherRepository,
    admins: AdminRepository,
    sessions: SessionStore,
    hasher: PasswordHasher,
    limiter: LoginAttemptLimiter,
    clock: Clock,
  ) {
    this.#archers = archers;
    this.#admins = admins;
    this.#sessions = sessions;
    this.#hasher = hasher;
    this.#limiter = limiter;
    this.#clock = clock;
  }

  /** `member` is the archer of a valid member session. */
  async signIn(member: Archer, password: string, clientAddress: string): Promise<AdminSignInResult> {
    const now = this.#clock.now();
    const keys = [`licence:${member.licenceNumber}`, `address:${clientAddress}`];
    if (this.#limiter.isBlocked(keys, now)) return { ok: false, reason: 'too_many_attempts' };

    const account = await this.#admins.find(member.licenceNumber);
    if (!account) return { ok: false, reason: 'not_admin' };
    if (!(await this.#hasher.verify(password, account.passwordHash))) {
      this.#limiter.recordFailure(keys, now);
      return { ok: false, reason: 'invalid_credentials' };
    }

    this.#limiter.clear(`licence:${member.licenceNumber}`);
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000);
    const token = await this.#sessions.create(member.licenceNumber, expiresAt, now);
    return { ok: true, token, expiresAt, mustChangePassword: account.mustChangePassword };
  }

  /** `null` when signed out, expired, no longer an admin (sessions end with it) or no longer an active member. */
  async signedInAdmin(token: string | null): Promise<SignedInAdmin | null> {
    if (!token) return null;
    const licence = await this.#sessions.findLicenceNumber(token, this.#clock.now());
    if (!licence) return null;
    const [archer, account] = await Promise.all([
      this.#archers.findByLicenceNumber(licence),
      this.#admins.find(licence),
    ]);
    return archer?.isActive && account ? { archer, mustChangePassword: account.mustChangePassword } : null;
  }

  /**
   * A voluntary change asks for the current password again: a session left open on a shared computer is not enough.
   * The forced change after a generated password does not: that session was opened with it moments ago and can do
   * nothing else, so `currentPassword` is `null` then.
   */
  async changePassword(
    admin: Archer,
    currentPassword: string | null,
    newPassword: string,
    clientAddress: string,
  ): Promise<ChangePasswordResult> {
    const now = this.#clock.now();
    const keys = [`licence:${admin.licenceNumber}`, `address:${clientAddress}`];
    if (this.#limiter.isBlocked(keys, now)) return { ok: false, reason: 'too_many_attempts' };
    const account = await this.#admins.find(admin.licenceNumber);
    if (!account) return { ok: false, reason: 'invalid_credentials' };
    if (!account.mustChangePassword) {
      if (currentPassword === null || !(await this.#hasher.verify(currentPassword, account.passwordHash))) {
        this.#limiter.recordFailure(keys, now);
        return { ok: false, reason: 'invalid_credentials' };
      }
    }
    if (newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) return { ok: false, reason: 'password_too_short' };
    // Keeping the same password (the generated one, above all) would defeat the change.
    if (await this.#hasher.verify(newPassword, account.passwordHash)) return { ok: false, reason: 'invalid_request' };
    await this.#admins.save(admin.licenceNumber, {
      passwordHash: await this.#hasher.hash(newPassword),
      mustChangePassword: false,
    });
    return { ok: true };
  }

  async signOut(token: string | null): Promise<void> {
    if (token) await this.#sessions.delete(token);
  }
}
