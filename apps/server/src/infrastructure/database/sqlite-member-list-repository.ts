import type { Knex } from 'knex';

import type { Archer } from '../../domain/archer.ts';
import type {
  MemberImport,
  MemberListRepository,
  MemberListSummary,
  MemberListSync,
} from '../../domain/member-list.ts';

type ArcherRow = {
  licence_number: string;
  full_name: string;
  sex: Archer['sex'];
  birth_date: string;
  is_active: 0 | 1;
};

/** SQLite limits the number of values in one statement. */
const BATCH_SIZE = 200;

export class SqliteMemberListRepository implements MemberListRepository {
  readonly #database: Knex;

  constructor(database: Knex) {
    this.#database = database;
  }

  async sync(
    plan: (current: readonly Archer[]) => MemberListSync,
    importedBy: string | null,
  ): Promise<MemberListSummary> {
    return this.#database.transaction(async (transaction) => {
      const { toSave, toDeactivate, memberCount, summary } = plan(await readArchers(transaction));

      for (let start = 0; start < toSave.length; start += BATCH_SIZE) {
        await transaction('archers')
          .insert(
            toSave.slice(start, start + BATCH_SIZE).map((archer) => ({
              licence_number: archer.licenceNumber,
              full_name: archer.fullName,
              sex: archer.sex,
              birth_date: archer.birthDate,
              is_active: archer.isActive,
              updated_at: transaction.fn.now(),
            })),
          )
          .onConflict('licence_number')
          .merge();
      }
      for (let start = 0; start < toDeactivate.length; start += BATCH_SIZE) {
        await transaction('archers')
          .whereIn('licence_number', toDeactivate.slice(start, start + BATCH_SIZE))
          .update({ is_active: false, updated_at: transaction.fn.now() });
      }

      await transaction('member_imports').insert({ imported_by: importedBy, member_count: memberCount, ...summary });
      return summary;
    });
  }

  async lastImport(): Promise<MemberImport | null> {
    const row:
      | {
          imported_at: string;
          imported_by_name: string | null;
          member_count: number;
          added: number;
          updated: number;
          deactivated: number;
          unchanged: number;
        }
      | undefined = await this.#database('member_imports')
      .leftJoin('archers', 'archers.licence_number', 'member_imports.imported_by')
      .orderBy('member_imports.id', 'desc')
      .first('member_imports.*', 'archers.full_name as imported_by_name');
    return row
      ? {
          importedAt: `${row.imported_at.replace(' ', 'T')}Z`,
          importedByName: row.imported_by_name,
          memberCount: row.member_count,
          added: row.added,
          updated: row.updated,
          deactivated: row.deactivated,
          unchanged: row.unchanged,
        }
      : null;
  }

  async countActive(): Promise<number> {
    const row = (await this.#database('archers').where({ is_active: true }).count({ count: '*' }).first()) as {
      count: number;
    };
    return Number(row.count);
  }

  async all(): Promise<Archer[]> {
    return readArchers(this.#database);
  }
}

async function readArchers(database: Knex | Knex.Transaction): Promise<Archer[]> {
  const rows = await database<ArcherRow>('archers').select(
    'licence_number',
    'full_name',
    'sex',
    'birth_date',
    'is_active',
  );
  return rows.map((row) => ({
    licenceNumber: row.licence_number,
    fullName: row.full_name,
    sex: row.sex,
    birthDate: row.birth_date,
    isActive: row.is_active === 1,
  }));
}
