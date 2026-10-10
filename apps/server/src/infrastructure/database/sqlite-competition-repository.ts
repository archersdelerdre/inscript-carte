import type { Discipline, MandateData } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { CompetitionRepository } from '../../domain/competition-repository.ts';
import type { Competition, CompetitionStatus } from '../../domain/competition.ts';

type CompetitionRow = {
  ffta_id: string;
  title: string;
  discipline: Discipline;
  status: CompetitionStatus;
  has_para_tir: 0 | 1;
  has_foam_targets: 0 | 1;
  start_date: string;
  end_date: string;
  organizer_club: string | null;
  town: string;
  department_code: string;
  latitude: number | null;
  longitude: number | null;
  mandate_url: string | null;
  mandate_added_on: string | null;
  missing_since: string | null;
  /** `competition_mandates.data` of a `parsed` reading. */
  mandate_data: string | null;
};

const COLUMNS = [
  'c.ffta_id',
  'c.title',
  'c.discipline',
  'c.status',
  'c.has_para_tir',
  'c.has_foam_targets',
  'c.start_date',
  'c.end_date',
  'c.organizer_club',
  'c.town',
  'c.department_code',
  'c.latitude',
  'c.longitude',
  'c.mandate_url',
  'c.mandate_added_on',
  'c.missing_since',
  'm.data as mandate_data',
];

export class SqliteCompetitionRepository implements CompetitionRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async findAll(): Promise<Competition[]> {
    const rows: CompetitionRow[] = await this.#query();
    return rows.map(toCompetition);
  }

  async findById(id: string): Promise<Competition | null> {
    const row: CompetitionRow | undefined = await this.#query().where('c.ffta_id', id).first();
    return row ? toCompetition(row) : null;
  }

  /** Only a reading that passed the checks, and only for the mandate link the competition has now. */
  #query() {
    return this.#database('competitions as c')
      .leftJoin('competition_mandates as m', (join) =>
        join.on('m.ffta_id', 'c.ffta_id').andOn('m.mandate_url', 'c.mandate_url').andOnVal('m.status', 'parsed'),
      )
      .select(COLUMNS);
  }
}

function toCompetition(row: CompetitionRow): Competition {
  // Stored only after `checkMandateData`.
  const mandate = row.mandate_data ? (JSON.parse(row.mandate_data) as MandateData) : null;
  return {
    id: row.ffta_id,
    title: row.title,
    discipline: row.discipline,
    status: row.status,
    hasParaTir: row.has_para_tir === 1,
    hasFoamTargets: row.has_foam_targets === 1,
    startDate: row.start_date,
    endDate: row.end_date,
    organizerClub: row.organizer_club,
    town: row.town,
    departmentCode: row.department_code,
    position:
      row.latitude === null || row.longitude === null ? null : { latitude: row.latitude, longitude: row.longitude },
    mandateUrl: row.mandate_url,
    mandateAddedOn: row.mandate_added_on,
    departures: mandate?.departures.length ? mandate.departures : null,
    prices: mandate?.prices.length ? mandate.prices : null,
    missingSince: row.missing_since,
  };
}
