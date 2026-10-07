import type { Archer } from './archer.ts';

export interface ArcherRepository {
  findByLicenceNumber(licenceNumber: string): Promise<Archer | null>;
}
