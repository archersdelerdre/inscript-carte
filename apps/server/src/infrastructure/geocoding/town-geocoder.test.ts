import { afterEach, expect, mock, test } from 'bun:test';

import { geocodeTown } from './town-geocoder.ts';

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
