import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type {
  CompetitionDto,
  ListCompetitionRegistrantsResponse,
  ListMyRegistrationsResponse,
  RegistrationCreatedResponse,
  SessionResponse,
} from '@inscript-carte/shared';
import type { Knex } from 'knex';

import { createApp } from './app.ts';
import { createDatabase } from './infrastructure/database/connection.ts';

// Made-up members and competitions. Today is 6 Oct 2026; club deadlines are 15 days before the start.
const ADULT = { licenceNumber: '0123456A', birthDate: '1980-05-12' };
const YOUTH = { licenceNumber: '7654321B', birthDate: '2012-03-03' };
const DEPARTED = { licenceNumber: '1111111C', birthDate: '1975-01-01' };
const SALLE = '90001'; // starts 2027-01-09, deadline 2026-12-25
const EXTERIEUR = '90002'; // starts 2027-05-01
const SOON = '90003'; // starts 2026-10-20, deadline 2026-10-05: already closed

let database: Knex;
let server: ReturnType<typeof Bun.serve>;
const clock = { day: '2026-10-06', today: () => clock.day, now: () => new Date(`${clock.day}T10:00:00Z`) };

function competitionRow(ffta_id: string, discipline: string, start_date: string) {
  return {
    ffta_id,
    title: `Concours ${ffta_id}`,
    discipline,
    start_date,
    end_date: start_date,
    organizer_club: 'Club',
    town: 'Nantes',
    department_code: '44',
  };
}

function archerRow({ licenceNumber, birthDate }: typeof ADULT, full_name: string, is_active = true) {
  return { licence_number: licenceNumber, birth_date: birthDate, full_name, sex: 'female', is_active };
}

beforeEach(async () => {
  clock.day = '2026-10-06';
  database = createDatabase(':memory:');
  await database.migrate.latest();
  await database('competitions').insert([
    competitionRow(SALLE, 'salle', '2027-01-09'),
    competitionRow(EXTERIEUR, 'exterieur', '2027-05-01'),
    competitionRow(SOON, 'salle', '2026-10-20'),
  ]);
  await database('archers').insert([
    archerRow(ADULT, 'DUPONT JEANNE'),
    archerRow(YOUTH, 'MARTIN LOU'),
    archerRow(DEPARTED, 'ANCIEN MEMBRE', false),
  ]);
  server = Bun.serve({ port: 0, routes: createApp(database, clock), fetch: () => new Response(null, { status: 404 }) });
});

afterEach(async () => {
  await server.stop(true);
  await database.destroy();
});

function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return fetch(new URL(path, server.url), {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function signIn(member: typeof ADULT): Promise<string> {
  const response = await call('/api/session', { method: 'POST', body: member });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

/** The usual case: the same bow on every départ. */
const form = ({
  departures = [1],
  bowType = 'classique',
  ...rest
}: { departures?: number[]; bowType?: string; [field: string]: unknown } = {}) => ({
  departures: departures.map((departure) => ({ departure, bowType })),
  trispot: false,
  distance: null,
  contact: null,
  ...rest,
});

describe('sign-in', () => {
  test('a member is recognized by licence number and birth date; the session survives until sign-out', async () => {
    const cookie = await signIn({ licenceNumber: ' 0123456a ', birthDate: ADULT.birthDate });

    const session = await call('/api/session', { cookie });
    const body = (await session.json()) as SessionResponse;
    // The birth year is enough for categories: the full birth date never goes back to the browser.
    expect(body).toEqual({
      archer: { licenceNumber: ADULT.licenceNumber, fullName: 'DUPONT JEANNE', sex: 'female', birthYear: 1980 },
    });

    expect((await call('/api/session', { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call('/api/session', { cookie })).status).toBe(401);
  });

  test('wrong birth dates and departed members are refused the same way', async () => {
    for (const member of [
      { ...ADULT, birthDate: '1980-05-13' },
      DEPARTED,
      { licenceNumber: '9999999Z', birthDate: '1990-01-01' },
    ]) {
      const response = await call('/api/session', { method: 'POST', body: member });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'invalid_credentials' });
    }
  });

  test('a member who mistypes many times still gets in', async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      await call('/api/session', {
        method: 'POST',
        body: { ...ADULT, birthDate: `1980-01-${String(attempt).padStart(2, '0')}` },
      });
    }
    expect((await call('/api/session', { method: 'POST', body: ADULT })).status).toBe(200);
  });

  test('after 30 wrong birth dates, even the right one is refused for 15 minutes', async () => {
    for (let attempt = 1; attempt <= 30; attempt++) {
      await call('/api/session', {
        method: 'POST',
        body: { ...ADULT, birthDate: `1980-01-${String(attempt).padStart(2, '0')}` },
      });
    }
    const response = await call('/api/session', { method: 'POST', body: ADULT });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'too_many_attempts' });
  });
});

