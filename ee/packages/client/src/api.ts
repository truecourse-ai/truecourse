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

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${serverUrl()}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}
