/**
 * The one HTTP call both Atlassian drivers make: Basic auth
 * (`accountEmail:apiToken`) over the global `fetch`, JSON in and JSON out, with
 * the rate limiting Atlassian is aggressive about handled here rather than in
 * each driver — `429`, and `503` carrying a `Retry-After`, are retried a bounded
 * number of times honoring the header.
 *
 * A non-OK answer becomes an {@link UpstreamHttpError} carrying a SHORT,
 * user-facing reason each product's own `describe` derives from the body. What
 * never travels in it: the token, the URL, the path, the JQL, or the raw JSON
 * — the reason is read by a person on the Context page, and a failed sync
 * stores it verbatim.
 */

/** How many times a rate-limited request is retried before it surfaces. */
const RETRY_LIMIT = 3;

/** A call to Atlassian came back not-OK. The status rides along for the route. */
export class UpstreamHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}

export interface AtlassianCredentials {
  baseUrl: string;
  accountEmail: string;
  apiToken: string;
}

export function authHeader(credentials: AtlassianCredentials): string {
  return (
    'Basic ' +
    Buffer.from(`${credentials.accountEmail}:${credentials.apiToken}`).toString('base64')
  );
}

/** Milliseconds to wait before a retry, honoring `Retry-After` (seconds). */
function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const secs = header != null ? Number(header) : NaN;
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 60) * 1000;
  // No usable header — a short exponential backoff instead.
  return Math.min(2 ** attempt, 30) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AtlassianRequest {
  credentials: AtlassianCredentials;
  /** The absolute URL to read. */
  url: string;
  /** A short, user-facing reason for a non-OK answer. */
  describe(status: number, statusText: string, body: string): string;
  /** How long a retry may sleep; a test pins it to nothing. */
  sleepMs?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/** One GET, retried while Atlassian says to wait, or a refusal that says why. */
export async function getJson<T>(request: AtlassianRequest): Promise<T> {
  const wait = request.sleepMs ?? sleep;
  for (let attempt = 0; ; attempt++) {
    request.signal?.throwIfAborted();
    const res = await fetch(request.url, {
      headers: { Authorization: authHeader(request.credentials), Accept: 'application/json' },
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || (res.status === 503 && res.headers.has('retry-after'));
    if (retryable && attempt < RETRY_LIMIT) {
      await wait(retryAfterMs(res, attempt));
      continue;
    }
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* no body */
    }
    throw new UpstreamHttpError(
      request.describe(res.status, res.statusText, body),
      res.status,
      res.statusText,
    );
  }
}

/**
 * Normalize an Atlassian timestamp to real ISO-8601. Jira emits a `-0700`
 * offset, which `Date` does not reliably accept elsewhere in the pipeline, so
 * every stamp that leaves a driver is a `Z` form.
 */
export function isoOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** YAML-quote a value that could otherwise parse as something else. */
export function yamlValue(raw: string): string {
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The id a source of `<tool>` reading `<key>` on `<site>` takes: one clean ref
 * segment (`context/<sourceId>/<docPath>` is also a directory name), and unique
 * per (site, key) so two projects of one site never collide.
 */
export function atlassianSourceId(tool: string, baseUrl: string, key: string): string {
  const host = new URL(baseUrl).host;
  return `${tool}-${slug(host)}-${slug(key)}`;
}

/** Lowercase, and everything that is not a ref segment character joined by `-`. */
function slug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