describe('registration', () => {
  test('needs a signed-in member', async () => {
    expect((await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', body: form() })).status).toBe(401);
    expect((await call(`/api/competitions/${SALLE}/registrations`)).status).toBe(401);
  });

  test('one payment reference per request, the FFTA category, and the public counter', async () => {
    const adult = await signIn(ADULT);
    const youth = await signIn(YOUTH);

    const first = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie: adult,
      body: form({ departures: [2, 1], contact: ' 06 00 00 00 00 ' }),
    });
    expect(first.status).toBe(201);
    expect((await first.json()) as RegistrationCreatedResponse).toEqual({
      departures: [1, 2],
      category: 'S2',
      paymentReference: 'R-0001',
      paymentDeadline: '2026-12-25',
    });

    const second = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie: youth,
      body: form(),
    });
    expect((await second.json()) as RegistrationCreatedResponse).toMatchObject({
      category: 'U18',
      paymentReference: 'R-0002',
    });

    const list = (await (await call('/api/competitions')).json()) as { competitions: CompetitionDto[] };
    expect(list.competitions.find((competition) => competition.id === SALLE)?.clubRegistrationCount).toBe(3);
  });

  test('refuses invalid départs, a missing distance for Extérieur, and a distance elsewhere', async () => {
    const cookie = await signIn(ADULT);
    for (const [competition, body] of [
      [SALLE, form({ departures: [] })],
      [SALLE, form({ departures: [7] })],
      [SALLE, form({ departures: [1, 1] })],
      [SALLE, form({ bowType: 'arbalete' })],
      [SALLE, form({ distance: 'nationales' })],
      [EXTERIEUR, form()],
    ] as const) {
      const response = await call(`/api/competitions/${competition}/registrations`, { method: 'POST', cookie, body });
      expect(response.status).toBe(400);
    }
    const exterieur = await call(`/api/competitions/${EXTERIEUR}/registrations`, {
      method: 'POST',
      cookie,
      body: form({ distance: 'internationales' }),
    });
    expect(exterieur.status).toBe(201);
  });

  test('refuses a départ already taken by the same member, but another départ is fine', async () => {
    const cookie = await signIn(ADULT);
    await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie, body: form({ departures: [1] }) });

    const again = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie,
      body: form({ departures: [1, 2] }),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already_registered' });

    const other = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie,
      body: form({ departures: [2] }),
    });
    expect(other.status).toBe(201);
  });

  test('is closed after the club deadline (the deadline day itself is still open)', async () => {
    const cookie = await signIn(ADULT);
    const closed = await call(`/api/competitions/${SOON}/registrations`, { method: 'POST', cookie, body: form() });
    expect(await closed.json()).toEqual({ error: 'registration_closed' });

    clock.day = '2026-12-25';
    expect(
      (await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie, body: form() })).status,
    ).toBe(201);
    clock.day = '2026-12-26';
    expect(
      (
        await call(`/api/competitions/${SALLE}/registrations`, {
          method: 'POST',
          cookie,
          body: form({ departures: [2] }),
        })
      ).status,
    ).toBe(409);
  });

  test('members see who is registered, grouped by archer', async () => {
    const adult = await signIn(ADULT);
    await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie: adult,
      body: form({ departures: [3, 1] }),
    });

    const response = await call(`/api/competitions/${SALLE}/registrations`, { cookie: await signIn(YOUTH) });
    expect((await response.json()) as ListCompetitionRegistrantsResponse).toEqual({
      registrants: [{ fullName: 'DUPONT JEANNE', bowType: 'classique', departures: [1, 3] }],
    });
  });

  test('each départ can have its own bow', async () => {
    const cookie = await signIn(ADULT);
    const created = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie,
      body: {
        ...form(),
        departures: [
          { departure: 2, bowType: 'poulies' },
          { departure: 1, bowType: 'classique' },
        ],
      },
    });
    expect(created.status).toBe(201);

    const mine = (await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse;
    expect(mine.registrations.map(({ departure, bowType }) => [departure, bowType])).toEqual([
      [1, 'classique'],
      [2, 'poulies'],
    ]);
    const response = await call(`/api/competitions/${SALLE}/registrations`, { cookie });
    expect(((await response.json()) as ListCompetitionRegistrantsResponse).registrants).toEqual([
      { fullName: 'DUPONT JEANNE', bowType: 'classique', departures: [1] },
      { fullName: 'DUPONT JEANNE', bowType: 'poulies', departures: [2] },
    ]);
  });
});

async function registerAndList(cookie: string) {
  await call(`/api/competitions/${SALLE}/registrations`, {
    method: 'POST',
    cookie,
    body: form({ departures: [1, 2] }),
  });
  return ((await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse)
    .registrations;
}

describe('withdrawal', () => {
  test('a member withdraws one départ before the deadline; it stays in the list, cancelled, and leaves the counter', async () => {
    const cookie = await signIn(ADULT);
    const [first] = await registerAndList(cookie);
    expect(first).toMatchObject({ departure: 1, status: 'received', paymentStatus: 'to_pay', canWithdraw: true });

    expect((await call(`/api/me/registrations/${first!.id}`, { method: 'DELETE', cookie })).status).toBe(204);

    const after = ((await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse)
      .registrations;
    expect(after[0]).toMatchObject({
      status: 'cancelled',
      clubNote: "Retirée par l'archer le 06/10/2026",
      canWithdraw: false,
    });
    const list = (await (await call('/api/competitions')).json()) as { competitions: CompetitionDto[] };
    expect(list.competitions.find((competition) => competition.id === SALLE)?.clubRegistrationCount).toBe(1);
  });

  test('is refused after the deadline, once the club has sent it, and for someone else', async () => {
    const cookie = await signIn(ADULT);
    const [first, second] = await registerAndList(cookie);

    expect(
      (await call(`/api/me/registrations/${first!.id}`, { method: 'DELETE', cookie: await signIn(YOUTH) })).status,
    ).toBe(404);

    await database('registrations').where({ id: second!.id }).update({ status: 'sent_to_organizer' });
    expect((await call(`/api/me/registrations/${second!.id}`, { method: 'DELETE', cookie })).status).toBe(409);

    clock.day = '2026-12-26';
    const late = await call(`/api/me/registrations/${first!.id}`, { method: 'DELETE', cookie });
    expect(await late.json()).toEqual({ error: 'cannot_withdraw' });
  });
});
