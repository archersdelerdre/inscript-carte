import type { Archer, ArcherContact } from './archer.ts';

export interface ArcherRepository {
  findByLicenceNumber(licenceNumber: string): Promise<Archer | null>;
  /** Both `null` for an unknown member or when nothing was stored. */
  contactOf(licenceNumber: string): Promise<ArcherContact>;
}
