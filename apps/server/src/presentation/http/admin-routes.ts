import {
  API_ROUTES,
  type AdminCompetitionRegistrationsResponse,
  type AdminSessionResponse,
  type ListAdminCompetitionsResponse,
  type MemberExportErrorResponse,
  type MemberImportResponse,
  type MemberImportStatusResponse,
} from '@inscript-carte/shared';
import type { BunRequest } from 'bun';

import type { AdminAuthentication } from '../../application/admin-authentication.ts';
import type { AdminRegistrations, UpdateResult } from '../../application/admin-registrations.ts';
import type { MemberListImport } from '../../application/member-list-import.ts';
import type { Archer } from '../../domain/archer.ts';
import type { Competition } from '../../domain/competition.ts';
import type { RegistrationDetails } from '../../domain/registration-repository.ts';
import { MemberExportError } from '../../infrastructure/members/ffta-member-export.ts';
import { error, isHttps, readJson, STATUS_BY_REASON, type ClientAddressSource } from './http.ts';
import { toAdminCompetitionDto, toAdminRegistrationDto } from './presenters.ts';

const ADMIN_COOKIE = 'admin_session';
/** The admin cookie is only sent to the admin API. */
const ADMIN_COOKIE_PATH = '/api/admin';
/** The FFTA export of 108 members is about 20 KB. */
const MAX_MEMBER_EXPORT_BYTES = 5 * 1024 * 1024;

export type AdminHttpDependencies = {
  /** The member session: the first step of the admin sign-in. */
  signedInArcher: (request: BunRequest) => Promise<Archer | null>;
  adminAuthentication: AdminAuthentication;
  adminRegistrations: AdminRegistrations;
  memberListImport: MemberListImport;
  readMemberExport: (bytes: Buffer) => Promise<Archer[]>;
  organizerSpreadsheet: (competition: Competition, registrations: readonly RegistrationDetails[]) => Promise<Buffer>;
};

export function createAdminRoutes({
  signedInArcher,
  adminAuthentication,
  adminRegistrations,
  memberListImport,
  readMemberExport,
  organizerSpreadsheet,
}: AdminHttpDependencies) {
  /** Every admin route but the sign-in goes through this check first. */
  function asAdmin<Request extends BunRequest>(handler: (request: Request, admin: Archer) => Promise<Response>) {
    return async (request: Request) => {
      const admin = await adminAuthentication.signedInAdmin(request.cookies.get(ADMIN_COOKIE) ?? null);
      return admin ? handler(request, admin) : error('admin_sign_in_required', 401);
    };
  }

  return {
    [API_ROUTES.adminSession]: {
      GET: asAdmin(async (_, admin) =>
        Response.json({
          admin: { licenceNumber: admin.licenceNumber, fullName: admin.fullName },
        } satisfies AdminSessionResponse),
      ),
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
          admin: { licenceNumber: member.licenceNumber, fullName: member.fullName },
        } satisfies AdminSessionResponse);
      },
      DELETE: async (request: BunRequest) => {
        await adminAuthentication.signOut(request.cookies.get(ADMIN_COOKIE) ?? null);
        request.cookies.delete({ name: ADMIN_COOKIE, path: ADMIN_COOKIE_PATH });
        return new Response(null, { status: 204 });
      },
    },

    [API_ROUTES.adminCompetitions]: {
      GET: asAdmin(async () => {
        const competitions = await adminRegistrations.competitions();
        return Response.json({
          competitions: competitions.map(toAdminCompetitionDto),
        } satisfies ListAdminCompetitionsResponse);
      }),
    },

    [API_ROUTES.adminCompetitionRegistrations]: {
      GET: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminCompetitionRegistrations>) => {
        const result = await adminRegistrations.competitionRegistrations(request.params.competitionId);
        if (!result) return error('not_found', 404);
        return Response.json({
          competition: toAdminCompetitionDto(result.competition),
          registrations: result.registrations.map(toAdminRegistrationDto),
        } satisfies AdminCompetitionRegistrationsResponse);
      }),
    },

    [API_ROUTES.adminCompetitionExport]: {
      GET: asAdmin(async (request: BunRequest<typeof API_ROUTES.adminCompetitionExport>) => {
        const result = await adminRegistrations.organizerList(request.params.competitionId);
        if (!result) return error('not_found', 404);
        const file = await organizerSpreadsheet(result.competition, result.registrations);
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

    [API_ROUTES.adminMemberImport]: {
      GET: asAdmin(async () => Response.json((await memberListImport.status()) satisfies MemberImportStatusResponse)),
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
        await memberListImport.execute(archers, admin.licenceNumber);
        const status = await memberListImport.status();
        return Response.json({ ...status, lastImport: status.lastImport! } satisfies MemberImportResponse);
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
