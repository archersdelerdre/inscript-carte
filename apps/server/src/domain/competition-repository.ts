import type { Competition } from './competition.ts';

export interface CompetitionRepository {
  findAll(): Promise<Competition[]>;
  findById(id: string): Promise<Competition | null>;
}
