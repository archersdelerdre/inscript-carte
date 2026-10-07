/** Counts failed sign-ins per key (a licence number, a network address) to stop birth-date guessing. */
export interface LoginAttemptLimiter {
  isBlocked(keys: readonly string[], now: Date): boolean;
  recordFailure(keys: readonly string[], now: Date): void;
  clear(key: string): void;
}
