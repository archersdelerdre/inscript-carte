import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type {
  AdminCompetitionRegistrationsResponse,
  AdminSessionResponse,
  CompetitionDto,
  CompetitionEditResponse,
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

// Made-up members and competitions. Today is 6 Oct 2026. The club takes registrations only once the mandate is out;
// a mandate link whose day is unknown counts as early: the deadline is 14 days before the start.
const ADULT = { licenceNumber: '0123456A', birthDate: '1980-05-12' };
const YOUTH = { licenceNumber: '7654321B', birthDate: '2012-03-03' };
const DEPARTED = { licenceNumber: '1111111C', birthDate: '1975-01-01' };
const SALLE = '90001'; // starts 2027-01-09, mandate out: deadline 2026-12-26
const EXTERIEUR = '90002'; // starts 2027-05-01, mandate out
const SOON = '90003'; // starts 2026-10-12, no mandate: deadline 2026-10-05, already closed

let database: Knex;
let server: ReturnType<typeof Bun.serve>;
const clock = { day: '2026-10-06', today: () => clock.day, now: () => new Date(`${clock.day}T10:00:00Z`) };
/** The scraper runs the server asked to start: no process is launched in tests. */
let launched: number[];

function competitionRow(ffta_id: string, discipline: string, start_date: string, mandate_url: string | null = null) {
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
    mandate_url,
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
    competitionRow(SALLE, 'salle', '2027-01-09', 'https://extranet.ffta.fr/salle.pdf'),
    competitionRow(EXTERIEUR, 'exterieur', '2027-05-01', 'https://extranet.ffta.fr/exterieur.pdf'),
    competitionRow(SOON, 'salle', '2026-10-12'),
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

/**
 * « Rester connecté » ticked: several tests move the clock days ahead. A member with a password gives it; the admin
 * of `makeAdmin` gives `ADMIN_PASSWORD` when the sign-in asks (one password per person).
 */
async function signIn(member: typeof ADULT, password?: string): Promise<string> {
  const attempt = (given?: string) =>
    call('/api/session', { method: 'POST', body: { ...member, remember: true, ...(given && { password: given }) } });
  let response = await attempt(password);
  if (response.status === 401 && password === undefined) response = await attempt(ADMIN_PASSWORD);
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
        clubPaysRegistrations: false,
        hasPassword: false,
      },
    });

    expect((await call('/api/session', { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call('/api/session', { cookie })).status).toBe(401);
  });

  test('the cookie outlives the browser only when « Rester connecté » is ticked', async () => {
    const once = await call('/api/session', { method: 'POST', body: ADULT });
    expect(once.headers.get('set-cookie')).not.toMatch(/Expires=/i);
    const remembered = await call('/api/session', { method: 'POST', body: { ...ADULT, remember: true } });
    expect(remembered.headers.get('set-cookie')).toMatch(/Expires=/i);
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

describe('member password', () => {
  const PASSWORD = 'mon-arc-2026';
  const putPassword = (cookie: string, body: object) => call('/api/me/password', { method: 'PUT', cookie, body });
  const signInWith = (password?: string) =>
    call('/api/session', { method: 'POST', body: { ...ADULT, remember: true, ...(password && { password }) } });

  test('once added, it is asked after the birth date; the other devices are signed out', async () => {
    const here = await signIn(ADULT);
    const elsewhere = await signIn(ADULT);
    expect((await putPassword(here, { currentPassword: null, newPassword: 'court' })).status).toBe(400);
    expect((await putPassword(here, { currentPassword: null, newPassword: PASSWORD })).status).toBe(204);

    expect(((await (await call('/api/session', { cookie: here })).json()) as SessionResponse).archer.hasPassword).toBe(
      true,
    );
    expect((await call('/api/session', { cookie: elsewhere })).status).toBe(401);

    // The right birth date alone is not enough anymore; a wrong one still says nothing of the password.
    expect(await (await signInWith()).json()).toEqual({ error: 'password_required' });
    expect(await (await signInWith('mauvais-mot')).json()).toEqual({ error: 'wrong_password' });
    expect((await signInWith(PASSWORD)).status).toBe(200);
    const wrongDate = await call('/api/session', {
      method: 'POST',
      body: { ...ADULT, birthDate: '1980-05-13', password: PASSWORD },
    });
    expect(await wrongDate.json()).toEqual({ error: 'invalid_credentials' });
  });

  test('changing or removing it asks the current one', async () => {
    const cookie = await signIn(ADULT);
    await putPassword(cookie, { currentPassword: null, newPassword: PASSWORD });
    expect(await (await putPassword(cookie, { currentPassword: null, newPassword: 'autre-mot-2026' })).json()).toEqual({
      error: 'wrong_password',
    });
    expect((await putPassword(cookie, { currentPassword: PASSWORD, newPassword: 'autre-mot-2026' })).status).toBe(204);

    const remove = (currentPassword: string) =>
      call('/api/me/password', { method: 'DELETE', cookie, body: { currentPassword } });
    expect((await remove(PASSWORD)).status).toBe(401);
    expect((await remove('autre-mot-2026')).status).toBe(204);
    expect((await signInWith()).status).toBe(200);
  });

  test('after 10 wrong passwords, even the right one is refused for 15 minutes', async () => {
    await putPassword(await signIn(ADULT), { currentPassword: null, newPassword: PASSWORD });
    for (let attempt = 1; attempt <= 10; attempt++) await signInWith(`faux-${attempt}-mot`);
    expect(await (await signInWith(PASSWORD)).json()).toEqual({ error: 'too_many_attempts' });
  });

  test('an admin removes a forgotten password, but not their own', async () => {
    await putPassword(await signIn(YOUTH), { currentPassword: null, newPassword: PASSWORD });
    await makeAdmin(ADULT);
    const admin = await adminSignIn();
    const remove = (licence: string) =>
      call(`/api/admin/members/${licence}/password`, { method: 'DELETE', cookie: admin });
    expect(await (await remove(ADULT.licenceNumber)).json()).toEqual({ error: 'cannot_change_self' });
    expect((await remove(YOUTH.licenceNumber)).status).toBe(204);
    expect((await call('/api/session', { method: 'POST', body: YOUTH })).status).toBe(200);
  });

  test('one password per person: an admin keeps the one they had, and can change it but not remove it', async () => {
    await makeAdmin(ADULT);
    const admin = await adminSignIn();
    // A member who already has a password keeps it: no generated one, nothing to replace at the panel.
    await putPassword(await signIn(YOUTH), { currentPassword: null, newPassword: 'mot-de-lou-2026' });
    const granted = await call(`/api/admin/members/${YOUTH.licenceNumber}/admin`, { method: 'POST', cookie: admin });
    expect(await granted.json()).toEqual({ password: null });
    const youth = await signIn(YOUTH, 'mot-de-lou-2026');
    const panel = (await (await call('/api/admin/session', { cookie: youth })).json()) as AdminSessionResponse;
    expect(panel.admin.mustChangePassword).toBe(false);

    // Changed from the site, it changes for the panel too, as long as an admin's must be.
    expect((await putPassword(youth, { currentPassword: 'mot-de-lou-2026', newPassword: 'court-12' })).status).toBe(
      400,
    );
    expect(
      (await putPassword(youth, { currentPassword: 'mot-de-lou-2026', newPassword: 'nouveau-mot-lou' })).status,
    ).toBe(204);
    const oldPassword = { ...YOUTH, password: 'mot-de-lou-2026' };
    expect(await (await call('/api/session', { method: 'POST', body: oldPassword })).json()).toEqual({
      error: 'wrong_password',
    });
    expect((await call('/api/admin/competitions', { cookie: await signIn(YOUTH, 'nouveau-mot-lou') })).status).toBe(
      200,
    );

    const removeOwn = await call('/api/me/password', {
      method: 'DELETE',
      cookie: youth,
      body: { currentPassword: 'nouveau-mot-lou' },
    });
    expect(await removeOwn.json()).toEqual({ error: 'admin_needs_password' });
    const removeByAdmin = await call(`/api/admin/members/${YOUTH.licenceNumber}/password`, {
      method: 'DELETE',
      cookie: admin,
    });
    expect(await removeByAdmin.json()).toEqual({ error: 'admin_needs_password' });
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
      paymentDeadline: '2026-12-26',
      paymentStatus: 'to_pay',
      // No mandate read: no amount rather than a wrong one.
      amountDue: null,
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

  test('the amount to pay the club comes from the mandate prices, for all the archer’s départs there', async () => {
    await database('competition_mandates').insert({
      ffta_id: SALLE,
      mandate_url: 'https://extranet.ffta.fr/salle.pdf',
      status: 'parsed',
      data: JSON.stringify({
        departures: [],
        prices: [
          { categories: ['S1', 'S2', 'S3'], departures: 1, amountEuros: 9 },
          { categories: ['S1', 'S2', 'S3'], departures: 2, amountEuros: 16 },
        ],
        foamTargets: 'not_mentioned',
        evidence: { departures: null, prices: null, foamTargets: null },
      }),
      read_at: new Date().toISOString(),
    });
    const cookie = await signIn(ADULT);
    const register = async (departure: number) =>
      (await (
        await call(`/api/competitions/${SALLE}/registrations`, {
          method: 'POST',
          cookie,
          body: form({ departures: [departure] }),
        })
      ).json()) as RegistrationCreatedResponse;

    expect((await register(1)).amountDue).toBe(9);
    await database('registrations').update({ payment_status: 'paid' });
    // The 1st départ is paid: the 2nd costs what the 2-départ price adds.
    expect((await register(2)).amountDue).toBe(7);
    const mine = (await (await call('/api/me/registrations', { cookie })).json()) as ListMyRegistrationsResponse;
    expect(mine.registrations.map(({ amountDue }) => amountDue)).toEqual([7, 7]);
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

    clock.day = '2026-12-26';
    expect(
      (await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie, body: form() })).status,
    ).toBe(201);
    clock.day = '2026-12-27';
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

  test('is closed while the competition is postponed', async () => {
    await database('competitions').where({ ffta_id: SALLE }).update({ status: 'postponed' });
    const cookie = await signIn(ADULT);
    const response = await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie, body: form() });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'registration_closed' });
  });

  test('is closed until the mandate is out, even well before the deadline', async () => {
    await database('competitions').where({ ffta_id: SALLE }).update({ mandate_url: null });
    const cookie = await signIn(ADULT);
    const response = await call(`/api/competitions/${SALLE}/registrations`, { method: 'POST', cookie, body: form() });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'registration_closed' });
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
      registrants: [
        {
          fullName: 'DUPONT JEANNE',
          category: 'S2',
          sex: 'female',
          bowType: 'classique',
          departures: [1, 3],
          carpool: false,
        },
      ],
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
      {
        fullName: 'DUPONT JEANNE',
        category: 'S2',
        sex: 'female',
        bowType: 'classique',
        departures: [1],
        carpool: true,
      },
      { fullName: 'DUPONT JEANNE', category: 'S2', sex: 'female', bowType: 'poulies', departures: [2], carpool: true },
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
      {
        fullName: 'DUPONT JEANNE',
        category: 'S2',
        sex: 'female',
        bowType: 'classique',
        departures: [1],
        carpool: false,
      },
      { fullName: 'DUPONT JEANNE', category: 'S2', sex: 'female', bowType: 'poulies', departures: [2], carpool: false },
    ]);
  });

  test('when the club pays, no payment method is asked and the départs have nothing to pay', async () => {
    await database('archers').where({ licence_number: YOUTH.licenceNumber }).update({ club_pays_registrations: true });
    const youth = await signIn(YOUTH);
    const session = (await (await call('/api/session', { cookie: youth })).json()) as SessionResponse;
    expect(session.archer.clubPaysRegistrations).toBe(true);

    const created = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie: youth,
      body: form({ paymentMethod: null }),
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as RegistrationCreatedResponse).paymentStatus).toBe('nothing_due');
    const mine = (await (await call('/api/me/registrations', { cookie: youth })).json()) as ListMyRegistrationsResponse;
    expect(mine.registrations.map(({ paymentStatus, paymentMethod }) => [paymentStatus, paymentMethod])).toEqual([
      ['nothing_due', null],
    ]);

    const adult = await call(`/api/competitions/${SALLE}/registrations`, {
      method: 'POST',
      cookie: await signIn(ADULT),
      body: form({ paymentMethod: null }),
    });
    expect([adult.status, await adult.json()]).toEqual([400, { error: 'invalid_request' }]);
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

    clock.day = '2026-12-27';
    const late = await call(`/api/me/registrations/${first!.id}`, { method: 'DELETE', cookie });
    expect(await late.json()).toEqual({ error: 'cannot_withdraw' });
  });
});

