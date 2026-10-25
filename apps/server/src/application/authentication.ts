import { MIN_ADMIN_PASSWORD_LENGTH, MIN_MEMBER_PASSWORD_LENGTH } from '@inscript-carte/shared';

import type { AdminRepository } from '../domain/admin-repository.ts';
import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { Archer } from '../domain/archer.ts';
import type { Clock } from './ports/clock.ts';
import type { LoginAttemptLimiter } from './ports/login-attempt-limiter.ts';
import type { PasswordHasher } from './ports/password-hasher.ts';
import type { SessionStore } from './ports/session-store.ts';

/** « Rester connecté » ticked: the archer types their details once per device. */
const REMEMBERED_SESSION_HOURS = 180 * 24;
/** Not ticked: the cookie goes when the browser closes, and the session ends on the server after 12 hours anyway. */
const BROWSER_SESSION_HOURS = 12;

export type SignInResult =
  | { ok: true; archer: Archer; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid_credentials' | 'too_many_attempts' | 'password_required' | 'wrong_password' };

export type AdminAccess =
  | { ok: true; archer: Archer; mustChangePassword: boolean }
  /** `password_required`: an admin whose session was opened with the birth date alone must sign in again. */
  | { ok: false; reason: 'not_signed_in' | 'not_admin' | 'password_required' };

export type PasswordChangeResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'wrong_password' | 'too_many_attempts' | 'password_too_short' | 'same_password' | 'admin_needs_password';
    };

type PasswordCheck = 'password_required' | 'wrong_password' | 'too_many_attempts' | null;

/**
 * One sign-in for everyone (2026-10-25). A licence number is public, so the birth date is the secret; a member may add
 * a password (optional), then asked after the birth date. An admin always has one, the same: their site session,
 * opened with it, opens the panel too. No second step, no admin session.
 */
export class Authentication {
  readonly #archers: ArcherRepository;
  readonly #admins: AdminRepository;
  readonly #sessions: SessionStore;
  readonly #limiter: LoginAttemptLimiter;
  /** Stricter than the birth-date one: a chosen password is not mistyped as often as a date. */
  readonly #passwordLimiter: LoginAttemptLimiter;
  readonly #hasher: PasswordHasher;
  readonly #clock: Clock;

  constructor(
    archers: ArcherRepository,
    admins: AdminRepository,
    sessions: SessionStore,
    limiter: LoginAttemptLimiter,
    passwordLimiter: LoginAttemptLimiter,
    hasher: PasswordHasher,
    clock: Clock,
  ) {
    this.#archers = archers;
    this.#admins = admins;
    this.#sessions = sessions;
    this.#limiter = limiter;
    this.#passwordLimiter = passwordLimiter;
    this.#hasher = hasher;
    this.#clock = clock;
  }

