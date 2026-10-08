import { DEPARTMENT_NAMES, REGIONS, type Region } from '@inscript-carte/shared';

/**
 * The place filter, remembered on the device: all of France, one département code ("44"), or a whole region
 * ("region:pays-de-la-loire", like the FFTA website lets you pick a region above its départements).
 */
export const ALL_FRANCE = 'all';
const REGION_PREFIX = 'region:';

export function regionArea(region: Region): string {
  return `${REGION_PREFIX}${region.id}`;
}

function regionOf(area: string): Region | undefined {
  if (!area.startsWith(REGION_PREFIX)) return undefined;
  const id = area.slice(REGION_PREFIX.length);
  return REGIONS.find((region) => region.id === id);
}

/** The départements the area keeps; `null` for all of France. */
export function areaDepartments(area: string): ReadonlySet<string> | null {
  if (area === ALL_FRANCE) return null;
  return new Set(regionOf(area)?.departments ?? [area]);
}

export function areaName(area: string): string {
  if (area === ALL_FRANCE) return 'France';
  return regionOf(area)?.name ?? DEPARTMENT_NAMES[area] ?? area;
}

/** Still offered: a département with competitions, or a region with at least one of them. */
export function isOfferedArea(area: string, departmentCodes: readonly string[]): boolean {
  const region = regionOf(area);
  if (region) return region.departments.some((code) => departmentCodes.includes(code));
  return departmentCodes.includes(area);
}

export type DepartmentGroup = { region: Region | null; departments: string[] };

/** The menu: each region with its départements that have competitions; codes no region knows come last. */
export function groupDepartments(departmentCodes: readonly string[]): DepartmentGroup[] {
  const groups: DepartmentGroup[] = REGIONS.map((region) => ({
    region,
    departments: region.departments.filter((code) => departmentCodes.includes(code)),
  }));
  const known = new Set(REGIONS.flatMap((region) => region.departments));
  groups.push({ region: null, departments: departmentCodes.filter((code) => !known.has(code)) });
  return groups.filter((group) => group.departments.length > 0);
}