// The adult member is the admin; the youth is a member without admin rights.
const ADMIN_PASSWORD = 'tir-a-l-arc-2026';

/** One password per person: the admin's is their member password too. */
async function makeAdmin(member: typeof ADULT) {
  await database('archers')
    .where({ licence_number: member.licenceNumber })
    .update({ password_hash: await Bun.password.hash(ADMIN_PASSWORD) });
  await database('admins').insert({ archer_licence_number: member.licenceNumber });
}

/** One sign-in: the site session opened with the admin's password opens the panel too. */
function adminSignIn(): Promise<string> {
  return signIn(ADULT, ADMIN_PASSWORD);
}

/** A site session opened with the birth date alone, before the admin had a password (an older session). */
async function birthDateOnlySession(member: typeof ADULT): Promise<string> {
  const passwordHash = await database('archers').where({ licence_number: member.licenceNumber }).first('password_hash');
  await database('archers').where({ licence_number: member.licenceNumber }).update({ password_hash: null });
  const response = await call('/api/session', { method: 'POST', body: { ...member, remember: true } });
  await database('archers').where({ licence_number: member.licenceNumber }).update(passwordHash);
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

  test('one sign-in: the site session opened with the password opens the panel, signing out closes it', async () => {
    const cookie = await signIn(ADULT, ADMIN_PASSWORD);
    expect((await (await call('/api/admin/session', { cookie })).json()) as AdminSessionResponse).toEqual({
      admin: { licenceNumber: ADULT.licenceNumber, fullName: 'DUPONT JEANNE', mustChangePassword: false },
    });
    expect((await call('/api/admin/competitions', { cookie })).status).toBe(200);
    expect((await call('/api/session', { method: 'DELETE', cookie })).status).toBe(204);
    expect((await call('/api/admin/competitions', { cookie })).status).toBe(401);
  });

  test('the panel says why it is closed: signed out, not an admin, or signed in without the password', async () => {
    const bodyOf = async (cookie?: string) => (await call('/api/admin/session', { cookie })).json();
    expect(await bodyOf()).toEqual({ error: 'not_signed_in' });
    expect(await bodyOf(await signIn(YOUTH))).toEqual({ error: 'not_admin' });
    const older = await birthDateOnlySession(ADULT);
    expect(await bodyOf(older)).toEqual({ error: 'password_required' });
    expect((await call('/api/admin/competitions', { cookie: older })).status).toBe(401);
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

  test('visitors, members and an admin signed in without the password get nothing from the admin API', async () => {
    await registerBoth();
    const routes = [
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
      ['DELETE', `/api/admin/members/${YOUTH.licenceNumber}/password`],
    ] as const;
    const refusals = [
      [undefined, 401, 'admin_sign_in_required'],
      [await signIn(YOUTH), 401, 'admin_sign_in_required'],
      [await birthDateOnlySession(ADULT), 401, 'admin_sign_in_required'],
    ] as const;
    for (const [cookie, status, reason] of refusals) {
      for (const [method, path] of routes) {
        const response = await call(path, {
          method,
          cookie,
          body: method === 'PATCH' ? { status: 'full' } : undefined,
        });
        expect([path, response.status, await response.json()]).toEqual([path, status, { error: reason }]);
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
      clubPaysRegistrations: false,
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

  test('back from « Plus de place », a départ the club pays still has nothing to pay', async () => {
    await database('archers').where({ licence_number: YOUTH.licenceNumber }).update({ club_pays_registrations: true });
    await registerBoth();
    const payments = async () => (await adminRegistrations(cookie)).map(({ paymentStatus }) => paymentStatus);
    expect(await payments()).toEqual(['nothing_due', 'nothing_due', 'to_pay']);

    for (const reference of ['R-0001', 'R-0002']) {
      await call(`/api/admin/payment-references/${reference}`, { method: 'PATCH', cookie, body: { status: 'full' } });
      await call(`/api/admin/payment-references/${reference}`, {
        method: 'PATCH',
        cookie,
        body: { status: 'received' },
      });
    }
    expect(await payments()).toEqual(['nothing_due', 'nothing_due', 'to_pay']);

    const [first] = await adminRegistrations(cookie);
    const patch = (body: object) => call(`/api/admin/registrations/${first!.id}`, { method: 'PATCH', cookie, body });
    await patch({ status: 'full' });
    await patch({ status: 'confirmed' });
    expect(await payments()).toEqual(['nothing_due', 'nothing_due', 'to_pay']);
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
          { categories: ['S1', 'S2', 'S3'], departures: 1, amountEuros: 9 },
          { categories: ['U11', 'U13', 'U15', 'U18', 'U21'], departures: 1, amountEuros: 6.5 },
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
    await database('archers').where({ licence_number: YOUTH.licenceNumber }).update({ password_hash: 'hash' });
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
        clubPaysRegistrations: false,
        hasPassword: false,
      },
      {
        licenceNumber: ADULT.licenceNumber,
        fullName: 'DUPONT JEANNE',
        sex: 'female',
        category: 'S2',
        isActive: true,
        isAdmin: true,
        clubPaysRegistrations: false,
        // The admin's password is their member password.
        hasPassword: true,
      },
      {
        licenceNumber: YOUTH.licenceNumber,
        fullName: 'MARTIN LOU',
        sex: 'female',
        category: 'U18',
        isActive: true,
        isAdmin: false,
        clubPaysRegistrations: false,
        hasPassword: true,
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

describe('member actions', () => {
  let cookie: string;
  beforeEach(async () => {
    await makeAdmin(ADULT);
    cookie = await adminSignIn();
  });

  const grant = (licence: string) => call(`/api/admin/members/${licence}/admin`, { method: 'POST', cookie });
  const patchMember = (licence: string, body: unknown) =>
    call(`/api/admin/members/${licence}`, { method: 'PATCH', cookie, body });
  const flagOf = async (licence: string) => {
    const response = await call('/api/admin/members', { cookie });
    const { members } = (await response.json()) as ListAdminMembersResponse;
    return members.find(({ licenceNumber }) => licenceNumber === licence)?.clubPaysRegistrations;
  };

  test('a new admin gets a generated password and must replace it before using the panel', async () => {
    const granted = await grant(YOUTH.licenceNumber);
    expect(granted.status).toBe(200);
    const { password } = (await granted.json()) as GrantAdminResponse;
    expect(password).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);

    // Signing in with the generated password opens the panel, but only to replace it.
    const youth = await signIn(YOUTH, password!);
    const session = (await (await call('/api/admin/session', { cookie: youth })).json()) as AdminSessionResponse;
    expect(session.admin.mustChangePassword).toBe(true);
    const blocked = await call('/api/admin/competitions', { cookie: youth });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: 'password_change_required' });

    // Typed moments ago: the first change only asks for the new one, as long as an admin's, and not the same.
    const change = (cookie: string, body: unknown) => call('/api/me/password', { method: 'PUT', cookie, body });
    expect(await (await change(youth, { currentPassword: null, newPassword: 'court' })).json()).toEqual({
      error: 'password_too_short',
    });
    expect(await (await change(youth, { currentPassword: null, newPassword: password })).json()).toEqual({
      error: 'same_password',
    });
    // Not from an older session, opened with the birth date alone before the rights were given.
    const older = await birthDateOnlySession(YOUTH);
    expect((await change(older, { currentPassword: null, newPassword: 'mon-nouveau-mdp' })).status).toBe(401);
    expect((await change(youth, { currentPassword: null, newPassword: 'mon-nouveau-mdp' })).status).toBe(204);
    expect((await call('/api/admin/competitions', { cookie: youth })).status).toBe(200);

    // Later changes ask for the current password again.
    expect((await change(youth, { currentPassword: null, newPassword: 'encore-un-autre' })).status).toBe(401);
    expect((await change(youth, { currentPassword: 'wrong-password', newPassword: 'encore-un-autre' })).status).toBe(
      401,
    );
    expect((await change(youth, { currentPassword: 'mon-nouveau-mdp', newPassword: 'encore-un-autre' })).status).toBe(
      204,
    );
  });

  test('admin rights are given only to active members who are not admins yet', async () => {
    expect(await (await grant(ADULT.licenceNumber)).json()).toEqual({ error: 'already_admin' });
    expect(await (await grant(DEPARTED.licenceNumber)).json()).toEqual({ error: 'member_inactive' });
    expect((await grant('9999999Z')).status).toBe(404);
  });

  test('removing admin rights closes the panel at once, but nobody can remove their own', async () => {
    const { password } = (await (await grant(YOUTH.licenceNumber)).json()) as GrantAdminResponse;
    const youth = await signIn(YOUTH, password!);
    const revoke = (licence: string) => call(`/api/admin/members/${licence}/admin`, { method: 'DELETE', cookie });

    const self = await revoke(ADULT.licenceNumber);
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: 'cannot_change_self' });

    expect((await revoke(YOUTH.licenceNumber)).status).toBe(204);
    expect(await (await call('/api/admin/session', { cookie: youth })).json()).toEqual({ error: 'not_admin' });
    expect((await revoke(YOUTH.licenceNumber)).status).toBe(404);
  });

  test('an admin deactivates or reactivates a member by hand, but not themselves', async () => {
    expect((await patchMember(YOUTH.licenceNumber, { isActive: false })).status).toBe(204);
    expect((await call('/api/session', { method: 'POST', body: YOUTH })).status).toBe(401);
    expect((await patchMember(YOUTH.licenceNumber, { isActive: true })).status).toBe(204);
    expect((await call('/api/session', { method: 'POST', body: YOUTH })).status).toBe(200);

    expect(await (await patchMember(ADULT.licenceNumber, { isActive: false })).json()).toEqual({
      error: 'cannot_change_self',
    });
    expect((await patchMember(YOUTH.licenceNumber, { isActive: 'no' })).status).toBe(400);
    expect((await patchMember('9999999Z', { isActive: false })).status).toBe(404);
  });

  test('an admin says the club pays a member’s registrations, but not their own', async () => {
    expect((await patchMember(YOUTH.licenceNumber, { clubPaysRegistrations: true })).status).toBe(204);
    expect(await flagOf(YOUTH.licenceNumber)).toBe(true);
    expect((await patchMember(YOUTH.licenceNumber, { clubPaysRegistrations: false })).status).toBe(204);
    expect(await flagOf(YOUTH.licenceNumber)).toBe(false);

    expect((await patchMember(YOUTH.licenceNumber, {})).status).toBe(400);
    expect((await patchMember(YOUTH.licenceNumber, { clubPaysRegistrations: 'oui' })).status).toBe(400);
    expect((await patchMember(YOUTH.licenceNumber, { isActive: false, clubPaysRegistrations: 'oui' })).status).toBe(
      400,
    );
    expect(await (await patchMember(ADULT.licenceNumber, { clubPaysRegistrations: true })).json()).toEqual({
      error: 'cannot_change_self',
    });
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

describe('competition edits', () => {
  const overridesPath = `/api/admin/competitions/${SALLE}/overrides`;
  const publicSalle = async () => {
    // Our own API, typed by its contract.
    const body = (await (await call('/api/competitions')).json()) as { competitions: CompetitionDto[] };
    return body.competitions.find((competition) => competition.id === SALLE);
  };

  test('an edit wins over the FFTA value everywhere, even after the scraper writes again, until it is put back', async () => {
    await makeAdmin(ADULT);
    const cookie = await adminSignIn();
    const put = (body: object) => call(overridesPath, { method: 'PUT', cookie, body });

    expect(
      (
        await put({
          title: 'Concours corrigé',
          position: { latitude: 47.3, longitude: -1.5 },
          departures: [mandateDeparture('Matin')],
        })
      ).status,
    ).toBe(204);
    // The next scraper run rewrites the competition row: the edit stays.
    await database('competitions').where({ ffta_id: SALLE }).update({ title: 'Titre FFTA', latitude: 1, longitude: 1 });
    expect(await publicSalle()).toMatchObject({
      title: 'Concours corrigé',
      position: { latitude: 47.3, longitude: -1.5 },
      departures: [{ label: 'Matin' }],
    });

    const edit = (await (await call(overridesPath, { cookie })).json()) as CompetitionEditResponse;
    expect(edit.competition.ffta).toMatchObject({ title: 'Titre FFTA', position: { latitude: 1, longitude: 1 } });
    expect(Object.keys(edit.competition.overrides).toSorted()).toEqual(['departures', 'position', 'title']);
    expect(edit.competition.updatedByName).toBe('DUPONT JEANNE');

    // Leaving a field out puts the FFTA value back.
    expect((await put({ title: 'Concours corrigé' })).status).toBe(204);
    expect(await publicSalle()).toMatchObject({ title: 'Concours corrigé', position: { latitude: 1, longitude: 1 } });
    expect((await put({})).status).toBe(204);
    expect((await publicSalle())?.title).toBe('Titre FFTA');
  });

  test('a wrong edit changes nothing; members cannot edit', async () => {
    await makeAdmin(ADULT);
    const cookie = await adminSignIn();
    const put = (body: object) => call(overridesPath, { method: 'PUT', cookie, body });
    // SALLE runs on 2027-01-09: an end before it, a départ on another day, a removed mandate, an unknown field.
    expect((await put({ endDate: '2027-01-08' })).status).toBe(400);
    expect((await put({ departures: [{ ...mandateDeparture('Matin'), date: '2027-01-10' }] })).status).toBe(400);
    expect((await put({ mandateUrl: null })).status).toBe(400);
    expect((await put({ organizer: 'X' })).status).toBe(400);
    expect((await publicSalle())?.endDate).toBe('2027-01-09');

    const member = await signIn(YOUTH);
    expect((await call(overridesPath, { method: 'PUT', cookie: member, body: { title: 'X' } })).status).toBe(401);
    expect((await call('/api/admin/competitions/nope/overrides', { cookie })).status).toBe(404);
  });

  test('a mandate link the FFTA did not have opens the late-mandate window from the day it was given', async () => {
    await makeAdmin(ADULT);
    const cookie = await adminSignIn();
    await database('competitions').where({ ffta_id: SALLE }).update({ mandate_url: null });
    // Today is 2026-10-06; SALLE starts 2027-01-09: early, so 14 days before.
    await call(overridesPath, { method: 'PUT', cookie, body: { mandateUrl: 'https://extranet.ffta.fr/m.pdf' } });
    expect(await publicSalle()).toMatchObject({
      mandateUrl: 'https://extranet.ffta.fr/m.pdf',
      clubRegistrationDeadline: '2026-12-26',
    });
  });

  test('the rhythms come from the mandate reading (none for older readings), and an edit wins', async () => {
    const link = 'https://extranet.ffta.fr/r.pdf';
    await database('competitions').where({ ffta_id: SALLE }).update({ mandate_url: link });
    const reading = (data: object) => ({
      ffta_id: SALLE,
      mandate_url: link,
      status: 'parsed',
      data: JSON.stringify({ departures: [], prices: [], foamTargets: 'not_mentioned', evidence: {}, ...data }),
      read_at: new Date().toISOString(),
    });
    const rhythms = async () => (await publicSalle())?.rhythms;
    await database('competition_mandates').insert(reading({}));
    expect(await rhythms()).toEqual([]);
    // A rhythm per day keeps both; ABC is shot indoors too.
    await database('competition_mandates')
      .where({ ffta_id: SALLE })
      .update(reading({ rhythms: ['AB/CD', 'ABC'], rhythmsAreAlternatives: false }));
    expect(await rhythms()).toEqual(['ABC', 'AB/CD']);

    await makeAdmin(ADULT);
    const cookie = await adminSignIn();
    const put = (body: object) => call(overridesPath, { method: 'PUT', cookie, body });
    expect((await put({ rhythms: ['AB'], discipline: 'exterieur' })).status).toBe(400);
    expect((await put({ rhythms: [] })).status).toBe(400);
    expect((await put({ rhythms: ['AB', 'AB'] })).status).toBe(400);
    expect((await put({ rhythms: ['ABC', 'AB/CD'], discipline: 'exterieur' })).status).toBe(204);
    expect(await rhythms()).toEqual(['ABC', 'AB/CD']);
    // Off targets, no rhythm at all: an edit refused, a reading ignored.
    expect((await put({ rhythms: ['AB/CD'], discipline: 'campagne' })).status).toBe(400);
    await put({ discipline: 'campagne' });
    expect(await rhythms()).toEqual([]);
    await put({ rhythms: ['AB/CD', 'AB'] });
    expect(await rhythms()).toEqual(['AB', 'AB/CD']);
  });
});

function mandateDeparture(label: string) {
  return { date: null, label, registrationOpens: '08:00', shootingStarts: null };
}
