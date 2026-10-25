export type Session = {
  readonly archerLicenceNumber: string;
  /** The password was checked when it was opened (or typed again since): an admin's session then opens the panel. */
  readonly openedWithPassword: boolean;
};

export interface SessionStore {
  /** Returns the secret token to give to the device. Sessions expired at `now` are cleaned up. */
  create(archerLicenceNumber: string, expiresAt: Date, now: Date, openedWithPassword: boolean): Promise<string>;
  /** A valid, unexpired session. */
  find(token: string, now: Date): Promise<Session | null>;
  /** After the archer typed their current password again (a password change). */
  markOpenedWithPassword(token: string): Promise<void>;
  delete(token: string): Promise<void>;
  /** Every session of the archer except `keepToken`'s: the other devices are signed out. */
  deleteOthers(archerLicenceNumber: string, keepToken: string): Promise<void>;
}
