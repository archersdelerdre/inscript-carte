import {
  API_ROUTES,
  type AdminCompetitionRegistrationsResponse,
  type CompetitionEditResponse,
  type CompetitionOverviewResponse,
  type AdminSessionResponse,
  type GrantAdminResponse,
  type ListAdminCompetitionsResponse,
  type ListAdminMembersResponse,
  type MemberExportErrorResponse,
  type MemberImportResponse,
  type MemberImportStatusResponse,
  type ScraperBusyResponse,
  type ScraperStatusResponse,
  type StartScraperRunResponse,
} from '@inscript-carte/shared';
import type { BunRequest } from 'bun';

import type { AdminAccounts } from '../../application/admin-accounts.ts';
import type { AdminAuthentication } from '../../application/admin-authentication.ts';
import type { AdminCompetitionOverview } from '../../application/admin-competition-overview.ts';
import type { AdminRegistrations, UpdateResult } from '../../application/admin-registrations.ts';
import type { ClubMembers } from '../../application/club-members.ts';
import type { CompetitionEdits } from '../../application/competition-edits.ts';
import type { ScraperRuns } from '../../application/scraper-runs.ts';
import type { Archer, Responsible } from '../../domain/archer.ts';
import type { Competition } from '../../domain/competition.ts';
import type { RegistrationDetails } from '../../domain/registration-repository.ts';
import { MemberExportError } from '../../infrastructure/members/ffta-member-export.ts';
import { error, isHttps, readJson, STATUS_BY_REASON, type ClientAddressSource } from './http.ts';
import {
  toAdminCompetitionDto,
  toAdminMemberDto,
  toAdminRegistrationDto,
  toCompetitionEditDto,
  toCompetitionOverviewDto,
  toScraperRunDto,
} from './presenters.ts';
import { createScraperEvents } from './scraper-events.ts';

const ADMIN_COOKIE = 'admin_session';
/** The admin cookie is only sent to the admin API. */
const ADMIN_COOKIE_PATH = '/api/admin';
/** The FFTA export of 108 members is about 20 KB. */
const MAX_MEMBER_EXPORT_BYTES = 5 * 1024 * 1024;

export type AdminHttpDependencies = {
  /** The member session: the first step of the admin sign-in. */
  signedInArcher: (request: BunRequest) => Promise<Archer | null>;
  adminAuthentication: AdminAuthentication;
  adminAccounts: AdminAccounts;
  adminRegistrations: AdminRegistrations;
  adminCompetitionOverview: AdminCompetitionOverview;
  competitionEdits: CompetitionEdits;
  clubMembers: ClubMembers;
  scraperRuns: ScraperRuns;
  readMemberExport: (bytes: Buffer) => Promise<Archer[]>;
  organizerSpreadsheet: (
    competition: Competition,
    registrations: readonly RegistrationDetails[],
    responsible: Responsible,
  ) => Promise<Buffer>;
};

