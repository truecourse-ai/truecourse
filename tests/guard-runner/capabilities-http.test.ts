/**
 * The `http` setup capability, unit level: the declaration schema, the stub
 * servers themselves (boot → serve → teardown), the `${HTTP_STUB:…}` origin
 * substitution, and the three violation kinds (unmatched / expect / calls).
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  GuardSetupSchema,
  GuardHttpStubSchema,
  type GuardHttpStubs,
} from '@truecourse/shared'
import {
  startHttpStubs,
  applyHttpStubOrigins,
  pathMatches,
  CapabilityError,
  applyUniqueSetup,
  type HttpStubsHandle,
} from '@truecourse/guard-runner'

const handles: HttpStubsHandle[] = []
afterEach(async () => {
  while (handles.length) await handles.pop()!.stop()
})

async function start(stubs: GuardHttpStubs): Promise<HttpStubsHandle> {
  const handle = await startHttpStubs(stubs)
  if (!handle) throw new Error('expected a handle')
  handles.push(handle)
  return handle
}

describe('setup.http — schema', () => {
  it('accepts a stub with scripted routes, request assertions and a call count', () => {
    const parsed = GuardSetupSchema.safeParse({
      env: { FORECAST_BASE_URL: '${HTTP_STUB:forecast}' },
      http: {
        forecast: {
          routes: [
            {
              method: 'GET',
              path: '/v1/forecast',
              status: 200,
              headers: { 'x-upstream': 'stub' },
              json: { current: { weather_code: 4 } },
              expect: {
                query: { timeformat: 'unixtime' },
                headers: { accept: 'application/json' },
              },
              calls: 1,
            },
          ],
          unmatched: '404',
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a route carrying both `body` and `json`', () => {
    const parsed = GuardHttpStubSchema.safeParse({
      routes: [{ method: 'GET', path: '/x', body: 'a', json: { a: 1 } }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a path that does not start with `/`, and an unknown key', () => {
    expect(GuardHttpStubSchema.safeParse({ routes: [{ method: 'GET', path: 'x' }] }).success).toBe(false)
    expect(
      GuardHttpStubSchema.safeParse({ routes: [{ method: 'GET', path: '/x', proxy: true }] }).success,
    ).toBe(false)
  })

  it('rejects a stub name that is not placeholder-safe', () => {
    const parsed = GuardSetupSchema.safeParse({ http: { 'fore cast': { routes: [{ method: 'GET', path: '/' }] } } })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty request assertion and a negative call count', () => {
    expect(
      GuardHttpStubSchema.safeParse({ routes: [{ method: 'GET', path: '/x', expect: {} }] }).success,
    ).toBe(false)
    expect(
      GuardHttpStubSchema.safeParse({ routes: [{ method: 'GET', path: '/x', calls: -1 }] }).success,
    ).toBe(false)
    // `calls: 0` is meaningful — "the app must NEVER call this".
    expect(
      GuardHttpStubSchema.safeParse({ routes: [{ method: 'GET', path: '/x', calls: 0 }] }).success,
    ).toBe(true)
  })

  it('is additive — a scenario setup without `http` still parses', () => {
    expect(GuardSetupSchema.safeParse({ files: { 'a.txt': 'x' }, env: { A: '1' } }).success).toBe(true)
  })
})

describe('setup.http — route matching', () => {
  it('matches exactly, and matches a single trailing `*` against any remainder', () => {
    expect(pathMatches('/v1/forecast', '/v1/forecast')).toBe(true)
    expect(pathMatches('/v1/forecast', '/v1/forecast/')).toBe(false)
    expect(pathMatches('/v1/orders/*', '/v1/orders/42')).toBe(true)
    expect(pathMatches('/v1/orders/*', '/v1/orders/42/items')).toBe(true)
    expect(pathMatches('/v1/orders/*', '/v1/orders/')).toBe(false)
    expect(pathMatches('/v1/orders/*', '/v1/other/42')).toBe(false)
  })
})

describe('setup.http — boot, serve, teardown', () => {
  it('boots one loopback server per stub and serves the scripted response', async () => {
    const handle = await start({
      geo: { routes: [{ method: 'GET', path: '/v1/search', json: { results: [{ name: 'Berlin' }] } }] },
      forecast: {
        routes: [
          { method: 'POST', path: '/v1/forecast', status: 503, headers: { 'x-stub': 'yes' }, body: 'upstream down' },
        ],
      },
    })
    expect([...handle.origins.keys()].sort()).toEqual(['forecast', 'geo'])
    for (const origin of handle.origins.values()) expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    // Distinct ports — two stubs are two counterparties.
    expect(handle.origins.get('geo')).not.toBe(handle.origins.get('forecast'))

    const geo = await fetch(`${handle.origins.get('geo')}/v1/search?name=berlin`)
    expect(geo.status).toBe(200)
    expect(geo.headers.get('content-type')).toBe('application/json')
    expect(await geo.json()).toEqual({ results: [{ name: 'Berlin' }] })

    const forecast = await fetch(`${handle.origins.get('forecast')}/v1/forecast`, { method: 'POST', body: '{}' })
    expect(forecast.status).toBe(503)
    expect(forecast.headers.get('x-stub')).toBe('yes')
    expect(await forecast.text()).toBe('upstream down')

    expect(handle.settle()).toBeNull()
  })

  it('records every request it received', async () => {
    const handle = await start({ up: { routes: [{ method: 'POST', path: '/ingest', json: { ok: true } }] } })
    await fetch(`${handle.origins.get('up')}/ingest?run=1`, {
      method: 'POST',
      headers: { 'x-api-key': 'k1' },
      body: '{"a":1}',
    })
    const records = handle.records().get('up')!
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ method: 'POST', url: '/ingest?run=1', body: '{"a":1}', routeIndex: 0 })
    expect(records[0].headers['x-api-key']).toBe('k1')
  })

  it('stops every server on teardown', async () => {
    const handle = await startHttpStubs({ up: { routes: [{ method: 'GET', path: '/', body: 'hi' }] } })
    const origin = handle!.origins.get('up')!
    expect((await fetch(origin)).status).toBe(200)
    await handle!.stop()
    await expect(fetch(origin)).rejects.toThrow()
  })

  it('returns null (and costs nothing) when nothing is declared', async () => {
    expect(await startHttpStubs(undefined)).toBeNull()
    expect(await startHttpStubs({})).toBeNull()
  })
})

describe('setup.http — unmatched requests', () => {
  it('fails the scenario by default, naming the method and path received', async () => {
    const handle = await start({ up: { routes: [{ method: 'GET', path: '/known', body: 'ok' }] } })
    handle.markStep(3)
    const res = await fetch(`${handle.origins.get('up')}/unknown?x=1`, { method: 'DELETE' })
    expect(res.status).toBe(404)

    const violation = handle.settle()
    expect(violation).not.toBeNull()
    expect(violation!.kind).toBe('unmatched')
    expect(violation!.stub).toBe('up')
    expect(violation!.step).toBe(3)
    expect(violation!.actual).toContain('DELETE /unknown?x=1')
    expect(violation!.detail.join('\n')).toContain('DELETE /unknown?x=1')
  })

  it('tolerates it under `unmatched: "404"` — still answering 404', async () => {
    const handle = await start({
      up: { unmatched: '404', routes: [{ method: 'GET', path: '/known', body: 'ok' }] },
    })
    const res = await fetch(`${handle.origins.get('up')}/unknown`)
    expect(res.status).toBe(404)
    expect(handle.settle()).toBeNull()
  })
})

describe('setup.http — request assertions', () => {
  it('flags a missing body substring, with the received body excerpted', async () => {
    const handle = await start({
      up: { routes: [{ method: 'POST', path: '/x', expect: { bodyContains: ['needle'] }, json: { ok: true } }] },
    })
    // The scripted response is served anyway — the scenario's steps run to the end.
    const res = await fetch(`${handle.origins.get('up')}/x`, { method: 'POST', body: 'haystack' })
    expect(await res.json()).toEqual({ ok: true })

    const v = handle.settle()!
    expect(v.kind).toBe('expect')
    expect(v.expected).toContain('request body contains "needle"')
    expect(v.actual).toContain('haystack')
  })

  it('flags a wrong json path value and an absent one', async () => {
    const handle = await start({
      up: { routes: [{ method: 'POST', path: '/x', expect: { jsonPath: { 'order.total': 42 } } }] },
    })
    await fetch(`${handle.origins.get('up')}/x`, { method: 'POST', body: JSON.stringify({ order: { total: 7 } }) })
    const v = handle.settle()!
    expect(v.expected).toContain('json order.total equals 42')
    expect(v.actual).toContain('was 7')

    const missing = await start({
      up2: { routes: [{ method: 'POST', path: '/x', expect: { jsonPath: { 'order.total': 42 } } }] },
    })
    await fetch(`${missing.origins.get('up2')}/x`, { method: 'POST', body: JSON.stringify({}) })
    expect(missing.settle()!.actual).toContain('absent')
  })

  it('reports a non-JSON body when a jsonPath assertion is declared', async () => {
    const handle = await start({
      up: { routes: [{ method: 'POST', path: '/x', expect: { jsonPath: { a: 1 } } }] },
    })
    await fetch(`${handle.origins.get('up')}/x`, { method: 'POST', body: 'not json' })
    expect(handle.settle()!.actual).toContain('not JSON')
  })

  it('flags a wrong or missing header (case-insensitively matched)', async () => {
    const handle = await start({
      up: { routes: [{ method: 'GET', path: '/x', expect: { headers: { 'X-Api-Key': 'right' } } }] },
    })
    await fetch(`${handle.origins.get('up')}/x`, { headers: { 'x-api-key': 'wrong' } })
    const v = handle.settle()!
    expect(v.expected).toContain('header "X-Api-Key" is "right"')
    expect(v.actual).toContain('"wrong"')
  })

  it('flags a wrong or missing query parameter', async () => {
    const handle = await start({
      up: { routes: [{ method: 'GET', path: '/x', expect: { query: { units: 'metric' } } }] },
    })
    await fetch(`${handle.origins.get('up')}/x?units=imperial`)
    expect(handle.settle()!.actual).toContain('"imperial"')
  })

  it('passes when every declared assertion holds', async () => {
    const handle = await start({
      up: {
        routes: [
          {
            method: 'POST',
            path: '/v1/orders/*',
            expect: {
              query: { mode: 'live' },
              headers: { authorization: 'Bearer t' },
              bodyContains: ['"total"'],
              jsonPath: { 'items[0].sku': 'abc' },
            },
            status: 201,
            json: { id: 1 },
          },
        ],
      },
    })
    const res = await fetch(`${handle.origins.get('up')}/v1/orders/42?mode=live`, {
      method: 'POST',
      headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ total: 10, items: [{ sku: 'abc' }] }),
    })
    expect(res.status).toBe(201)
    expect(handle.settle()).toBeNull()
  })
})

describe('setup.http — call counts', () => {
  it('settles a count mismatch with expected vs actual, listing what arrived', async () => {
    const handle = await start({ up: { routes: [{ method: 'GET', path: '/x', calls: 2, body: 'ok' }] } })
    await fetch(`${handle.origins.get('up')}/x`)
    const v = handle.settle()!
    expect(v.kind).toBe('calls')
    expect(v.step).toBeUndefined()
    expect(v.expected).toContain('2 time(s)')
    expect(v.actual).toContain('1 time(s)')
    expect(v.detail.join('\n')).toContain('GET /x')
  })

  it('passes on the exact count, and enforces `calls: 0` as "never called"', async () => {
    const exact = await start({ up: { routes: [{ method: 'GET', path: '/x', calls: 2, body: 'ok' }] } })
    await fetch(`${exact.origins.get('up')}/x`)
    await fetch(`${exact.origins.get('up')}/x`)
    expect(exact.settle()).toBeNull()

    const never = await start({ up2: { routes: [{ method: 'GET', path: '/x', calls: 0, body: 'ok' }] } })
    expect(never.settle()).toBeNull()
    await fetch(`${never.origins.get('up2')}/x`)
    expect(never.settle()!.kind).toBe('calls')
  })

  it('reports request-level violations before the end-of-scenario counts', async () => {
    const handle = await start({
      up: { routes: [{ method: 'GET', path: '/x', calls: 5, expect: { headers: { a: 'b' } }, body: 'ok' }] },
    })
    await fetch(`${handle.origins.get('up')}/x`)
    expect(handle.settle()!.kind).toBe('expect')
  })
})

describe('setup.http — ${HTTP_STUB:…} substitution', () => {
  it('substitutes each stub origin into setup.env VALUES without mutating the input', async () => {
    const handle = await start({ geo: { routes: [{ method: 'GET', path: '/', body: '' }] } })
    const setup = {
      env: { GEO_BASE_URL: '${HTTP_STUB:geo}', GEO_SEARCH: '${HTTP_STUB:geo}/v1/search', PLAIN: 'x' },
      files: { 'a.txt': 'x' },
    }
    const applied = applyHttpStubOrigins(setup, handle.origins)!
    const origin = handle.origins.get('geo')!
    expect(applied.env).toEqual({ GEO_BASE_URL: origin, GEO_SEARCH: `${origin}/v1/search`, PLAIN: 'x' })
    expect(applied.files).toEqual({ 'a.txt': 'x' })
    // The scenario-owned template is untouched, so every run substitutes its own port.
    expect(setup.env.GEO_BASE_URL).toBe('${HTTP_STUB:geo}')
  })

  it('raises a CapabilityError naming the undeclared stub', async () => {
    const handle = await start({ geo: { routes: [{ method: 'GET', path: '/', body: '' }] } })
    try {
      applyHttpStubOrigins({ env: { FORECAST: '${HTTP_STUB:forecast}' } }, handle.origins)
      throw new Error('expected a CapabilityError')
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError)
      expect((e as CapabilityError).capability).toBe('http')
      expect((e as Error).message).toContain('no stub named "forecast"')
    }
  })

  it('leaves a setup without env untouched', async () => {
    const handle = await start({ geo: { routes: [{ method: 'GET', path: '/', body: '' }] } })
    const setup = { files: { 'a.txt': 'x' } }
    expect(applyHttpStubOrigins(setup, handle.origins)).toBe(setup)
    expect(applyHttpStubOrigins(undefined, handle.origins)).toBeUndefined()
  })
})

describe('setup.http — ${unique} interpolation', () => {
  it('resolves ${unique} across the stub declaration, so assertions match what the app sent', () => {
    const resolved = applyUniqueSetup(
      {
        env: { BASE: '${HTTP_STUB:vendor}' },
        http: {
          vendor: {
            routes: [
              {
                method: 'POST',
                path: '/v1/teams/team-${unique}',
                headers: { 'x-echo': 'team-${unique}' },
                json: { name: 'team-${unique}', nested: [{ deep: 'team-${unique}' }] },
                expect: {
                  bodyContains: ['team-${unique}'],
                  query: { slug: 'team-${unique}' },
                  headers: { 'x-team': 'team-${unique}' },
                  jsonPath: { name: 'team-${unique}' },
                },
              },
            ],
          },
        },
      },
      'abc123',
    )!
    const route = resolved.http!.vendor.routes[0]
    expect(route.path).toBe('/v1/teams/team-abc123')
    expect(route.headers).toEqual({ 'x-echo': 'team-abc123' })
    expect(route.json).toEqual({ name: 'team-abc123', nested: [{ deep: 'team-abc123' }] })
    expect(route.expect).toEqual({
      bodyContains: ['team-abc123'],
      query: { slug: 'team-abc123' },
      headers: { 'x-team': 'team-abc123' },
      jsonPath: { name: 'team-abc123' },
    })
    // The stub PLACEHOLDER is not a `${unique}` token — it survives untouched.
    expect(resolved.env!.BASE).toBe('${HTTP_STUB:vendor}')
  })
})
