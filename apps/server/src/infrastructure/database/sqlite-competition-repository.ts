import type { Discipline } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { CompetitionRepository } from '../../domain/competition-repository.ts';
import type { Competition, CompetitionStatus } from '../../domain/competition.ts';

type CompetitionRow = {
  ffta_id: string;
  title: string;
  discipline: Discipline;
  status: CompetitionStatus;
  has_para_tir: 0 | 1;
  start_date: string;
  end_date: string;
  organizer_club: string | null;
  town: string;
  department_code: string;
  latitude: number | null;
  longitude: number | null;
  mandate_url: string | null;
};

const COLUMNS: (keyof CompetitionRow)[] = [
  'ffta_id',
  'title',
  'discipline',
  'status',
  'has_para_tir',
  'start_date',
  'end_date',
  'organizer_club',
  'town',
  'department_code',
  'latitude',
  'longitude',
  'mandate_url',
];

export class SqliteCompetitionRepository implements CompetitionRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async findAll(): Promise<Competition[]> {
    const rows = await this.#database<CompetitionRow>('competitions').select(COLUMNS);
    return rows.map(toCompetition);
  }

  async findById(id: string): Promise<Competition | null> {
    const row = await this.#database<CompetitionRow>('competitions').where({ ffta_id: id }).first(COLUMNS);
    return row ? toCompetition(row) : null;
  }
}

function toCompetition(row: CompetitionRow): Competition {
  return {
    id: row.ffta_id,
    title: row.title,
    discipline: row.discipline,
    status: row.status,
    hasParaTir: row.has_para_tir === 1,
    startDate: row.start_date,
    endDate: row.end_date,
    organizerClub: row.organizer_club,
    town: row.town,
    departmentCode: row.department_code,
    position:
      row.latitude === null || row.longitude === null ? null : { latitude: row.latitude, longitude: row.longitude },
    mandateUrl: row.mandate_url,
  };
}
