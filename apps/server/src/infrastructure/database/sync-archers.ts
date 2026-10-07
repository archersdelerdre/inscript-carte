import type { Knex } from 'knex';

import type { Archer } from '../../domain/archer.ts';

type ArcherRow = {
  licence_number: string;
  full_name: string;
  sex: Archer['sex'];
  birth_date: string;
  is_active: 0 | 1;
};

export type ArcherSyncResult = {
  added: number;
  updated: number;
  /** Members missing from the new export: they left the club and can no longer sign in. */
  deactivated: number;
  unchanged: number;
};

/**
 * Makes the `archers` table match a full member export, in one transaction. Members are never deleted:
 * their past registrations point to them.
 */
export async function syncArchers(database: Knex, archers: Archer[]): Promise<ArcherSyncResult> {
  return database.transaction(async (transaction) => {
    const existing = new Map(
      (
        await transaction<ArcherRow>('archers').select('licence_number', 'full_name', 'sex', 'birth_date', 'is_active')
      ).map((row) => [row.licence_number, row]),
    );

    const added = archers.filter((archer) => !existing.has(archer.licenceNumber));
    const updated = archers.filter((archer) => {
      const row = existing.get(archer.licenceNumber);
      return (
        row !== undefined &&
        (row.full_name !== archer.fullName ||
          row.sex !== archer.sex ||
          row.birth_date !== archer.birthDate ||
          Boolean(row.is_active) !== archer.isActive)
      );
    });
    const changed = [...added, ...updated];
    for (let start = 0; start < changed.length; start += 200) {
      await transaction('archers')
        .insert(
          changed.slice(start, start + 200).map((archer) => ({
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

    const inExport = new Set(archers.map((archer) => archer.licenceNumber));
    const departed = [...existing.values()]
      .filter((row) => row.is_active && !inExport.has(row.licence_number))
      .map((row) => row.licence_number);
    if (departed.length > 0) {
      await transaction('archers')
        .whereIn('licence_number', departed)
        .update({ is_active: false, updated_at: transaction.fn.now() });
    }

    return {
      added: added.length,
      updated: updated.length,
      deactivated: departed.length,
      unchanged: archers.length - changed.length,
    };
  });
}
