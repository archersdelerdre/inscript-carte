/** Admins are club members with a personal password. */
export interface AdminRepository {
  /** `null` when this member is not an admin. */
  findPasswordHash(archerLicenceNumber: string): Promise<string | null>;
  /** Makes the member an admin, or changes their password. */
  save(archerLicenceNumber: string, passwordHash: string): Promise<void>;
  /** Also ends their admin sessions. `false` when the member was not an admin. */
  remove(archerLicenceNumber: string): Promise<boolean>;
}