export function createAdminRoutes({
  signedInArcher,
  adminAuthentication,
  adminAccounts,
  adminRegistrations,
  adminCompetitionOverview,
  competitionEdits,
  clubMembers,
  scraperRuns,
  readMemberExport,
  organizerSpreadsheet,
}: AdminHttpDependencies) {
  /**
   * Every admin route but the sign-in goes through this check first. An admin with a generated password only reaches
   * the routes that let them replace it (`whilePasswordChangeRequired`).
   */
  function asAdmin<Request extends BunRequest>(
    handler: (request: Request, admin: Archer, server: ClientAddressSource) => Promise<Response>,
    { whilePasswordChangeRequired = false } = {},
  ) {
    return async (request: Request, server: ClientAddressSource) => {
      const signedIn = await adminAuthentication.signedInAdmin(request.cookies.get(ADMIN_COOKIE) ?? null);
      if (!signedIn) return error('admin_sign_in_required', 401);
      if (signedIn.mustChangePassword && !whilePasswordChangeRequired) return error('password_change_required', 403);
      return handler(request, signedIn.archer, server);
    };
  }

  async function scraperStatus(): Promise<ScraperStatusResponse> {
    const { current, recent } = await scraperRuns.status();
    return {
      available: scraperRuns.available,
      current: current && toScraperRunDto(current),
      recent: recent.map(toScraperRunDto),
    };
  }
  const scraperEvents = createScraperEvents(scraperStatus);

  return {
    [API_ROUTES.adminSession]: {
      GET: async (request: BunRequest) => {
        const signedIn = await adminAuthentication.signedInAdmin(request.cookies.get(ADMIN_COOKIE) ?? null);
        if (!signedIn) return error('admin_sign_in_required', 401);
        const { archer, mustChangePassword } = signedIn;
        return Response.json({
          admin: { licenceNumber: archer.licenceNumber, fullName: archer.fullName, mustChangePassword },
        } satisfies AdminSessionResponse);
      },
      POST: async (request: BunRequest, server: ClientAddressSource) => {
        const member = await signedInArcher(request);
        if (!member) return error('not_signed_in', 401);
        const body = await readJson(request);
        if (typeof body?.password !== 'string') return error('invalid_request', 400);

        const clientAddress = server.requestIP(request)?.address ?? 'unknown';
        const result = await adminAuthentication.signIn(member, body.password, clientAddress);
        if (!result.ok) {
          return error(
            result.reason,
            { not_admin: 403, invalid_credentials: 401, too_many_attempts: 429 }[result.reason],
          );
        }
        request.cookies.set(ADMIN_COOKIE, result.token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: isHttps(request),
          path: ADMIN_COOKIE_PATH,
          expires: result.expiresAt,
        });
        return Response.json({
          admin: {
            licenceNumber: member.licenceNumber,
            fullName: member.fullName,
            mustChangePassword: result.mustChangePassword,
          },
        } satisfies AdminSessionResponse);
      },
      DELETE: async (request: BunRequest) => {
        await adminAuthentication.signOut(request.cookies.get(ADMIN_COOKIE) ?? null);
        request.cookies.delete({ name: ADMIN_COOKIE, path: ADMIN_COOKIE_PATH });
        return new Response(null, { status: 204 });
      },
    },

    [API_ROUTES.adminPassword]: {
      PUT: asAdmin(
        async (request: BunRequest, admin, server) => {
          const body = await readJson(request);
          const currentPassword = body?.currentPassword ?? null;
          if (
            (currentPassword !== null && typeof currentPassword !== 'string') ||
            typeof body?.newPassword !== 'string'
          ) {
            return error('invalid_request', 400);
          }
          const clientAddress = server.requestIP(request)?.address ?? 'unknown';
          const result = await adminAuthentication.changePassword(
            admin,
            currentPassword,
            body.newPassword,
            clientAddress,
          );
          if (result.ok) return new Response(null, { status: 204 });
          return error(
            result.reason,
            { invalid_credentials: 401, too_many_attempts: 429, password_too_short: 400, invalid_request: 400 }[
              result.reason
            ],
          );
        },
        { whilePasswordChangeRequired: true },
      ),
    },

    [API_ROUTES.adminCompetitions]: {
      GET: asAdmin(async () => {
        const competitions = await adminRegistrations.competitions();
        return Response.json({
          competitions: competitions.map(toAdminCompetitionDto),
        } satisfies ListAdminCompetitionsResponse);
      }),
    },

    [API_ROUTES.adminCompetitionOverview]: {
      GET: asAdmin(async () => {
        const competitions = await adminCompetitionOverview.list();
        return Response.json({
          competitions: competitions.map(toCompetitionOverviewDto),
        } satisfies CompetitionOverviewResponse);
      }),
    },

    [API_ROUTES.adminCompetitionOverrides]: {
      GET: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminCompetitionOverrides>) => {
        const editable = await competitionEdits.editable(request.params.competitionId);
        if (!editable) return error('not_found', 404);
        return Response.json({
          competition: toCompetitionEditDto(request.params.competitionId, editable),
        } satisfies CompetitionEditResponse);
      }),
      PUT: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminCompetitionOverrides>, admin) => {
        const result = await competitionEdits.save(admin, request.params.competitionId, await readJson(request));
        if (result.ok) return new Response(null, { status: 204 });
        return error(result.reason, result.reason === 'not_found' ? 404 : 400);
      }),
    },

    [API_ROUTES.adminCompetitionRegistrations]: {
      GET: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminCompetitionRegistrations>) => {
        const result = await adminRegistrations.competitionRegistrations(request.params.competitionId);
        if (!result) return error('not_found', 404);
        return Response.json({
          competition: toAdminCompetitionDto(result.competition),
          registrations: result.registrations.map((registration) =>
            toAdminRegistrationDto(registration, result.competition.competition),
          ),
        } satisfies AdminCompetitionRegistrationsResponse);
      }),
    },

    [API_ROUTES.adminCompetitionExport]: {
      GET: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminCompetitionExport>, admin) => {
        // `?status=…&paymentStatus=…`: the filters shown in the panel. Missing means "all".
        const query = new URL(request.url).searchParams;
        const result = await adminRegistrations.organizerList(admin, request.params.competitionId, {
          status: query.get('status') ?? undefined,
          paymentStatus: query.get('paymentStatus') ?? undefined,
        });
        if (result === 'invalid') return error('invalid_request', 400);
        if (result === 'not_found') return error('not_found', 404);
        const file = await organizerSpreadsheet(result.competition, result.registrations, result.responsible);
        return new Response(file, {
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'content-disposition': `attachment; filename="inscriptions-${result.competition.startDate}-${result.competition.id}.xlsx"`,
            'cache-control': 'no-store',
          },
        });
      }),
    },

    [API_ROUTES.adminRegistration]: {
      PATCH: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminRegistration>, admin) => {
        const id = Number(request.params.registrationId);
        if (!Number.isInteger(id)) return error('not_found', 404);
        const body = await readJson(request);
        if (!body) return error('invalid_request', 400);
        return updated(
          await adminRegistrations.updateRegistration(admin, id, {
            status: body.status,
            paymentStatus: body.paymentStatus,
            clubNote: body.clubNote,
          }),
        );
      }),
    },

    [API_ROUTES.adminPaymentReference]: {
      PATCH: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminPaymentReference>, admin) => {
        const body = await readJson(request);
        if (!body) return error('invalid_request', 400);
        return updated(
          await adminRegistrations.updatePaymentReference(admin, request.params.paymentReference, {
            status: body.status,
            paymentStatus: body.paymentStatus,
          }),
        );
      }),
    },

    [API_ROUTES.adminMembers]: {
      GET: asAdmin(async () =>
        Response.json({ members: (await clubMembers.list()).map(toAdminMemberDto) } satisfies ListAdminMembersResponse),
      ),
    },

    [API_ROUTES.adminMember]: {
      PATCH: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminMember>, admin) => {
        const body = await readJson(request);
        if (typeof body?.isActive !== 'boolean') return error('invalid_request', 400);
        const result = await clubMembers.setActive(admin, request.params.licenceNumber, body.isActive);
        return result.ok ? new Response(null, { status: 204 }) : error(result.reason, STATUS_BY_REASON[result.reason]);
      }),
    },

    [API_ROUTES.adminMemberAdminRights]: {
      POST: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminMemberAdminRights>) => {
        const result = await adminAccounts.grant(request.params.licenceNumber);
        if (!result.ok) return error(result.reason, STATUS_BY_REASON[result.reason]);
        return Response.json({ password: result.password } satisfies GrantAdminResponse, {
          headers: { 'cache-control': 'no-store' },
        });
      }),
      DELETE: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminMemberAdminRights>, admin) => {
        const result = await adminAccounts.revoke(admin, request.params.licenceNumber);
        return result.ok ? new Response(null, { status: 204 }) : error(result.reason, STATUS_BY_REASON[result.reason]);
      }),
    },

    [API_ROUTES.adminMemberImport]: {
      GET: asAdmin(async () => Response.json((await clubMembers.status()) satisfies MemberImportStatusResponse)),
      /** Multipart form with a `file` field. The file is read in memory and never written to disk. */
      POST: asAdmin(async (request: BunRequest, admin) => {
        let file: unknown;
        try {
          file = (await request.formData()).get('file');
        } catch {
          return error('invalid_request', 400);
        }
        if (!(file instanceof Blob)) return error('invalid_request', 400);
        if (file.size > MAX_MEMBER_EXPORT_BYTES) {
          return Response.json(memberExportError(new MemberExportError('too_large', 'The file is too large.')), {
            status: 400,
          });
        }

        let archers: Archer[];
        try {
          archers = await readMemberExport(Buffer.from(await file.arrayBuffer()));
        } catch (cause) {
          if (cause instanceof MemberExportError) return Response.json(memberExportError(cause), { status: 400 });
          throw cause;
        }
        await clubMembers.import(archers, admin.licenceNumber);
        const status = await clubMembers.status();
        return Response.json({ ...status, lastImport: status.lastImport! } satisfies MemberImportResponse);
      }),
    },

    [API_ROUTES.adminScraper]: {
      GET: asAdmin(async () => Response.json(await scraperStatus(), { headers: { 'cache-control': 'no-store' } })),
    },

    [API_ROUTES.adminScraperEvents]: {
      GET: asAdmin(async (request: BunRequest, _admin, server) => scraperEvents(request, server)),
    },

    [API_ROUTES.adminScraperRuns]: {
      /** `{ kind: 'full' }` or `{ kind: 'competition', fftaId }`. Answers at once: the run goes on in its process. */
      POST: asAdmin(async (request: BunRequest, admin) => {
        const body = await readJson(request);
        const result = await scraperRuns.start({ kind: body?.kind, fftaId: body?.fftaId }, admin);
        if (result.ok) {
          return Response.json({ run: toScraperRunDto(result.run) } satisfies StartScraperRunResponse, { status: 202 });
        }
        if (result.reason === 'scraper_busy') {
          return Response.json(
            { error: 'scraper_busy', run: toScraperRunDto(result.run) } satisfies ScraperBusyResponse,
            { status: STATUS_BY_REASON.scraper_busy },
          );
        }
        return error(result.reason, STATUS_BY_REASON[result.reason]);
      }),
    },
  };
}

function updated(result: UpdateResult): Response {
  return result.ok ? new Response(null, { status: 204 }) : error(result.reason, STATUS_BY_REASON[result.reason]);
}

function memberExportError({ problem, line, detail }: MemberExportError): MemberExportErrorResponse {
  return { error: 'invalid_member_export', problem, line, detail };
}
