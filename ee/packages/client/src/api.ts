/**
 * Minimal authenticated fetch for the enterprise client pages. Sends the
 * session cookie, and resolves the API base through the OSS client's helper
 * rather than a copy of it — one rule for both halves of the app, so a built
 * enterprise page reaches the origin that served it just like an OSS page does.
 */

import { getServerUrl } from '@/lib/server-url';

/** The API base, under this package's local name. */
export const serverUrl = getServerUrl;

/** Surface a server-sent `{ error }` message when a request fails. */
async function failure(res: Response): Promise<Error> {
  let msg = `Request failed: ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) msg = body.error;
  } catch {
    // non-JSON body — keep the status message
  }
  return new Error(msg);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, { credentials: 'include' });
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

/** Like `getJson`, but a 404 resolves to `null` (e.g. "no scan run yet"). */
export async function getJsonAllow404<T>(path: string): Promise<T | null> {
  const res = await fetch(`${serverUrl()}${path}`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

export const postJson = <T>(path: string, body?: unknown): Promise<T> =>
  send<T>('POST', path, body);
export const patchJson = <T>(path: string, body?: unknown): Promise<T> =>
  send<T>('PATCH', path, body);
export const delJson = <T>(path: string, body?: unknown): Promise<T> =>
  send<T>('DELETE', path, body);
