import { describe, expect, test } from 'bun:test';

import { DEPARTMENT_NAMES } from './departments.ts';
import { REGIONS } from './regions.ts';

describe('REGIONS', () => {
  // A département missing here would vanish from the grouped menu; one in two regions would show twice.
  test('puts every known département in exactly one region', () => {
    const grouped = REGIONS.flatMap((region) => region.departments);
    expect(grouped.toSorted()).toEqual(Object.keys(DEPARTMENT_NAMES).toSorted());
  });
});
