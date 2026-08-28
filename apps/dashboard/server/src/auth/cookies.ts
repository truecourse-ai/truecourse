/**
 * Tiny dependency-free Cookie header helpers. We only need to read one
 * named cookie and serialize one Set-Cookie value, so a full cookie lib
 * isn't warranted.
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    const v = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      // Percent-encoding is a convention, not a guarantee: a lone `%` makes
      // decodeURIComponent throw. Browsers send every cookie set for the host
      // (ports are ignored), so one malformed unrelated cookie must not break
      // parsing of the session cookie — nor throw out of a request handler.
      // A malformed session value simply fails verification downstream.
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  secure?: boolean;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  }
  return parts.join('; ');
}
