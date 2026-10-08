import { afterEach, describe, expect, mock, test } from 'bun:test';

import { cleanPlaceName, geocodeCommune, geocodeTown } from './town-geocoder.ts';

type FakeFeature = {
  name: string;
  context: string;
  coordinates: [longitude: number, latitude: number];
  score?: number;
  city?: string;
  oldcity?: string;
  postcode?: string;
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Fakes the address service: `municipality` answers typed searches, `any` answers free-text ones. */
function fakeService(results: { municipality?: FakeFeature[]; any?: FakeFeature[] }) {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const features = (url.searchParams.get('type') === 'municipality' ? results.municipality : results.any) ?? [];
    return Response.json({
      features: features.map(({ coordinates, score = 0.9, ...properties }) => ({
        geometry: { coordinates },
        properties: { label: properties.name, score, ...properties },
      })),
    });
  }) as unknown as typeof fetch;
}

test('rejects a street that only contains the text, then gives up', async () => {
  fakeService({
    any: [{ name: "Rue d'Occitanie", context: '30, Gard', city: 'Sommières', coordinates: [4.09, 43.78], score: 0.7 }],
  });
  expect(await geocodeTown('Occitanie', '30')).toBeNull();
});

test('accepts a free-text match in a merged commune named by the text', async () => {
  fakeService({
    any: [
      {
        name: 'Rue de Saint-Pern',
        context: '49, Maine-et-Loire',
        city: 'Mauges-sur-Loire',
        oldcity: 'St Florent-le-Vieil',
        coordinates: [-1.02, 47.36],
        score: 0.53,
      },
    ],
  });
  expect(await geocodeTown('Saint Florent le Vieil', '49')).toMatchObject({ latitude: 47.36, longitude: -1.02 });
});

test('accepts a town outside the département only when its name is unique in France', async () => {
  fakeService({
    municipality: [{ name: 'Rennes', context: '35, Ille-et-Vilaine', coordinates: [-1.68, 48.11] }],
  });
  expect(await geocodeTown('Rennes', '22')).toMatchObject({ latitude: 48.11, longitude: -1.68 });

  fakeService({
    municipality: [
      { name: 'Saint-Martin', context: '65, Hautes-Pyrénées', coordinates: [0.1, 43.2] },
      { name: 'Saint-Martin', context: '32, Gers', coordinates: [0.3, 43.6] },
    ],
  });
  expect(await geocodeTown('Saint Martin', '44')).toBeNull();
});

test('places Saint-Martin listed under Guadeloupe (971) in the 978 collectivity', async () => {
  fakeService({
    municipality: [
      { name: 'Saint-Martin', context: '978, Saint-Martin', coordinates: [-63.08, 18.07] },
      { name: 'Saint-Martin', context: '65, Hautes-Pyrénées', coordinates: [0.1, 43.2] },
    ],
  });
  expect(await geocodeTown('Saint Martin', '971')).toMatchObject({ latitude: 18.07, longitude: -63.08 });
});

test('uses GPS coordinates typed as the town without calling the service', async () => {
  fakeService({});
  expect(await geocodeTown('48.016301075707354, 7.383550512345017', '68')).toMatchObject({
    latitude: 48.016301075707354,
    longitude: 7.383550512345017,
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

describe('geocodeCommune: the postal line « 85440 GROSBREUIL »', () => {
  test('takes the commune of that name and postal code, abbreviations and arrondissements included', async () => {
    fakeService({
      municipality: [
        { name: 'Lyon 8e Arrondissement', context: '69, Rhône', postcode: '69008', coordinates: [4.87, 45.73] },
      ],
    });
    expect(await geocodeCommune('69008', ['LYON 08'])).toMatchObject({ latitude: 45.73 });

    fakeService({
      municipality: [
        { name: 'Saint-André', context: '974, La Réunion', postcode: '97440', coordinates: [55.64, -20.96] },
      ],
    });
    expect(await geocodeCommune('97440', ['ST ANDRE'])).toMatchObject({ latitude: -20.96 });
  });

  test('never takes a neighbour the service offers for a name it does not have', async () => {
    // For « ay 51160 » the service answers only Fontaine-sur-Ay, with a good score: Ay is now Aÿ-Champagne.
    fakeService({
      municipality: [
        { name: 'Fontaine-sur-Ay', context: '51, Marne', postcode: '51160', coordinates: [4.07, 49.08], score: 0.66 },
      ],
      any: [
        {
          name: "Route d'Avenay",
          context: '51, Marne',
          postcode: '51160',
          city: 'Aÿ-Champagne',
          oldcity: 'Ay',
          coordinates: [4.01, 49.05],
        },
      ],
    });
    expect(await geocodeCommune('51160', ['AY'])).toMatchObject({ latitude: 49.05, longitude: 4.01 });

    fakeService({
      municipality: [
        { name: 'Fontaine-sur-Ay', context: '51, Marne', postcode: '51160', coordinates: [4.07, 49.08], score: 0.66 },
      ],
    });
    expect(await geocodeCommune('51160', ['AY'])).toBeNull();
  });

  test('tries the competition’s town when the postal line names a district', async () => {
    fakeService({
      municipality: [{ name: 'Orléans', context: '45, Loiret', postcode: '45100', coordinates: [1.91, 47.9] }],
    });
    expect(await geocodeCommune('45100', ['LA SOURCE', 'ORLÉANS'])).toMatchObject({ latitude: 47.9 });
    expect(await geocodeCommune('45100', ['LA SOURCE'])).toBeNull();
  });

  test('takes a merged commune whose name holds every word, but only with that postal code', async () => {
    const merged = {
      name: 'Beaujeu-Saint-Vallier-Pierrejux-et-Quitteur',
      context: '70, Haute-Saône',
      coordinates: [5.67, 47.51] as [number, number],
    };
    fakeService({ municipality: [{ ...merged, postcode: '70100' }] });
    expect(await geocodeCommune('70100', ['BEAUJEU ET QUITTEUR'])).toMatchObject({ latitude: 47.51 });
    fakeService({ municipality: [{ ...merged, postcode: '70130' }] });
    expect(await geocodeCommune('70100', ['BEAUJEU ET QUITTEUR'])).toBeNull();
  });
});

test('cleans the country or postal code some organizers add to the town', () => {
  expect(cleanPlaceName('NÎMES - FRANCE')).toBe('NÎMES');
  expect(cleanPlaceName('HAUCOURT ST CHARLES 54860')).toBe('HAUCOURT ST CHARLES');
  expect(cleanPlaceName('SAINT HERBLAIN')).toBe('SAINT HERBLAIN');
});
