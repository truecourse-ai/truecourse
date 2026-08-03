/**
 * OUTBOUND REQUEST CONSTRUCTION.
 *
 * The sources below replicate the `speced-api` bench shapes verbatim in miniature,
 * because that is where the failure was measured: the app asks its upstream for
 * `timeformat=unixtime` and then validates every observation field as a finite
 * NUMBER, while the scenario stubbing it scripted the vendor's DEFAULT (iso8601,
 * string) payload — so the app rejected its own stub and the scenario failed 502.
 * Every assertion here is a fact the authoring prompt needs to state for that stub
 * to have been written correctly.
 */

import { describe, it, expect } from 'vitest';
import { parseCode } from '../../packages/analyzer/src/parser';
import { extractOutboundRequests } from '../../packages/analyzer/src/extractors/outbound-requests';
import { collectOutboundRequests } from '../../packages/analyzer/src/outbound-requests';
import type { FileAnalysis } from '../../packages/shared/src/types/analysis';

function extract(code: string, filePath = '/repo/src/upstream/forecast.ts') {
  return extractOutboundRequests(parseCode(code, 'typescript'), filePath, 'typescript');
}

/** The bench's forecast upstream, reduced to the shape that matters. */
const FORECAST_UPSTREAM = `
  export async function fetchForecast(latitude: number, longitude: number, baseUrl: string, timeoutMs: number) {
    const url = new URL('/v1/forecast', baseUrl);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('timeformat', 'unixtime');
    url.searchParams.set('temperature_unit', upstreamUnits.temperature);

    const payload = await fetchJson(url.toString(), timeoutMs);
    if (!isRecord(payload)) throw upstreamUnavailable();

    const current = payload['current'];
    const timezone = payload['timezone'];
    const resolvedLat = asFiniteNumber(payload['latitude']);
    if (!isRecord(current) || typeof timezone !== 'string') throw upstreamUnavailable();

    return {
      latitude: resolvedLat,
      time: asFiniteNumber(current['time']),
      weatherCode: asFiniteNumber(current['weather_code']),
    };
  }
`;

