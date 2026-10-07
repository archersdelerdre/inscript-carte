import type { AdminRepository } from '../domain/admin-repository.ts';
import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { Archer } from '../domain/archer.ts';
import type { Clock } from './ports/clock.ts';
import type { LoginAttemptLimiter } from './ports/login-attempt-limiter.ts';
import type { PasswordHasher } from './ports/password-hasher.ts';
import type { SessionStore } from './ports/session-store.ts';

/** Short: the panel shows every member's registrations and contacts. */
const ADMIN_SESSION_HOURS = 12;

export type AdminSignInResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: 'not_admin' | 'invalid_credentials' | 'too_many_attempts' };

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

    const passwordHash = await this.#admins.findPasswordHash(member.licenceNumber);
    if (!passwordHash) return { ok: false, reason: 'not_admin' };
    if (!(await this.#hasher.verify(password, passwordHash))) {
      this.#limiter.recordFailure(keys, now);
      return { ok: false, reason: 'invalid_credentials' };
    }

    this.#limiter.clear(`licence:${member.licenceNumber}`);
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_HOURS * 60 * 60 * 1000);
    const token = await this.#sessions.create(member.licenceNumber, expiresAt);
    return { ok: true, token, expiresAt };
  }

  /** `null` when signed out, expired, no longer an admin (sessions end with it) or no longer an active member. */
  async signedInAdmin(token: string | null): Promise<Archer | null> {
    if (!token) return null;
    const licence = await this.#sessions.findLicenceNumber(token, this.#clock.now());
    const archer = licence ? await this.#archers.findByLicenceNumber(licence) : null;
    return archer?.isActive ? archer : null;
  }

  async signOut(token: string | null): Promise<void> {
    if (token) await this.#sessions.delete(token);
  }
}
