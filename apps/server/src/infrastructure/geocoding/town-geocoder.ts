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

/** « NÎMES - FRANCE », « HAUCOURT ST CHARLES 54860 »: the country or postal code some organizers add to the town. */
export function cleanPlaceName(text: string): string {
  return text
    .replace(/\s*-\s*france\s*$/i, '')
    .replace(/\s+\d{5}\s*$/, '')
    .trim();
}

/**
 * The commune's name says the same thing: equal for a one-word name (« ay » is not Fontaine-sur-Ay), else every word
 * starting one of the commune's words (« lyon 8 » in Lyon 8e Arrondissement, « beaujeu et quitteur » in
 * Beaujeu-Saint-Vallier-Pierrejux-et-Quitteur).
 */
function namesCommune(commune: string, name: string): boolean {
  const communeName = normalize(commune);
  const nameWords = name.split(' ');
  if (nameWords.length === 1) return communeName === name;
  const communeWords = communeName.split(' ');
  return nameWords.every((word) => communeWords.some((communeWord) => communeWord.startsWith(word)));
}

/**
 * The commune of a postal line (« 85440 GROSBREUIL »). Each name is tried with that postal code, the postal line's
 * commune first, then the competition's town (« LA SOURCE », 45100: the town says « ORLÉANS »):
 * 1. a commune that name names (« ST ANDRE » is read « saint andre », « LYON 08 » « lyon 8 », merged communes);
 * 2. an address whose commune or former commune has that name (« AY » is now Aÿ-Champagne, « PERLES » Les
 *    Septvallons). A name shorter than the service accepts is sent with the postal code (« ay 51160 »).
 * The service's fuzzy matches are never taken: for « ay 51160 » it gives only Fontaine-sur-Ay, a neighbour, with a
 * better score than right answers get. Nothing that fits gives `null` (the caller falls back to the town in its
 * département). Seen on the first runs, 2026-10-09: 53 of 1 814 found nothing with the commune and code alone.
 */
export async function geocodeCommune(postalCode: string, names: readonly string[]): Promise<GeocodedTown | null> {
  const tried = new Set<string>();
  for (const text of names) {
    const name = normalize(cleanPlaceName(text)).replace(/\b0+(\d)/g, '$1');
    if (!name || tried.has(name)) continue;
    tried.add(name);
    const query = name.length < 3 ? `${name} ${postalCode}` : name;
    const ofPostcode = (features: Feature[]) =>
      features.filter((feature) => feature.properties.postcode === postalCode);

    const communes = ofPostcode(await search(query, 'municipality', postalCode));
    const commune = communes.find((feature) => namesCommune(feature.properties.name, name));
    if (commune) return found(commune);

    const formerCommune = ofPostcode(await search(query, undefined, postalCode)).find((feature) =>
      [feature.properties.city, feature.properties.oldcity].some((place) => place && normalize(place) === name),
    );
    if (formerCommune) return found(formerCommune);
  }
  return null;
}

function found(feature: Feature): GeocodedTown {
  const [longitude, latitude] = feature.geometry.coordinates;
  return { latitude, longitude, matchedPlace: feature.properties.label };
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

/**
 * The service allows 50 requests per second per address and answers 429 beyond (seen with 4 lookups at a time,
 * 2026-10-09): requests start at least this far apart, from every caller of this module.
 */
const SPACING_MS = 60;
/** Waits before trying again after a 429 or a 5xx (the service also times out with 504 when busy). */
const RETRY_DELAYS_MS = [1000, 3000, 8000];
let nextSlot = 0;

async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + SPACING_MS;
  if (slot > now) await Bun.sleep(slot - now);
}

async function search(query: string, type?: 'municipality', postcode?: string): Promise<Feature[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '20');
  if (type) url.searchParams.set('type', type);
  if (postcode) url.searchParams.set('postcode', postcode);
  for (let attempt = 0; ; attempt++) {
    await waitForSlot();
    const response = await fetch(url);
    if (response.ok) return ((await response.json()) as { features: Feature[] }).features;
    const retryable = response.status === 429 || response.status >= 500;
    const delay = RETRY_DELAYS_MS[attempt];
    if (!retryable || delay === undefined) {
      throw new Error(`Geocoding "${query}" failed: HTTP ${response.status}`);
    }
    await Bun.sleep(delay);
  }
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
