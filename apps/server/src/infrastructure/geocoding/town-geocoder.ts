import type { GeoPosition } from '@inscript-carte/shared';

import { KNOWN_PLACES } from './known-places.ts';

/** French national address service (Géoplateforme, formerly api-adresse.data.gouv.fr). */
const SEARCH_URL = 'https://data.geopf.fr/geocodage/search';
const MIN_SCORE = 0.5;
/** The FFTA lists Saint-Barthélemy (977) and Saint-Martin (978) under Guadeloupe. */
const DEPARTMENTS_BY_FFTA_CODE: Record<string, string[]> = { '971': ['971', '977', '978'] };
const COORDINATES = /^(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)$/;

type Feature = {
  geometry: { coordinates: [longitude: number, latitude: number] };
  properties: {
    label: string;
    name: string;
    /** Starts with the département code: "977, Saint-Barthélemy". `depcode` says "97" for 977/978. */
    context: string;
    score: number;
    postcode?: string;
    city?: string;
    /** Former commune, for communes merged into a "commune nouvelle". */
    oldcity?: string;
  };
};

export type GeocodedTown = GeoPosition & { matchedPlace: string };

/**
 * Finds where a competition takes place from the FFTA "town" text, which may also be a venue,
 * a merged commune, a postal code, or a town just across the organizer's département border.
 */
export async function geocodeTown(town: string, departmentCode: string): Promise<GeocodedTown | null> {
  const known = KNOWN_PLACES[`${departmentCode}|${town}`];
  if (known)
    return { latitude: known.latitude, longitude: known.longitude, matchedPlace: `${known.place} (known place)` };

  const query = town.trim();
  const coordinates = COORDINATES.exec(query);
  if (coordinates) {
    return { latitude: Number(coordinates[1]), longitude: Number(coordinates[2]), matchedPlace: 'GPS coordinates' };
  }
  // The service rejects shorter queries and ones not starting with a letter or digit.
  if (query.length < 3 || !/^[\p{L}\d]/u.test(query)) return null;

  const departments = DEPARTMENTS_BY_FFTA_CODE[departmentCode] ?? [departmentCode];
  const isInDepartment = (feature: Feature) =>
    departments.includes(feature.properties.context.split(',')[0] ?? '') && feature.properties.score >= MIN_SCORE;

  const municipalities = await search(query, 'municipality');
  const match =
    municipalities.find(isInDepartment) ??
    (await search(query)).find((feature) => isInDepartment(feature) && namesItsPlace(query, feature)) ??
    uniqueNamesake(municipalities, query);
  if (!match) return null;

  const [longitude, latitude] = match.geometry.coordinates;
  return { latitude, longitude, matchedPlace: match.properties.label };
}

/**
 * A free-text match is kept only if the text names the result's commune (or former commune),
 * or is its postal code: "Rue d'Occitanie" in Sommières is not a match for "Occitanie".
 */
function namesItsPlace(query: string, feature: Feature): boolean {
  const { city, oldcity, postcode } = feature.properties;
  const queryWords = ` ${normalize(query)} `;
  return (
    query === postcode ||
    [city, oldcity].some((place) => {
      const placeWords = place && ` ${normalize(place)} `;
      return placeWords && (queryWords.includes(placeWords) || placeWords.includes(queryWords));
    })
  );
}

async function search(query: string, type?: 'municipality'): Promise<Feature[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '20');
  if (type) url.searchParams.set('type', type);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoding "${query}" failed: HTTP ${response.status}`);
  const body = (await response.json()) as { features: Feature[] };
  return body.features;
}

/** A town outside the département is trusted only when no other French commune has the same name. */
function uniqueNamesake(municipalities: Feature[], query: string): Feature | undefined {
  const namesakes = municipalities.filter((feature) => normalize(feature.properties.name) === normalize(query));
  return namesakes.length === 1 ? namesakes[0] : undefined;
}

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte');
}