  async signIn(
    licenceNumber: string,
    birthDate: string,
    password: string | null,
    clientAddress: string,
    remember: boolean,
  ): Promise<SignInResult> {
    const now = this.#clock.now();
    const licence = licenceNumber.replace(/\s/g, '').toUpperCase();
    const keys = [`licence:${licence}`, `address:${clientAddress}`];
    if (this.#limiter.isBlocked(keys, now)) return { ok: false, reason: 'too_many_attempts' };

    const archer = await this.#archers.findByLicenceNumber(licence);
    // Unknown, departed and wrong-birth-date sign-ins all look the same, so nothing leaks about who is a member.
    if (!archer?.isActive || archer.birthDate !== birthDate) {
      this.#limiter.recordFailure(keys, now);
      return { ok: false, reason: 'invalid_credentials' };
    }
    if (archer.hasPassword) {
      const checked = await this.#checkPassword(archer, password, clientAddress, now);
      if (checked) return { ok: false, reason: checked };
    }

    this.#limiter.clear(`licence:${licence}`);
    const hours = remember ? REMEMBERED_SESSION_HOURS : BROWSER_SESSION_HOURS;
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const token = await this.#sessions.create(archer.licenceNumber, expiresAt, now, archer.hasPassword);
    return { ok: true, archer, token, expiresAt };
  }

  /** `null` when signed out, expired, or no longer an active member. */
  async signedInArcher(token: string | null): Promise<Archer | null> {
    const session = token ? await this.#sessions.find(token, this.#clock.now()) : null;
    const archer = session ? await this.#archers.findByLicenceNumber(session.archerLicenceNumber) : null;
    return archer?.isActive ? archer : null;
  }

  /** Checked on every admin request: removing an admin, or the member leaving the club, ends the access at once. */
  async adminAccess(token: string | null): Promise<AdminAccess> {
    const session = token ? await this.#sessions.find(token, this.#clock.now()) : null;
    const archer = session ? await this.#archers.findByLicenceNumber(session.archerLicenceNumber) : null;
    if (!session || !archer?.isActive) return { ok: false, reason: 'not_signed_in' };
    const account = await this.#admins.find(archer.licenceNumber);
    if (!account) return { ok: false, reason: 'not_admin' };
    if (!session.openedWithPassword) return { ok: false, reason: 'password_required' };
    return { ok: true, archer, mustChangePassword: account.mustChangePassword };
  }

  /**
   * Adds the password, or changes it. The current one is asked again (a session left open on a shared device is not
   * enough), except to replace a generated admin password right after signing in with it. An admin's must be as long
   * as `MIN_ADMIN_PASSWORD_LENGTH`. The archer's other devices are signed out: someone who knew only the birth date,
   * or the old password, loses access.
   */
  async changePassword(
    archer: Archer,
    sessionToken: string,
    currentPassword: string | null,
    newPassword: string,
    clientAddress: string,
  ): Promise<PasswordChangeResult> {
    const now = this.#clock.now();
    const [account, session] = await Promise.all([
      this.#admins.find(archer.licenceNumber),
      this.#sessions.find(sessionToken, now),
    ]);
    const replacingGenerated = account?.mustChangePassword === true && session?.openedWithPassword === true;
    if (archer.hasPassword && !replacingGenerated) {
      const checked = await this.#checkPassword(archer, currentPassword, clientAddress, now);
      if (checked) return { ok: false, reason: checked === 'too_many_attempts' ? checked : 'wrong_password' };
    }
    const minLength = account ? MIN_ADMIN_PASSWORD_LENGTH : MIN_MEMBER_PASSWORD_LENGTH;
    if (newPassword.length < minLength) return { ok: false, reason: 'password_too_short' };
    const hash = await this.#archers.passwordHash(archer.licenceNumber);
    // Keeping the generated one, above all, would defeat the change.
    if (hash !== null && (await this.#hasher.verify(newPassword, hash))) return { ok: false, reason: 'same_password' };

    await this.#archers.savePasswordHash(archer.licenceNumber, await this.#hasher.hash(newPassword));
    if (account) await this.#admins.save(archer.licenceNumber, { mustChangePassword: false });
    await this.#sessions.deleteOthers(archer.licenceNumber, sessionToken);
    // A first password is not proof: the session was opened with the birth date alone.
    if (archer.hasPassword) await this.#sessions.markOpenedWithPassword(sessionToken);
    return { ok: true };
  }

  /** Back to the birth date alone; the current password is asked again. Never an admin's: the panel needs it. */
  async removePassword(archer: Archer, currentPassword: string, clientAddress: string): Promise<PasswordChangeResult> {
    if (!archer.hasPassword) return { ok: true };
    if (await this.#admins.find(archer.licenceNumber)) return { ok: false, reason: 'admin_needs_password' };
    const checked = await this.#checkPassword(archer, currentPassword, clientAddress, this.#clock.now());
    if (checked) return { ok: false, reason: checked === 'too_many_attempts' ? checked : 'wrong_password' };
    await this.#archers.savePasswordHash(archer.licenceNumber, null);
    return { ok: true };
  }

  async signOut(token: string | null): Promise<void> {
    if (token) await this.#sessions.delete(token);
  }

  /** `null` when the password is right. */
  async #checkPassword(
    archer: Archer,
    password: string | null,
    clientAddress: string,
    now: Date,
  ): Promise<PasswordCheck> {
    const keys = [`licence:${archer.licenceNumber}`, `address:${clientAddress}`];
    if (this.#passwordLimiter.isBlocked(keys, now)) return 'too_many_attempts';
    if (password === null) return 'password_required';
    const hash = await this.#archers.passwordHash(archer.licenceNumber);
    if (hash === null || !(await this.#hasher.verify(password, hash))) {
      this.#passwordLimiter.recordFailure(keys, now);
      return 'wrong_password';
    }
    this.#passwordLimiter.clear(`licence:${archer.licenceNumber}`);
    return null;
  }
}
