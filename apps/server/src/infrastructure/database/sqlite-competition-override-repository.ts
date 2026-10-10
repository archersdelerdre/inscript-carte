import type { CompetitionFields, Discipline, MandateData } from '@inscript-carte/shared';
import type { Knex } from 'knex';

import type { CalendarDate } from '../../domain/calendar-date.ts';
import type {
  CompetitionOverrideRepository,
  EditableCompetition,
} from '../../domain/competition-override-repository.ts';
import type { CompetitionOverrides } from '../../domain/competition-overrides.ts';
import type { CompetitionStatus } from '../../domain/competition.ts';

type Row = {
  title: string;
  start_date: string;
  end_date: string;
  discipline: Discipline;
  status: CompetitionStatus;
  has_para_tir: 0 | 1;
  has_foam_targets: 0 | 1;
  mandate_url: string | null;
  town: string;
  department_code: string;
  latitude: number | null;
  longitude: number | null;
  organizer_club: string | null;
  organizer_email: string | null;
  organizer_phone: string | null;
  organizer_website: string | null;
  championship: string | null;
  has_duels: 0 | 1 | null;
  regional_committee: string | null;
  departmental_committee: string | null;
  venue: string | null;
  street_lines: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  mandate_data: string | null;
};

type OverrideRow = {
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  discipline: Discipline | null;
  status: CompetitionStatus | null;
  has_para_tir: 0 | 1 | null;
  has_foam_targets: 0 | 1 | null;
  mandate_url: string | null;
  mandate_added_on: string | null;
  town: string | null;
  department_code: string | null;
  latitude: number | null;
  longitude: number | null;
  departures: string | null;
  prices: string | null;
  updated_at: string;
  updated_by_name: string;
};

const flag = (value: 0 | 1 | null): boolean | undefined => (value === null ? undefined : value === 1);

export class SqliteCompetitionOverrideRepository implements CompetitionOverrideRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async editable(competitionId: string): Promise<EditableCompetition | null> {
    const row: Row | undefined = await this.#database('competitions as c')
      // The reading of the FFTA's own link: what the competition says without any edit.
      .leftJoin('competition_mandates as m', (join) =>
        join.on('m.ffta_id', 'c.ffta_id').andOn('m.mandate_url', 'c.mandate_url').andOnVal('m.status', 'parsed'),
      )
      .where('c.ffta_id', competitionId)
      .first('c.*', 'm.data as mandate_data');
    if (!row) return null;
    const edit: OverrideRow | undefined = await this.#database('competition_overrides as o')
      .join('archers as a', 'a.licence_number', 'o.updated_by')
      .where('o.ffta_id', competitionId)
      .first('o.*', 'a.full_name as updated_by_name');

    const mandate = row.mandate_data ? (JSON.parse(row.mandate_data) as MandateData) : null;
    const ffta: CompetitionFields = {
      title: row.title,
      startDate: row.start_date,
      endDate: row.end_date,
      discipline: row.discipline,
      status: row.status,
      hasParaTir: row.has_para_tir === 1,
      hasFoamTargets: row.has_foam_targets === 1,
      mandateUrl: row.mandate_url,
      town: row.town,
      departmentCode: row.department_code,
      position:
        row.latitude === null || row.longitude === null ? null : { latitude: row.latitude, longitude: row.longitude },
      departures: mandate?.departures.length ? mandate.departures : null,
      prices: mandate?.prices.length ? mandate.prices : null,
    };
    return {
      ffta,
      overrides: edit ? overridesOf(edit) : {},
      overrideMandateAddedOn: edit?.mandate_added_on ?? null,
      details: {
        organizerClub: row.organizer_club,
        organizerEmail: row.organizer_email,
        organizerPhone: row.organizer_phone,
        organizerWebsite: row.organizer_website,
        championship: row.championship,
        hasDuels: row.has_duels === null ? null : row.has_duels === 1,
        regionalCommittee: row.regional_committee,
        departmentalCommittee: row.departmental_committee,
        venue: row.venue,
        streetLines: row.street_lines ? row.street_lines.split('\n') : [],
        postalCode: row.postal_code,
        city: row.city,
        country: row.country,
      },
      updatedByName: edit?.updated_by_name ?? null,
      updatedAt: edit?.updated_at ?? null,
    };
  }

  async save(
    competitionId: string,
    overrides: CompetitionOverrides,
    mandateAddedOn: CalendarDate | null,
    updatedBy: string,
  ): Promise<void> {
    if (Object.keys(overrides).length === 0) {
      await this.#database('competition_overrides').where({ ffta_id: competitionId }).delete();
      return;
    }
    const row = {
      ffta_id: competitionId,
      title: overrides.title ?? null,
      start_date: overrides.startDate ?? null,
      end_date: overrides.endDate ?? null,
      discipline: overrides.discipline ?? null,
      status: overrides.status ?? null,
      has_para_tir: overrides.hasParaTir ?? null,
      has_foam_targets: overrides.hasFoamTargets ?? null,
      mandate_url: overrides.mandateUrl ?? null,
      mandate_added_on: mandateAddedOn,
      town: overrides.town ?? null,
      department_code: overrides.departmentCode ?? null,
      latitude: overrides.position?.latitude ?? null,
      longitude: overrides.position?.longitude ?? null,
      departures: overrides.departures ? JSON.stringify(overrides.departures) : null,
      prices: overrides.prices ? JSON.stringify(overrides.prices) : null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    };
    await this.#database('competition_overrides').insert(row).onConflict('ffta_id').merge();
  }

  async editedIds(): Promise<Set<string>> {
    const rows: { ffta_id: string }[] = await this.#database('competition_overrides').select('ffta_id');
    return new Set(rows.map((row) => row.ffta_id));
  }
}

function overridesOf(row: OverrideRow): CompetitionOverrides {
  const overrides: CompetitionOverrides = {
    title: row.title ?? undefined,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    discipline: row.discipline ?? undefined,
    status: row.status ?? undefined,
    hasParaTir: flag(row.has_para_tir),
    hasFoamTargets: flag(row.has_foam_targets),
    mandateUrl: row.mandate_url ?? undefined,
    town: row.town ?? undefined,
    departmentCode: row.department_code ?? undefined,
    position:
      row.latitude === null || row.longitude === null
        ? undefined
        : { latitude: row.latitude, longitude: row.longitude },
    departures: row.departures ? JSON.parse(row.departures) : undefined,
    prices: row.prices ? JSON.parse(row.prices) : undefined,
  };
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
}
