import type { ApiError } from '@inscript-carte/shared';

/** The part of Bun's server the routes use. */
export type ClientAddressSource = { requestIP(request: Request): { address: string } | null };

export const STATUS_BY_REASON = {
  not_found: 404,
  invalid_request: 400,
  registration_closed: 409,
  already_registered: 409,
  cannot_withdraw: 409,
  status_change_not_allowed: 409,
  cannot_change_self: 409,
  member_inactive: 409,
  already_admin: 409,
  scraper_busy: 409,
  scraper_unavailable: 503,
} as const satisfies Partial<Record<ApiError['error'], number>>;

export function error(code: ApiError['error'], status: number): Response {
  return Response.json({ error: code } satisfies ApiError, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Behind a reverse proxy, the original protocol comes in a header. */
export function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}
