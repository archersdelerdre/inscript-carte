export interface SessionStore {
  /** Returns the secret token to give to the device. */
  create(archerLicenceNumber: string, expiresAt: Date): Promise<string>;
  /** The archer of a valid, unexpired session. */
  findLicenceNumber(token: string, now: Date): Promise<string | null>;
  delete(token: string): Promise<void>;
}
