export interface SessionStore {
  /** Returns the secret token to give to the device. Sessions expired at `now` are cleaned up. */
  create(archerLicenceNumber: string, expiresAt: Date, now: Date): Promise<string>;
  /** The archer of a valid, unexpired session. */
  findLicenceNumber(token: string, now: Date): Promise<string | null>;
  delete(token: string): Promise<void>;
}