describe('extractOutboundRequests — request construction', () => {
  it('harvests the path literal, every literal query key, and the unresolved base', () => {
    const [request] = extract(FORECAST_UPSTREAM);
    expect(request.pathLiteral).toBe('/v1/forecast');
    expect(request.method).toBe('GET');
    // The base arrives as a parameter — naming a service would need a cross-file
    // inference, so the expression is recorded verbatim and nothing is claimed.
    expect(request.urlRef).toEqual({ baseExpr: 'baseUrl' });
    expect(request.queryParams).toEqual([
      { key: 'latitude', value: '<dynamic>' },
      { key: 'longitude', value: '<dynamic>' },
      { key: 'timezone', value: 'auto' },
      { key: 'timeformat', value: 'unixtime' },
      { key: 'temperature_unit', value: '<dynamic>' },
    ]);
  });

  it('reads response fields through the local wrapper, hinting the ones it validates', () => {
    const [request] = extract(FORECAST_UPSTREAM);
    expect(request.responseFieldsRead).toEqual([
      { path: 'current', hint: 'object' },
      { path: 'timezone', hint: 'string' },
      { path: 'latitude', hint: 'number' },
      { path: 'current.time', hint: 'number' },
      { path: 'current.weather_code', hint: 'number' },
    ]);
  });

  it('follows an index alias into an array payload', () => {
    const [request] = extract(`
      export async function geocode(city: string, baseUrl: string) {
        const url = new URL('/v1/search', baseUrl);
        url.searchParams.set('name', city);
        url.searchParams.set('count', '1');
        const payload = await fetchJson(url.toString(), 1000);
        const results = payload['results'];
        if (!Array.isArray(results)) throw upstreamUnavailable();
        const first = results[0];
        const name = first['name'];
        const latitude = asFiniteNumber(first['latitude']);
        if (typeof name !== 'string') throw upstreamUnavailable();
        return { name, latitude };
      }
    `);
    expect(request.responseFieldsRead).toEqual([
      { path: 'results', hint: 'array' },
      { path: 'results[0]' },
      { path: 'results[0].name', hint: 'string' },
      { path: 'results[0].latitude', hint: 'number' },
    ]);
    // `results.length` and `results.map(…)` are JavaScript, not payload fields.
    expect(request.responseFieldsRead.map((f) => f.path)).not.toContain('results.length');
  });

  it('reads the method and literal headers off a fetch in the same function', () => {
    const [request] = extract(`
      export async function push(baseUrl: string, event: unknown) {
        const url = new URL('/v2/events', baseUrl);
        const response = await fetch(url.toString(), {
          method: 'post',
          headers: { accept: 'application/json', 'x-api-version': '2' },
          body: JSON.stringify(event),
        });
        const data = await response.json();
        return data['id'];
      }
    `);
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual([
      { name: 'accept', value: 'application/json' },
      { name: 'x-api-version', value: '2' },
    ]);
    // `await res.json()` is the payload; the awaited `fetch` binds a Response.
    expect(request.responseFieldsRead).toEqual([{ path: 'id' }]);
  });

  it('resolves an absolute literal to its host and path', () => {
    const [request] = extract(`
      export async function ping() {
        const url = new URL('https://api.stripe.com/v1/charges');
        return fetch(url.toString());
      }
    `);
    expect(request.urlRef.host).toBe('api.stripe.com');
    expect(request.pathLiteral).toBe('/v1/charges');
  });

  it('reads an env var when the base expression IS the env read', () => {
    const [request] = extract(`
      export async function send(payload: unknown) {
        const url = new URL('/v1/messages', process.env.MAILER_BASE_URL);
        url.searchParams.set('mode', 'live');
        return fetch(url.toString(), { method: 'POST' });
      }
    `);
    expect(request.urlRef.envVar).toBe('MAILER_BASE_URL');
  });

  it('never claims response fields when one function builds two requests', () => {
    const requests = extract(`
      export async function both(baseUrl: string) {
        const a = new URL('/one', baseUrl);
        const b = new URL('/two', baseUrl);
        a.searchParams.set('x', '1');
        b.searchParams.set('y', '2');
        const payload = await fetchJson(a.toString(), 10);
        return payload['field'];
      }
    `);
    expect(requests).toHaveLength(2);
    // The query stays bound by RECEIVER — but nothing in the source says which
    // request the payload came from, so no field is attributed to either.
    expect(requests[0].queryParams).toEqual([{ key: 'x', value: '1' }]);
    expect(requests[1].queryParams).toEqual([{ key: 'y', value: '2' }]);
    expect(requests.every((r) => r.responseFieldsRead.length === 0)).toBe(true);
  });

  it('is not fooled by a `new URL` that addresses the filesystem', () => {
    // The bench does exactly this to find its migrations folder.
    expect(
      extract(`
        export function migrationsDir() {
          return new URL('../../drizzle', import.meta.url).pathname;
        }
      `),
    ).toEqual([]);
  });

  it('yields nothing for a language whose walk this slice does not do', () => {
    expect(
      extractOutboundRequests(
        parseCode("url = f'{base}/v1/forecast'", 'python'),
        '/repo/app.py',
        'python',
      ),
    ).toEqual([]);
  });
});

describe('collectOutboundRequests — the repo-level view', () => {
  const analyzed = (filePath: string, code: string): FileAnalysis => ({
    filePath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    httpCalls: [],
    outboundRequests: extract(code, filePath),
  });

  it('dedupes identical requests and orders by source location', () => {
    const requests = collectOutboundRequests([
      analyzed('/repo/src/b.ts', `async function f(baseUrl: string) { const u = new URL('/two', baseUrl); u.searchParams.set('k', 'v'); }`),
      analyzed('/repo/src/a.ts', `async function f(baseUrl: string) { const u = new URL('/one', baseUrl); u.searchParams.set('k', 'v'); }`),
      analyzed('/repo/src/a.ts', `async function g(baseUrl: string) { const u = new URL('/one', baseUrl); u.searchParams.set('k', 'v'); }`),
    ]);
    expect(requests.map((r) => r.pathLiteral)).toEqual(['/one', '/two']);
  });

  it('keeps a path-only request — the path is what a stub has to answer', () => {
    const requests = collectOutboundRequests([
      analyzed('/repo/src/a.ts', `async function f(baseUrl: string) { return fetch(new URL('/ping', baseUrl)); }`),
    ]);
    expect(requests.map((r) => r.pathLiteral)).toEqual(['/ping']);
  });

  it('drops a request that carries no fact a stub author could use', () => {
    // A computed path, no query, no reads. Rendering it would tell a stub author
    // nothing they could script against.
    expect(
      collectOutboundRequests([
        analyzed('/repo/src/a.ts', `async function f(p: string, baseUrl: string) { return fetch(new URL(p, baseUrl)); }`),
      ]),
    ).toEqual([]);
  });
});
