import type { GeoPosition } from '@inscript-carte/shared';

type Area = { south: number; north: number; west: number; east: number };

/** Mainland France and Corsica, with a small margin. */
const METROPOLE: Area = { south: 41.2, north: 51.2, west: -5.3, east: 9.7 };

/** Overseas départements and collectivities; 971 takes 977/978 too (Saint-Barthélemy, Saint-Martin). */
const OVERSEAS: Record<string, Area> = {
  '971': { south: 15.8, north: 18.2, west: -63.2, east: -60.9 },
  '972': { south: 14.3, north: 14.95, west: -61.3, east: -60.75 },
  '973': { south: 2.0, north: 5.9, west: -54.7, east: -51.5 },
  '974': { south: -21.45, north: -20.8, west: 55.15, east: 55.9 },
  '975': { south: 46.7, north: 47.2, west: -56.5, east: -56.05 },
  '976': { south: -13.05, north: -12.55, west: 44.9, east: 45.35 },
  '977': { south: 17.85, north: 17.98, west: -62.95, east: -62.75 },
  '978': { south: 18.0, north: 18.15, west: -63.2, east: -62.95 },
  '986': { south: -14.4, north: -13.1, west: -178.3, east: -176.1 },
  '987': { south: -28.0, north: -7.0, west: -155.0, east: -134.0 },
  '988': { south: -23.0, north: -19.0, west: 163.0, east: 169.0 },
};

function areaOf(departmentCode: string): Area | undefined {
  return departmentCode.startsWith('97') || departmentCode.startsWith('98') ? OVERSEAS[departmentCode] : METROPOLE;
}

function inside({ latitude, longitude }: GeoPosition, area: Area): boolean {
  return latitude >= area.south && latitude <= area.north && longitude >= area.west && longitude <= area.east;
}

export type CheckedPosition = { position: GeoPosition; swapped: boolean } | null;

/**
 * A map point the FFTA gives, checked against the competition's département: organizers type it in, and some swap
 * latitude and longitude (Grosbreuil, Vendée, came out next to Mogadishu, 2026-10-08). Kept when inside, swapped
 * back when only the swapped point is, `null` when neither is (the address service is used instead). An unknown
 * overseas code is trusted as is.
 */
export function checkDepartmentPosition(position: GeoPosition, departmentCode: string): CheckedPosition {
  const area = areaOf(departmentCode);
  if (!area || inside(position, area)) return { position, swapped: false };
  const swapped = { latitude: position.longitude, longitude: position.latitude };
  return inside(swapped, area) ? { position: swapped, swapped: true } : null;
}
