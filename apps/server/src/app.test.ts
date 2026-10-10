import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type {
  AdminCompetitionRegistrationsResponse,
  AdminSessionResponse,
  CompetitionDto,
  GrantAdminResponse,
  ListAdminCompetitionsResponse,
  ListAdminMembersResponse,
  ListCompetitionRegistrantsResponse,
  ListCompetitionsResponse,
  ListMyRegistrationsResponse,
  MemberExportErrorResponse,
  MemberImportResponse,
  MemberImportStatusResponse,
  RegistrationCreatedResponse,
  ScraperBusyResponse,
  ScraperStatusResponse,
  SessionResponse,
  StartScraperRunResponse,
} from '@inscript-carte/shared';
import type { Knex } from 'knex';
import { readSheet } from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

import { createApp } from './app.ts';
import { ScraperRuns } from './application/scraper-runs.ts';
import { createDatabase } from './infrastructure/database/connection.ts';
import { SqliteScraperRunStore } from './infrastructure/database/sqlite-scraper-run-store.ts';

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
/** The scraper runs the server asked to start: no process is launched in tests. */
let launched: number[];

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
    // The public list leaves out competitions without a place.
    latitude: 47.21,
    longitude: -1.55,
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
  launched = [];
  const scraperRuns = new ScraperRuns(
    new SqliteScraperRunStore(database),
    { launch: (id) => launched.push(id) },
    clock,
  );
  server = Bun.serve({
    port: 0,
    routes: createApp(database, clock, scraperRuns),
    fetch: () => new Response(null, { status: 404 }),
  });
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
  carpool: false,
  distance: null,
  contact: null,
  paymentMethod: 'cheque',
  ...rest,
});

