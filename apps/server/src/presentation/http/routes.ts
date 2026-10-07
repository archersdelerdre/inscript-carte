import {
  API_ROUTES,
  type HealthResponse,
  type ListCompetitionRegistrantsResponse,
  type ListCompetitionsResponse,
  type ListMyRegistrationsResponse,
  type RegistrationCreatedResponse,
  type SessionResponse,
} from '@inscript-carte/shared';
import type { BunRequest } from 'bun';

import type { Authentication } from '../../application/authentication.ts';
import type { ClubRegistrations } from '../../application/club-registrations.ts';
import type { ListUpcomingCompetitions } from '../../application/list-upcoming-competitions.ts';
import type { Archer } from '../../domain/archer.ts';
import { createAdminRoutes, type AdminHttpDependencies } from './admin-routes.ts';
import { error, isHttps, readJson, STATUS_BY_REASON, type ClientAddressSource } from './http.ts';
import { toCompetitionDto, toMyRegistrationDto, toSignedInArcher } from './presenters.ts';

const SESSION_COOKIE = 'session';

export type HttpDependencies = Omit<AdminHttpDependencies, 'signedInArcher'> & {
  listUpcomingCompetitions: ListUpcomingCompetitions;
  authentication: Authentication;
  clubRegistrations: ClubRegistrations;
};

export function createRoutes({
  listUpcomingCompetitions,
  authentication,
  clubRegistrations,
  ...adminDependencies
}: HttpDependencies) {
  const signedInArcher = (request: BunRequest) =>
    authentication.signedInArcher(request.cookies.get(SESSION_COOKIE) ?? null);
  const sessionResponse = async (archer: Archer) =>
    Response.json({
      archer: toSignedInArcher(archer, await adminDependencies.adminAccounts.isAdmin(archer.licenceNumber)),
    } satisfies SessionResponse);

  return {
    [API_ROUTES.health]: {
      GET: () => Response.json({ status: 'ok' } satisfies HealthResponse),
    },

    [API_ROUTES.competitions]: {
      GET: async () => {
        const competitions = await listUpcomingCompetitions.execute();
        return Response.json({ competitions: competitions.map(toCompetitionDto) } satisfies ListCompetitionsResponse);
      },
    },

    [API_ROUTES.session]: {
      GET: async (request: BunRequest) => {
        const archer = await signedInArcher(request);
        return archer ? sessionResponse(archer) : error('not_signed_in', 401);
      },
      POST: async (request: BunRequest, server: ClientAddressSource) => {
        const body = await readJson(request);
        if (typeof body?.licenceNumber !== 'string' || typeof body.birthDate !== 'string') {
          return error('invalid_request', 400);
        }
        const clientAddress = server.requestIP(request)?.address ?? 'unknown';
        const result = await authentication.signIn(body.licenceNumber, body.birthDate, clientAddress);
        if (!result.ok) return error(result.reason, result.reason === 'too_many_attempts' ? 429 : 401);

        request.cookies.set(SESSION_COOKIE, result.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: isHttps(request),
          path: '/',
          expires: result.expiresAt,
        });
        return sessionResponse(result.archer);
      },
      DELETE: async (request: BunRequest) => {
        await authentication.signOut(request.cookies.get(SESSION_COOKIE) ?? null);
        request.cookies.delete({ name: SESSION_COOKIE, path: '/' });
        return new Response(null, { status: 204 });
      },
    },

    [API_ROUTES.competitionRegistrations]: {
      GET: async (request: BunRequest<typeof API_ROUTES.competitionRegistrations>) => {
        if (!(await signedInArcher(request))) return error('not_signed_in', 401);
        const registrants = await clubRegistrations.registrants(request.params.competitionId);
        return registrants
          ? Response.json({ registrants } satisfies ListCompetitionRegistrantsResponse)
          : error('not_found', 404);
      },
      POST: async (request: BunRequest<typeof API_ROUTES.competitionRegistrations>) => {
        const archer = await signedInArcher(request);
        if (!archer) return error('not_signed_in', 401);
        const body = await readJson(request);
        if (!body) return error('invalid_request', 400);

        const result = await clubRegistrations.register(archer, request.params.competitionId, {
          departures: body.departures,
          trispot: body.trispot,
          carpool: body.carpool,
          distance: body.distance,
          contact: body.contact,
          paymentMethod: body.paymentMethod,
        });
        if (!result.ok) return error(result.reason, STATUS_BY_REASON[result.reason]);
        const { ok: _, ...created } = result;
        return Response.json(created satisfies RegistrationCreatedResponse, { status: 201 });
      },
    },

    [API_ROUTES.myRegistrations]: {
      GET: async (request: BunRequest) => {
        const archer = await signedInArcher(request);
        if (!archer) return error('not_signed_in', 401);
        const registrations = await clubRegistrations.mine(archer);
        return Response.json({
          registrations: registrations.map(toMyRegistrationDto),
        } satisfies ListMyRegistrationsResponse);
      },
    },

    [API_ROUTES.myRegistration]: {
      DELETE: async (request: BunRequest<typeof API_ROUTES.myRegistration>) => {
        const archer = await signedInArcher(request);
        if (!archer) return error('not_signed_in', 401);
        const id = Number(request.params.registrationId);
        if (!Number.isInteger(id)) return error('not_found', 404);
        const result = await clubRegistrations.withdraw(archer, id);
        return result.ok ? new Response(null, { status: 204 }) : error(result.reason, STATUS_BY_REASON[result.reason]);
      },
    },
    ...createAdminRoutes({ ...adminDependencies, signedInArcher }),
  };
}
