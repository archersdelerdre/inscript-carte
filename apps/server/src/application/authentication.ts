import type { ArcherRepository } from '../domain/archer-repository.ts';
import type { Archer } from '../domain/archer.ts';
import type { Clock } from './ports/clock.ts';
import type { LoginAttemptLimiter } from './ports/login-attempt-limiter.ts';
import type { SessionStore } from './ports/session-store.ts';

/** Archers type their details once per device: "never ask twice". */
const SESSION_DAYS = 180;

export type SignInResult =
  | { ok: true; archer: Archer; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid_credentials' | 'too_many_attempts' };

/** A licence number is public, so the birth date is the secret: sign-ins are recognized against the member list. */
export class Authentication {
  readonly #archers: ArcherRepository;
  readonly #sessions: SessionStore;
  readonly #limiter: LoginAttemptLimiter;
  readonly #clock: Clock;

  constructor(archers: ArcherRepository, sessions: SessionStore, limiter: LoginAttemptLimiter, clock: Clock) {
    this.#archers = archers;
    this.#sessions = sessions;
    this.#limiter = limiter;
    this.#clock = clock;
  }

  async signIn(licenceNumber: string, birthDate: string, clientAddress: string): Promise<SignInResult> {
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

    this.#limiter.clear(`licence:${licence}`);
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const token = await this.#sessions.create(archer.licenceNumber, expiresAt);
    return { ok: true, archer, token, expiresAt };
  }

  /** `null` when signed out, expired, or no longer an active member. */
  async signedInArcher(token: string | null): Promise<Archer | null> {
    if (!token) return null;
    const licence = await this.#sessions.findLicenceNumber(token, this.#clock.now());
    const archer = licence ? await this.#archers.findByLicenceNumber(licence) : null;
    return archer?.isActive ? archer : null;
  }

  async signOut(token: string | null): Promise<void> {
    if (token) await this.#sessions.delete(token);
  }
}
