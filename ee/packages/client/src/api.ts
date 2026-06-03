/**
 * Minimal authenticated fetch for the enterprise client pages. Resolves
 * the API base the same way the OSS client does (dev: client :3000 →
 * API :3001; prod: same origin) and sends the session cookie.
 */

function serverUrl(): string {
  if (typeof window === 'undefined') return '';
  const port = window.location.port;
  if (port && port !== '3001') {
    return `http://${window.location.hostname}:3001`;
  }
  return '';
}

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
export const delJson = <T>(path: string): Promise<T> => send<T>('DELETE', path);
