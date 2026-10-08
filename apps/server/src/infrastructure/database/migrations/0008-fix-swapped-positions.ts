import type { Knex } from 'knex';

import { checkDepartmentPosition } from '../../../domain/department-area.ts';

/**
 * Data fix for points stored before the scraper checked them (Grosbreuil, Vendée, sat next to Mogadishu): a point
 * outside its département is swapped back when that fits. Otherwise it is cleared (hidden from the public) and its
 * fingerprint dropped, so the next run reads its detail page again and locates it. Never undone: those were wrong.
 */
export async function up(knex: Knex): Promise<void> {
  const rows: { ffta_id: string; department_code: string; latitude: number; longitude: number }[] = await knex(
    'competitions',
  )
    .whereNotNull('latitude')
    .whereNotNull('longitude')
    .select('ffta_id', 'department_code', 'latitude', 'longitude');
  for (const row of rows) {
    const checked = checkDepartmentPosition({ latitude: row.latitude, longitude: row.longitude }, row.department_code);
    if (checked && !checked.swapped) continue;
    await knex('competitions')
      .where({ ffta_id: row.ffta_id })
      .update(
        checked
          ? { latitude: checked.position.latitude, longitude: checked.position.longitude }
          : { latitude: null, longitude: null, list_fingerprint: null },
      );
  }
}

export async function down(): Promise<void> {}
