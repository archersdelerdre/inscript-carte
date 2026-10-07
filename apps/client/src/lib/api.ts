import type { ApiError } from '@inscript-carte/shared';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError['error'] | 'network' };

/** JSON calls to our API. Errors come back as a code, never thrown, so each screen picks its French message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const body: unknown = await response.json();
    return response.ok ? { ok: true, data: body as T } : { ok: false, error: (body as ApiError).error };
  } catch {
    return { ok: false, error: 'network' };
  }
}