describe('sign-in', () => {
  test('a member is recognized by licence number and birth date; the session survives until sign-out', async () => {
    const cookie = await signIn({ licenceNumber: ' 0123456a ', birthDate: ADULT.birthDate });

    const session = await call('/api/session', { cookie });
    const body = (await session.json()) as SessionResponse;
    // The birth year is enough for categories: the full birth date never goes back to the browser.
    expect(body).toEqual({
      archer: {
        licenceNumber: ADULT.licenceNumber,
        fullName: 'DUPONT JEANNE',
        sex: 'female',
        birthYear: 1980,
        isAdmin: false,
      },
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

  test('one payment reference per archer and competition, the FFTA category, and the public counter', async () => {
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

    // Two archers, three départs: the public counter counts archers.
    const list = (await (await call('/api/competitions')).json()) as { competitions: CompetitionDto[] };
    expect(list.competitions.find((competition) => competition.id === SALLE)?.clubArcherCount).toBe(2);
  });

  test('a later request on the same competition keeps the reference, even after a withdrawal', async () => {
    const cookie = await signIn(ADULT);
    const register = async (competitionId: string, departures: number[], extra: Record<string, unknown> = {}) =>
      (
        (await (
          await call(`/api/competitions/${competitionId}/registrations`, {
            method: 'POST',
            cookie,
            body: form({ departures, ...extra }),
          })
        ).json()) as RegistrationCreatedResponse
      ).paymentReference;

    expect(await register(SALLE, [1])).toBe('R-0001');
    const [first] = ((await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse)
      .registrations;
    await call(`/api/me/registrations/${first!.id}`, { method: 'DELETE', cookie });

    expect(await register(SALLE, [2], { paymentMethod: 'transfer' })).toBe('R-0001');
    expect(await register(SALLE, [3])).toBe('R-0001');
    // Another competition is another payment.
    expect(await register(EXTERIEUR, [1], { distance: 'nationales' })).toBe('R-0002');
  });

  test('refuses invalid départs, a missing or unknown payment method, and wrong distances', async () => {
    const cookie = await signIn(ADULT);
    for (const [competition, body] of [
      [SALLE, form({ departures: [] })],
      // Mandate not read: 1 to 4.
      [SALLE, form({ departures: [5] })],
      [SALLE, form({ departures: [1, 1] })],
      [SALLE, form({ bowType: 'arbalete' })],
      [SALLE, form({ distance: 'nationales' })],
      [SALLE, form({ paymentMethod: null })],
      [SALLE, form({ paymentMethod: 'carte' })],
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

  test('offers and accepts only the départs of the mandate, once a reading of its current link passed the checks', async () => {
    const cookie = await signIn(ADULT);
    const reading = (mandateUrl: string, status: string) => ({
      ffta_id: SALLE,
      mandate_url: mandateUrl,
      status,
      data: JSON.stringify({
        departures: [mandateDeparture('Matin'), mandateDeparture('Après-midi')],
        prices: [],
        foamTargets: 'not_mentioned',
        evidence: { departures: null, prices: null, foamTargets: null },
      }),
      read_at: new Date().toISOString(),
    });
    const offered = async () =>
      ((await (await call('/api/competitions')).json()) as { competitions: CompetitionDto[] }).competitions.find(
        (competition) => competition.id === SALLE,
      )?.departures;
    const registerOn = async (departures: number[]) =>
      (
        await call(`/api/competitions/${SALLE}/registrations`, {
          method: 'POST',
          cookie,
          body: form({ departures }),
        })
      ).status;

    await database('competitions')
      .where({ ffta_id: SALLE })
      .update({ mandate_url: 'https://extranet.ffta.fr/new.pdf' });
    // A reading of an older mandate, or one the checks refused, is not used: 1 to 4 as before.
    await database('competition_mandates').insert(reading('https://extranet.ffta.fr/old.pdf', 'parsed'));
    expect(await offered()).toBeNull();
    await database('competition_mandates').update(reading('https://extranet.ffta.fr/new.pdf', 'invalid'));
    expect(await offered()).toBeNull();

    await database('competition_mandates').update({ status: 'parsed' });
    expect((await offered())?.map(({ label }) => label)).toEqual(['Matin', 'Après-midi']);
    expect(await registerOn([3])).toBe(400);
    expect(await registerOn([1, 2])).toBe(201);
    const mine = ((await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse)
      .registrations;
    expect(mine.map((row) => [row.departure, row.mandateDeparture?.label])).toEqual([
      [1, 'Matin'],
      [2, 'Après-midi'],
    ]);
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
      registrants: [{ fullName: 'DUPONT JEANNE', bowType: 'classique', departures: [1, 3], carpool: false }],
    });
  });

  test('covoiturage is one answer per archer and competition: the latest request sets it on every départ', async () => {
    const adult = await signIn(ADULT);
    const register = (body: unknown) =>
      call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie: adult, body });
    const registrants = async () => {
      const response = await call(`/api/competitions/${SALLE}/registrations`, { cookie: await signIn(YOUTH) });
      return ((await response.json()) as ListCompetitionRegistrantsResponse).registrants;
    };
    const mine = async () => {
      const response = await call('/api/me/registrations', { cookie: adult });
      const { registrations } = (await response.json()) as ListMyRegistrationsResponse;
      return registrations.map(({ departure, carpool }) => [departure, carpool]);
    };

    await register(form());
    // A later request for another départ, with another bow, says yes: départ 1 says yes too.
    await register(form({ departures: [2], bowType: 'poulies', carpool: true }));
    expect(await registrants()).toEqual([
      { fullName: 'DUPONT JEANNE', bowType: 'classique', departures: [1], carpool: true },
      { fullName: 'DUPONT JEANNE', bowType: 'poulies', departures: [2], carpool: true },
    ]);
    expect(await mine()).toEqual([
      [1, true],
      [2, true],
    ]);

    // Unticked on a third départ: no more covoiturage on any of them.
    await register(form({ departures: [3], carpool: false }));
    expect(await mine()).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);

    expect((await register(form({ departures: [4], carpool: 'oui' }))).status).toBe(400);
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
      { fullName: 'DUPONT JEANNE', bowType: 'classique', departures: [1], carpool: false },
      { fullName: 'DUPONT JEANNE', bowType: 'poulies', departures: [2], carpool: false },
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
  test('a withdrawn départ leaves "Mon suivi" but stays in the database, cancelled', async () => {
    const cookie = await signIn(ADULT);
    const [first] = await registerAndList(cookie);
    expect(first).toMatchObject({
      departure: 1,
      status: 'received',
      paymentStatus: 'to_pay',
      paymentMethod: 'cheque',
      canWithdraw: true,
    });

    expect((await call(`/api/me/registrations/${first!.id}`, { method: 'DELETE', cookie })).status).toBe(204);

    const after = ((await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse)
      .registrations;
    expect(after.map(({ departure }) => departure)).toEqual([2]);
    const kept = await database('registrations').where({ id: first!.id }).first();
    expect(kept).toMatchObject({ status: 'cancelled', club_note: "Retirée par l'archer le 06/10/2026" });
    // Still registered on départ 2: still counted, once.
    const counter = async () => {
      const list = (await (await call('/api/competitions')).json()) as ListCompetitionsResponse;
      return list.competitions.find((competition) => competition.id === SALLE)?.clubArcherCount;
    };
    expect(await counter()).toBe(1);
    const [second] = after;
    await call(`/api/me/registrations/${second!.id}`, { method: 'DELETE', cookie });
    expect(await counter()).toBe(0);
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

// The adult member is the admin; the youth is a member without admin rights.
const ADMIN_PASSWORD = 'tir-a-l-arc-2026';

async function makeAdmin(member: typeof ADULT) {
  await database('admins').insert({
    archer_licence_number: member.licenceNumber,
    password_hash: await Bun.password.hash(ADMIN_PASSWORD),
  });
}

async function adminSignIn(): Promise<string> {
  const response = await call('/api/admin/session', {
    method: 'POST',
    cookie: await signIn(ADULT),
    body: { password: ADMIN_PASSWORD },
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

/** The youth registers on départs 1 and 2 (R-0001), the adult on départ 1 (R-0002). */
async function registerBoth() {
  const youth = await signIn(YOUTH);
  await call(`/api/competitions/${SALLE}/registrations`, {
    method: 'POST',
    cookie: youth,
    body: form({ departures: [1, 2], contact: '06 00 00 00 00' }),
  });
  await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie: await signIn(ADULT), body: form() });
}

async function adminRegistrations(cookie: string) {
  const response = await call(`/api/admin/competitions/${SALLE}/registrations`, { cookie });
  return ((await response.json()) as AdminCompetitionRegistrationsResponse).registrations;
}

function upload(cookie: string, file: Blob) {
  const body = new FormData();
  body.set('file', file, 'export.xlsx');
  return fetch(new URL('/api/admin/members/import', server.url), { method: 'POST', headers: { cookie }, body });
}

/** A made-up FFTA member export: the admin and one new member. */
async function memberExport(licenceOfNewMember = '2222222D'): Promise<Blob> {
  const buffer = await writeXlsxFile(
    [
      ['N°', 'Nom, Prénom↑', 'Sexe', 'Date de naissance', 'Etat'],
      [ADULT.licenceNumber, 'Me DUPONT JEANNE', 'Féminin', new Date(`${ADULT.birthDate}T00:00:00Z`), 'Active'],
      [licenceOfNewMember, 'M NOUVEAU PAUL', 'Masculin', new Date('1990-02-02T00:00:00Z'), 'Active'],
    ],
    { dateFormat: 'dd/mm/yyyy' },
  ).toBuffer();
  return new Blob([buffer]);
}

describe('admin sign-in', () => {
  beforeEach(() => makeAdmin(ADULT));

  test('the member session tells an admin that they can open the admin page', async () => {
    const session = (await (await call('/api/session', { cookie: await signIn(ADULT) })).json()) as SessionResponse;
    expect(session.archer.isAdmin).toBe(true);
    const youth = (await (await call('/api/session', { cookie: await signIn(YOUTH) })).json()) as SessionResponse;
    expect(youth.archer.isAdmin).toBe(false);
  });

  test('an admin signs in as a member, then with their password; the session ends at sign-out', async () => {
    const response = await call('/api/admin/session', {
      method: 'POST',
      cookie: await signIn(ADULT),
      body: { password: ADMIN_PASSWORD },
    });
    // Only sent to the admin API, never readable by scripts, never sent from another site.
    expect(response.headers.get('set-cookie')).toMatch(/Path=\/api\/admin.*HttpOnly.*SameSite=Strict/i);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;

    expect((await (await call('/api/admin/session', { cookie })).json()) as AdminSessionResponse).toEqual({
      admin: { licenceNumber: ADULT.licenceNumber, fullName: 'DUPONT JEANNE', mustChangePassword: false },
    });
    expect((await call('/api/admin/session', { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call('/api/admin/competitions', { cookie })).status).toBe(401);
  });

  test('needs the member session first, the right password, and a member who is an admin', async () => {
    const noMember = await call('/api/admin/session', { method: 'POST', body: { password: ADMIN_PASSWORD } });
    expect(await noMember.json()).toEqual({ error: 'not_signed_in' });

    const wrong = await call('/api/admin/session', {
      method: 'POST',
      cookie: await signIn(ADULT),
      body: { password: 'not-the-password' },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'invalid_credentials' });

    const member = await call('/api/admin/session', {
      method: 'POST',
      cookie: await signIn(YOUTH),
      body: { password: ADMIN_PASSWORD },
    });
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({ error: 'not_admin' });
  });

  test('after 10 wrong passwords, even the right one is refused for 15 minutes', async () => {
    const member = await signIn(ADULT);
    for (let attempt = 1; attempt <= 10; attempt++) {
      await call('/api/admin/session', { method: 'POST', cookie: member, body: { password: `wrong-${attempt}` } });
    }
    const blocked = await call('/api/admin/session', {
      method: 'POST',
      cookie: member,
      body: { password: ADMIN_PASSWORD },
    });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
  });

  test('an admin removed from the list, or who left the club, loses access at once', async () => {
    const cookie = await adminSignIn();
    await database('archers').where({ licence_number: ADULT.licenceNumber }).update({ is_active: false });
    expect((await call('/api/admin/competitions', { cookie })).status).toBe(401);

    await database('archers').where({ licence_number: ADULT.licenceNumber }).update({ is_active: true });
    expect((await call('/api/admin/competitions', { cookie })).status).toBe(200);
    await database('admins').delete();
    expect((await call('/api/admin/competitions', { cookie })).status).toBe(401);
  });

  test('visitors and members (even the admin with only a member session) get nothing from the admin API', async () => {
    await registerBoth();
    const routes = [
      ['GET', '/api/admin/session'],
      ['GET', '/api/admin/competitions'],
      ['GET', `/api/admin/competitions/${SALLE}/registrations`],
      ['GET', `/api/admin/competitions/${SALLE}/export`],
      ['PATCH', '/api/admin/registrations/1'],
      ['PATCH', '/api/admin/payment-references/R-0001'],
      ['GET', '/api/admin/members'],
      ['GET', '/api/admin/members/import'],
      ['POST', '/api/admin/members/import'],
      ['PATCH', `/api/admin/members/${YOUTH.licenceNumber}`],
      ['POST', `/api/admin/members/${YOUTH.licenceNumber}/admin`],
      ['DELETE', `/api/admin/members/${YOUTH.licenceNumber}/admin`],
      ['PUT', '/api/admin/session/password'],
    ] as const;
    for (const cookie of [undefined, await signIn(YOUTH), await signIn(ADULT)]) {
      for (const [method, path] of routes) {
        const response = await call(path, {
          method,
          cookie,
          body: method === 'PATCH' ? { status: 'full' } : undefined,
        });
        expect([path, response.status]).toEqual([path, 401]);
        expect(await response.json()).toEqual({ error: 'admin_sign_in_required' });
      }
    }
    expect(await database('registrations').pluck('status')).toEqual(['received', 'received', 'received']);
    expect(await database('admins').pluck('archer_licence_number')).toEqual([ADULT.licenceNumber]);
  });
});

describe('admin registrations', () => {
  let cookie: string;
  beforeEach(async () => {
    await makeAdmin(ADULT);
    cookie = await adminSignIn();
  });

  test('lists competitions with registrations, with counts per status and what is left to pay', async () => {
    await registerBoth();
    await call(`/api/competitions/${EXTERIEUR}/registrations`, {
      method: 'POST',
      cookie: await signIn(ADULT),
      body: form({ distance: 'nationales' }),
    });
    await call('/api/admin/payment-references/R-0002', { method: 'PATCH', cookie, body: { paymentStatus: 'paid' } });

    const { competitions } = (await (
      await call('/api/admin/competitions', { cookie })
    ).json()) as ListAdminCompetitionsResponse;
    expect(competitions.map(({ id, statusCounts, toPayCount }) => [id, statusCounts.received, toPayCount])).toEqual([
      [SALLE, 3, 2],
      [EXTERIEUR, 1, 1],
    ]);
  });

  test('shows every detail of each départ, but never the birth date', async () => {
    await registerBoth();
    const response = await call(`/api/admin/competitions/${SALLE}/registrations`, { cookie });
    const text = await response.text();
    expect(text).not.toContain(YOUTH.birthDate);
    const { registrations } = JSON.parse(text) as AdminCompetitionRegistrationsResponse;
    expect(registrations.map(({ paymentReference, departure }) => [paymentReference, departure])).toEqual([
      ['R-0001', 1],
      ['R-0001', 2],
      ['R-0002', 1],
    ]);
    expect(registrations[0]).toEqual({
      id: expect.any(Number),
      licenceNumber: YOUTH.licenceNumber,
      fullName: 'MARTIN LOU',
      sex: 'female',
      category: 'U18',
      departure: 1,
      departureLabel: null,
      bowType: 'classique',
      trispot: false,
      carpool: false,
      distance: null,
      paymentMethod: 'cheque',
      paymentReference: 'R-0001',
      paymentStatus: 'to_pay',
      status: 'received',
      contact: '06 00 00 00 00',
      clubNote: null,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      updatedByName: null,
    });
  });

  test('changes the status, payment and note of one départ, and remembers which admin did it', async () => {
    await registerBoth();
    const [first] = await adminRegistrations(cookie);

    const response = await call(`/api/admin/registrations/${first!.id}`, {
      method: 'PATCH',
      cookie,
      body: { status: 'sent_to_organizer', paymentStatus: 'paid', clubNote: '  Chèque reçu  ' },
    });
    expect(response.status).toBe(204);

    const [changed, untouched] = await adminRegistrations(cookie);
    expect(changed).toMatchObject({
      status: 'sent_to_organizer',
      paymentStatus: 'paid',
      clubNote: 'Chèque reçu',
      updatedByName: 'DUPONT JEANNE',
    });
    expect(untouched).toMatchObject({ status: 'received', paymentStatus: 'to_pay', updatedByName: null });

    await call(`/api/admin/registrations/${first!.id}`, { method: 'PATCH', cookie, body: { clubNote: '' } });
    expect((await adminRegistrations(cookie))[0]!.clubNote).toBeNull();
  });

  test('a départ can go back to "Reçue" (the archer may withdraw it again), but a cancelled one stays cancelled', async () => {
    await registerBoth();
    const [first] = await adminRegistrations(cookie);
    const patch = (body: unknown) => call(`/api/admin/registrations/${first!.id}`, { method: 'PATCH', cookie, body });

    expect((await patch({ status: 'confirmed' })).status).toBe(204);
    expect((await patch({ status: 'received' })).status).toBe(204);
    const youth = await signIn(YOUTH);
    const mine = (
      (await (await call('/api/me/registrations', { cookie: youth })).json()) as ListMyRegistrationsResponse
    ).registrations;
    expect(mine.find(({ id }) => id === first!.id)?.canWithdraw).toBe(true);

    expect((await patch({ status: 'full' })).status).toBe(204);
    expect((await patch({ status: 'cancelled', clubNote: 'Plus de place' })).status).toBe(204);
    for (const status of ['confirmed', 'received']) {
      const revived = await patch({ status });
      expect(revived.status).toBe(409);
      expect(await revived.json()).toEqual({ error: 'status_change_not_allowed' });
    }

    const row = await database('registrations').where({ id: first!.id }).first();
    expect(row).toMatchObject({
      status: 'cancelled',
      club_note: 'Plus de place\nAnnulée par le club le 06/10/2026',
      cancelled_at: '2026-10-06',
    });
    // The archer can register on that départ again.
    const again = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie: await signIn(YOUTH),
      body: form({ departures: [1] }),
    });
    expect(again.status).toBe(201);
  });

  test('refuses unknown values, too long notes and empty changes', async () => {
    await registerBoth();
    const [first] = await adminRegistrations(cookie);
    for (const body of [
      {},
      { status: 'awaiting_payment' },
      { paymentStatus: 'free' },
      { clubNote: 42 },
      { clubNote: 'x'.repeat(501) },
    ]) {
      const response = await call(`/api/admin/registrations/${first!.id}`, { method: 'PATCH', cookie, body });
      expect([body, response.status]).toEqual([body, 400]);
    }
    const noteOnReference = await call('/api/admin/payment-references/R-0001', {
      method: 'PATCH',
      cookie,
      body: { clubNote: 'Une note' },
    });
    expect(noteOnReference.status).toBe(400);
    expect(
      (await call('/api/admin/registrations/9999', { method: 'PATCH', cookie, body: { status: 'full' } })).status,
    ).toBe(404);
    expect(
      (await call('/api/admin/payment-references/R-9999', { method: 'PATCH', cookie, body: { status: 'full' } }))
        .status,
    ).toBe(404);
  });

  test('changes every départ of one payment reference at once, skipping cancelled ones', async () => {
    await registerBoth();
    const [first] = await adminRegistrations(cookie);
    await call(`/api/admin/registrations/${first!.id}`, { method: 'PATCH', cookie, body: { status: 'cancelled' } });

    const response = await call('/api/admin/payment-references/R-0001', {
      method: 'PATCH',
      cookie,
      body: { status: 'sent_to_organizer', paymentStatus: 'paid' },
    });
    expect(response.status).toBe(204);

    expect(
      (await adminRegistrations(cookie)).map(({ paymentReference, status, paymentStatus }) => [
        paymentReference,
        status,
        paymentStatus,
      ]),
    ).toEqual([
      ['R-0001', 'cancelled', 'nothing_due'],
      ['R-0001', 'sent_to_organizer', 'paid'],
      ['R-0002', 'received', 'to_pay'],
    ]);
  });

  test('the payment follows the status: nothing to pay or to refund when a départ ends, back when it does not', async () => {
    await registerBoth();
    const [first, second] = await adminRegistrations(cookie);
    const counts = async () => {
      const response = await call('/api/admin/competitions', { cookie });
      const { competitions } = (await response.json()) as ListAdminCompetitionsResponse;
      const competition = competitions.find(({ id }) => id === SALLE);
      return [competition?.toPayCount, competition?.toRefundCount];
    };
    const payments = async () => (await adminRegistrations(cookie)).map(({ paymentStatus }) => paymentStatus);
    const patch = (id: number, body: object) =>
      call(`/api/admin/registrations/${id}`, { method: 'PATCH', cookie, body });

    // Not paid, then « Plus de place »: nothing to pay. Marking the whole reference paid leaves it so.
    await patch(first!.id, { status: 'full' });
    expect(await counts()).toEqual([2, 0]);
    await call('/api/admin/payment-references/R-0001', { method: 'PATCH', cookie, body: { paymentStatus: 'paid' } });
    expect(await payments()).toEqual(['nothing_due', 'paid', 'to_pay']);

    // Paid, then « Plus de place »: to refund, until the club says it refunded.
    await patch(second!.id, { status: 'full' });
    expect(await payments()).toEqual(['nothing_due', 'to_refund', 'to_pay']);
    expect(await counts()).toEqual([1, 1]);
    await patch(second!.id, { paymentStatus: 'refunded' });
    expect(await counts()).toEqual([1, 0]);

    // Back to « Reçue »: what is due is due again.
    await patch(first!.id, { status: 'received' });
    expect(await payments()).toEqual(['to_pay', 'refunded', 'to_pay']);
  });

  test('« Tout marquer remboursé » refunds the départs to refund, cancelled ones included, and nothing else', async () => {
    await registerBoth();
    const [first] = await adminRegistrations(cookie);
    const patch = (id: number, body: object) =>
      call(`/api/admin/registrations/${id}`, { method: 'PATCH', cookie, body });
    await call('/api/admin/payment-references/R-0001', { method: 'PATCH', cookie, body: { paymentStatus: 'paid' } });
    await patch(first!.id, { status: 'cancelled' });
    expect((await adminRegistrations(cookie)).map(({ paymentStatus }) => paymentStatus)).toEqual([
      'to_refund',
      'paid',
      'to_pay',
    ]);

    await call('/api/admin/payment-references/R-0001', {
      method: 'PATCH',
      cookie,
      body: { paymentStatus: 'refunded' },
    });
    expect(
      (await adminRegistrations(cookie)).map(({ status, paymentStatus, updatedByName }) => [
        status,
        paymentStatus,
        updatedByName !== null,
      ]),
    ).toEqual([
      ['cancelled', 'refunded', true],
      ['received', 'paid', true],
      ['received', 'to_pay', false],
    ]);
  });

  test('a whole payment reference can go back to "Reçue"', async () => {
    await registerBoth();
    await call('/api/admin/payment-references/R-0001', { method: 'PATCH', cookie, body: { status: 'confirmed' } });

    const response = await call('/api/admin/payment-references/R-0001', {
      method: 'PATCH',
      cookie,
      body: { status: 'received' },
    });
    expect(response.status).toBe(204);
    expect((await adminRegistrations(cookie)).slice(0, 2).map(({ status }) => status)).toEqual([
      'received',
      'received',
    ]);
  });

  test('the archer can no longer withdraw a départ the club has sent', async () => {
    await registerBoth();
    const [first] = await adminRegistrations(cookie);
    await call(`/api/admin/registrations/${first!.id}`, {
      method: 'PATCH',
      cookie,
      body: { status: 'sent_to_organizer' },
    });
    const youth = await signIn(YOUTH);
    const mine = (
      (await (await call('/api/me/registrations', { cookie: youth })).json()) as ListMyRegistrationsResponse
    ).registrations;
    expect(mine.map(({ departure, canWithdraw }) => [departure, canWithdraw])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  test('exports the départs to send to the organizer as an Excel file, without cancelled or refused ones', async () => {
    await registerBoth();
    const [first, second] = await adminRegistrations(cookie);
    await call(`/api/admin/registrations/${first!.id}`, { method: 'PATCH', cookie, body: { status: 'cancelled' } });
    await call(`/api/admin/registrations/${second!.id}`, { method: 'PATCH', cookie, body: { status: 'confirmed' } });

    const response = await call(`/api/admin/competitions/${SALLE}/export`, { cookie });
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="inscriptions-2027-01-09-${SALLE}.xlsx"`,
    );
    const rows = await readSheet(Buffer.from(await response.arrayBuffer()));
    // The admin who exports is the club's contact on the grid, like on the FFTA mandates; no contact stored yet.
    expect(rows.slice(3, 7).map((row) => row.slice(0, 2))).toEqual([
      ['Nom du club :', "Les Archers de l'Erdre"],
      ['Responsable :', 'DUPONT JEANNE'],
      ['Email :', null],
      ['Tél :', null],
    ]);
    // No mandate read: the amounts stay empty rather than wrong.
    expect(rows.slice(8)).toEqual([
      ['NOM Prénom', 'N° licence', 'Catég.', "Type d'arc", 'Départ 1', 'Départ 2', 'Trispot', 'Montant'],
      ['DUPONT JEANNE', ADULT.licenceNumber, 'Senior 2 Femme', 'Classique', 'X', null, 'Non', null],
      ['MARTIN LOU', YOUTH.licenceNumber, 'U18 Femme', 'Classique', null, 'X', 'Non', null],
      ['Total', null, null, null, null, null, null, null],
    ]);

    // The mandate's prices: adult or youth (every Uxx), by number of départs.
    await database('competitions').where({ ffta_id: SALLE }).update({ mandate_url: 'https://extranet.ffta.fr/m.pdf' });
    await database('competition_mandates').insert({
      ffta_id: SALLE,
      mandate_url: 'https://extranet.ffta.fr/m.pdf',
      status: 'parsed',
      data: JSON.stringify({
        departures: [],
        prices: [
          { audience: 'adult', departures: 1, amountEuros: 9 },
          { audience: 'youth', departures: 1, amountEuros: 6.5 },
        ],
        foamTargets: 'not_mentioned',
        evidence: { departures: null, prices: null, foamTargets: null },
      }),
      read_at: new Date().toISOString(),
    });
    const priced = await readSheet(
      Buffer.from(await (await call(`/api/admin/competitions/${SALLE}/export`, { cookie })).arrayBuffer()),
    );
    expect(priced.slice(9).map((row) => row.at(-1))).toEqual([9, 6.5, 15.5]);
  });

  test("the grid shows the exporting admin's stored email and phone", async () => {
    await registerBoth();
    await database('archers')
      .where({ licence_number: ADULT.licenceNumber })
      .update({ email: 'jeanne@example.org', phone: '06 00 00 00 00' });
    const response = await call(`/api/admin/competitions/${SALLE}/export`, { cookie });
    const rows = await readSheet(Buffer.from(await response.arrayBuffer()));
    expect(rows.slice(5, 7).map((row) => row.slice(0, 2))).toEqual([
      ['Email :', 'jeanne@example.org'],
      ['Tél :', '06 00 00 00 00'],
    ]);
  });

  test('one grid line per archer and bow, with a mark in each of their départs', async () => {
    await registerBoth();
    const response = await call(`/api/admin/competitions/${SALLE}/export`, { cookie });
    const [header, ...lines] = (await readSheet(Buffer.from(await response.arrayBuffer()))).slice(8, -1);
    expect(lines.map((line) => [line[0], header!.filter((_, column) => line[column] === 'X')])).toEqual([
      ['DUPONT JEANNE', ['Départ 1']],
      ['MARTIN LOU', ['Départ 1', 'Départ 2']],
    ]);
  });

  test('the export follows the panel filters, for example only the paid départs', async () => {
    await registerBoth();
    const [, second] = await adminRegistrations(cookie);
    await call(`/api/admin/registrations/${second!.id}`, { method: 'PATCH', cookie, body: { status: 'confirmed' } });
    await call('/api/admin/payment-references/R-0002', { method: 'PATCH', cookie, body: { paymentStatus: 'paid' } });
    const exported = async (query: string) => {
      const response = await call(`/api/admin/competitions/${SALLE}/export?${query}`, { cookie });
      const [header, ...lines] = (await readSheet(Buffer.from(await response.arrayBuffer()))).slice(8, -1);
      return lines.flatMap((line) =>
        header!.flatMap((title, column) => (line[column] === 'X' ? [[Number(String(title).slice(-1)), line[0]]] : [])),
      );
    };

    expect(await exported('paymentStatus=paid')).toEqual([[1, 'DUPONT JEANNE']]);
    expect(await exported('paymentStatus=to_pay')).toEqual([
      [1, 'MARTIN LOU'],
      [2, 'MARTIN LOU'],
    ]);
    expect(await exported('status=confirmed')).toEqual([[2, 'MARTIN LOU']]);
    expect(await exported('status=confirmed&paymentStatus=paid')).toEqual([]);
    // Refused départs never go to the organizer, even when asked for.
    expect(await exported('status=full')).toEqual([]);
    expect((await call(`/api/admin/competitions/${SALLE}/export?paymentStatus=free`, { cookie })).status).toBe(400);
  });
});

describe('member list', () => {
  let cookie: string;
  beforeEach(async () => {
    await makeAdmin(ADULT);
    cookie = await adminSignIn();
  });

  test('admins see every member, those who left included, with the category of the season but no birth date', async () => {
    const response = await call('/api/admin/members', { cookie });
    const text = await response.text();
    for (const member of [ADULT, YOUTH, DEPARTED]) expect(text).not.toContain(member.birthDate);
    expect((JSON.parse(text) as ListAdminMembersResponse).members).toEqual([
      {
        licenceNumber: DEPARTED.licenceNumber,
        fullName: 'ANCIEN MEMBRE',
        sex: 'female',
        category: 'S2',
        isActive: false,
        isAdmin: false,
      },
      {
        licenceNumber: ADULT.licenceNumber,
        fullName: 'DUPONT JEANNE',
        sex: 'female',
        category: 'S2',
        isActive: true,
        isAdmin: true,
      },
      {
        licenceNumber: YOUTH.licenceNumber,
        fullName: 'MARTIN LOU',
        sex: 'female',
        category: 'U18',
        isActive: true,
        isAdmin: false,
      },
    ]);
  });

  test('an uploaded FFTA export updates the member list and is remembered as the last import', async () => {
    const before = (await (await call('/api/admin/members/import', { cookie })).json()) as MemberImportStatusResponse;
    expect(before).toEqual({ lastImport: null, activeMemberCount: 2 });

    const response = await upload(cookie, await memberExport());
    expect(response.status).toBe(200);
    const expected = {
      lastImport: {
        importedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
        importedByName: 'DUPONT JEANNE',
        memberCount: 2,
        added: 1,
        updated: 0,
        unchanged: 1,
      },
      activeMemberCount: 3,
    };
    expect((await response.json()) as MemberImportResponse).toEqual(expected);
    expect(await (await call('/api/admin/members/import', { cookie })).json()).toEqual(expected);
    // The youth is missing from the new export: nothing changes for her.
    expect((await call('/api/session', { method: 'POST', body: YOUTH })).status).toBe(200);
  });

  test('a wrong file is refused with the reason and the line, and nothing is imported', async () => {
    const notExcel = await upload(cookie, new Blob(['Nom;Prénom\nDUPONT;JEAN']));
    expect(notExcel.status).toBe(400);
    expect((await notExcel.json()) as MemberExportErrorResponse).toEqual({
      error: 'invalid_member_export',
      problem: 'unreadable',
      line: null,
      detail: null,
    });

    const badLicence = await upload(cookie, await memberExport('123'));
    expect((await badLicence.json()) as MemberExportErrorResponse).toEqual({
      error: 'invalid_member_export',
      problem: 'invalid_licence',
      line: 3,
      detail: '123',
    });
    expect(await database('archers').where({ is_active: true }).pluck('licence_number')).toHaveLength(2);
    expect(await database('member_imports').pluck('id')).toEqual([]);
  });
});

async function adminCookieOf(member: typeof ADULT, password: string): Promise<string> {
  const response = await call('/api/admin/session', {
    method: 'POST',
    cookie: await signIn(member),
    body: { password },
  });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

describe('member actions', () => {
  let cookie: string;
  beforeEach(async () => {
    await makeAdmin(ADULT);
    cookie = await adminSignIn();
  });

  const grant = (licence: string) => call(`/api/admin/members/${licence}/admin`, { method: 'POST', cookie });

  test('a new admin gets a generated password and must replace it before using the panel', async () => {
    const granted = await grant(YOUTH.licenceNumber);
    expect(granted.status).toBe(200);
    const { password } = (await granted.json()) as GrantAdminResponse;
    expect(password).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);

    const youth = await adminCookieOf(YOUTH, password);
    const session = (await (await call('/api/admin/session', { cookie: youth })).json()) as AdminSessionResponse;
    expect(session.admin.mustChangePassword).toBe(true);
    const blocked = await call('/api/admin/competitions', { cookie: youth });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'password_change_required' });

    // The generated password was typed moments ago: the first change only asks for the new one.
    const change = (body: unknown) => call('/api/admin/session/password', { method: 'PUT', cookie: youth, body });
    expect(await (await change({ currentPassword: null, newPassword: 'court' })).json()).toEqual({
      error: 'password_too_short',
    });
    expect((await change({ currentPassword: null, newPassword: password })).status).toBe(400);
    expect((await change({ currentPassword: null, newPassword: 'mon-nouveau-mdp' })).status).toBe(204);

    expect((await call('/api/admin/competitions', { cookie: youth })).status).toBe(200);
    const again = await adminCookieOf(YOUTH, 'mon-nouveau-mdp');
    const after = (await (await call('/api/admin/session', { cookie: again })).json()) as AdminSessionResponse;
    expect(after.admin.mustChangePassword).toBe(false);

    // Later changes ask for the current password again.
    const later = (body: unknown) => call('/api/admin/session/password', { method: 'PUT', cookie: again, body });
    expect((await later({ currentPassword: null, newPassword: 'encore-un-autre' })).status).toBe(401);
    expect((await later({ currentPassword: 'wrong-password', newPassword: 'encore-un-autre' })).status).toBe(401);
    expect((await later({ currentPassword: 'mon-nouveau-mdp', newPassword: 'encore-un-autre' })).status).toBe(204);
  });

  test('admin rights are given only to active members who are not admins yet', async () => {
    expect(await (await grant(ADULT.licenceNumber)).json()).toEqual({ error: 'already_admin' });
    expect(await (await grant(DEPARTED.licenceNumber)).json()).toEqual({ error: 'member_inactive' });
    expect((await grant('9999999Z')).status).toBe(404);
  });

  test("removing admin rights ends that admin's sessions, but nobody can remove their own", async () => {
    const { password } = (await (await grant(YOUTH.licenceNumber)).json()) as GrantAdminResponse;
    const youth = await adminCookieOf(YOUTH, password);
    const revoke = (licence: string) => call(`/api/admin/members/${licence}/admin`, { method: 'DELETE', cookie });

    const self = await revoke(ADULT.licenceNumber);
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: 'cannot_change_self' });

    expect((await revoke(YOUTH.licenceNumber)).status).toBe(204);
    expect((await call('/api/admin/session', { cookie: youth })).status).toBe(401);
    expect((await revoke(YOUTH.licenceNumber)).status).toBe(404);
  });

  test('an admin deactivates or reactivates a member by hand, but not themselves', async () => {
    const patch = (licence: string, body: unknown) =>
      call(`/api/admin/members/${licence}`, { method: 'PATCH', cookie, body });

    expect((await patch(YOUTH.licenceNumber, { isActive: false })).status).toBe(204);
    expect((await call('/api/session', { method: 'POST', body: YOUTH })).status).toBe(401);
    expect((await patch(YOUTH.licenceNumber, { isActive: true })).status).toBe(204);
    expect((await call('/api/session', { method: 'POST', body: YOUTH })).status).toBe(200);

    expect(await (await patch(ADULT.licenceNumber, { isActive: false })).json()).toEqual({
      error: 'cannot_change_self',
    });
    expect((await patch(YOUTH.licenceNumber, { isActive: 'no' })).status).toBe(400);
    expect((await patch('9999999Z', { isActive: false })).status).toBe(404);
  });
});

describe('FFTA scraper runs', () => {
  let cookie: string;
  beforeEach(async () => {
    await makeAdmin(ADULT);
    cookie = await adminSignIn();
  });
  const start = (body: unknown) => call('/api/admin/scraper/runs', { method: 'POST', cookie, body });
  const status = async () => (await (await call('/api/admin/scraper', { cookie })).json()) as ScraperStatusResponse;

  test('starts a full run, launches its process, and shows it as the current run', async () => {
    const response = await start({ kind: 'full' });
    expect(response.status).toBe(202);
    const { run } = (await response.json()) as StartScraperRunResponse;
    expect(run).toMatchObject({ kind: 'full', fftaId: null, status: 'running', startedByName: 'DUPONT JEANNE' });
    expect(launched).toEqual([run.id]);
    expect(await status()).toMatchObject({ available: true, current: { id: run.id }, recent: [] });
  });

  test('never starts a second run while one is going, and says which one', async () => {
    const first = ((await (await start({ kind: 'full' })).json()) as StartScraperRunResponse).run;
    const second = await start({ kind: 'competition', fftaId: '27469' });
    expect(second.status).toBe(409);
    expect((await second.json()) as ScraperBusyResponse).toMatchObject({
      error: 'scraper_busy',
      run: { id: first.id },
    });
    expect(launched).toEqual([first.id]);
  });

  test('a run that stopped giving news no longer blocks: it is marked interrupted', async () => {
    const first = ((await (await start({ kind: 'full' })).json()) as StartScraperRunResponse).run;
    // Its process went silent an hour ago (the test clock says 10:00).
    await database('scraper_runs').update({ heartbeat_at: '2026-10-06T09:00:00.000Z' });
    const response = await start({ kind: 'competition', fftaId: '27469' });
    expect(response.status).toBe(202);
    expect((await status()).recent).toMatchObject([{ id: first.id, status: 'interrupted' }]);
  });

  test('streams the status at once, then its changes, to an open admin page', async () => {
    const response = await call('/api/admin/scraper/events', { cookie });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const nextEvent = async () => {
      const { value } = await reader.read();
      return JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '')) as ScraperStatusResponse;
    };
    expect(await nextEvent()).toMatchObject({ available: true, current: null });

    await start({ kind: 'full' });
    expect(await nextEvent()).toMatchObject({ current: { kind: 'full', status: 'running' } });
    await reader.cancel();
  });

  test('the event stream is for admins only', async () => {
    expect((await call('/api/admin/scraper/events', { cookie: await signIn(YOUTH) })).status).toBe(401);
  });

  test('refuses unknown kinds and competition ids that are not FFTA numbers', async () => {
    for (const body of [{ kind: 'everything' }, { kind: 'competition' }, { kind: 'competition', fftaId: '../x' }]) {
      expect((await start(body)).status).toBe(400);
    }
    expect(launched).toEqual([]);
  });
});

function mandateDeparture(label: string) {
  return { date: null, label, registrationOpens: '08:00', shootingStarts: null };
}
