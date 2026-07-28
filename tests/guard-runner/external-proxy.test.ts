/**
 * The `externals` capability in isolation (item 64) — the always-on proxy in front
 * of a PROVIDED external account: forwarding fidelity, the fault vocabulary
 * (forced response, delay, refusal, per-call sequencing), the shared per-service
 * script + call log across a multi-endpoint service, the `calls` assertion, and the
 * schema rows that keep the authored vocabulary closed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { startExternalProxies, CapabilityError } from '@truecourse/guard-runner'
import { GuardSetupSchema } from '@truecourse/shared'

/** One recorded upstream hit, as the fake "real service" saw it. */
interface UpstreamHit {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

interface Upstream {
  origin: string
  hits: UpstreamHit[]
  close: () => Promise<void>
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

/** A stand-in for the REAL third party the proxy forwards to. */
async function upstream(
  handler?: (hit: UpstreamHit, res: http.ServerResponse) => void,
): Promise<Upstream> {
  const hits: UpstreamHit[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const hit: UpstreamHit = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      }
      hits.push(hit)
      if (handler) return handler(hit, res)
      res.writeHead(200, { 'content-type': 'application/json', 'x-upstream': 'yes' })
      res.end(JSON.stringify({ ok: true, saw: hit.url }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const close = (): Promise<void> => new Promise((r) => server.close(() => r()))
  cleanups.push(close)
  return { origin, hits, close }
}

/** Start proxies for one service, registering their teardown. */
async function proxies(
  endpoints: { envVar: string; url: string }[],
  scripts?: Record<string, unknown>,
  overriddenEnv?: string[],
) {
  const handle = await startExternalProxies({
    targets: [{ service: 'vendor', endpoints }],
    scripts: scripts as never,
    ...(overriddenEnv ? { overriddenEnv } : {}),
  })
  if (!handle) throw new Error('expected proxies to start')
  cleanups.push(() => handle.stop())
  return handle
}

describe('external proxy — forwarding fidelity', () => {
  it('forwards method, path, query, headers and body verbatim, and streams the answer back', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }])

    const res = await fetch(`${h.env.BASE}/v1/forecast?lat=52.5&lon=13.4`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'k-123', authorization: 'Bearer t' },
      body: JSON.stringify({ hello: 'world' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-upstream')).toBe('yes')
    expect(await res.json()).toEqual({ ok: true, saw: '/v1/forecast?lat=52.5&lon=13.4' })

    expect(up.hits).toHaveLength(1)
    const hit = up.hits[0]
    expect(hit.method).toBe('POST')
    expect(hit.url).toBe('/v1/forecast?lat=52.5&lon=13.4')
    expect(hit.headers['x-api-key']).toBe('k-123')
    expect(hit.headers['authorization']).toBe('Bearer t')
    expect(hit.body).toBe('{"hello":"world"}')
  })

  it('rewrites Host to the upstream authority and never relays a hop-by-hop header', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }])
    const proxyHost = new URL(h.env.BASE).host

    await fetch(`${h.env.BASE}/x`, { headers: { 'proxy-authorization': 'nope', te: 'trailers' } })

    const hit = up.hits[0]
    // The app addressed the proxy; the real service must see its OWN name.
    expect(hit.headers.host).toBe(new URL(up.origin).host)
    expect(hit.headers.host).not.toBe(proxyHost)
    expect(hit.headers['proxy-authorization']).toBeUndefined()
    expect(hit.headers['te']).toBeUndefined()
  })

  it('appends the app path to a base URL that carries a path prefix', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: `${up.origin}/api/v2` }])
    await fetch(`${h.env.BASE}/things?a=1`)
    expect(up.hits[0].url).toBe('/api/v2/things?a=1')
  })

  it('streams a large response body through unchanged', async () => {
    const payload = 'x'.repeat(300_000)
    const up = await upstream((_hit, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      // Written in chunks: the proxy must relay a stream, not one buffered blob.
      for (let i = 0; i < 3; i++) res.write(payload.slice(0, 100_000))
      res.end()
    })
    const h = await proxies([{ envVar: 'BASE', url: up.origin }])
    const text = await (await fetch(`${h.env.BASE}/big`)).text()
    expect(text).toHaveLength(300_000)
  })

  it('an unreachable REAL service breaks the connection — never an invented 502', async () => {
    const up = await upstream()
    const dead = up.origin
    await up.close()
    const h = await proxies([{ envVar: 'BASE', url: dead }])
    await expect(fetch(`${h.env.BASE}/x`)).rejects.toThrow()
  })

  it('returns null when nothing is provided and nothing is scripted', async () => {
    expect(await startExternalProxies({ targets: [], scripts: undefined })).toBeNull()
  })
})

describe('external proxy — the fault vocabulary', () => {
  it('respond serves the scripted answer and never reaches the upstream', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ respond: { status: 503, json: { error: 'melted' } } }] },
    })
    const res = await fetch(`${h.env.BASE}/v1/forecast`)
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ error: 'melted' })
    expect(up.hits).toHaveLength(0)
  })

  it('respond can serve a raw body with its own headers', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ respond: { status: 500, body: 'gateway down', headers: { 'x-vendor': 'a' } } }] },
    })
    const res = await fetch(`${h.env.BASE}/x`)
    expect(res.status).toBe(500)
    expect(res.headers.get('x-vendor')).toBe('a')
    expect(await res.text()).toBe('gateway down')
  })

  it('delayMs composes with passthrough — the call is late, then real', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ delayMs: 250 }] },
    })
    const started = Date.now()
    const res = await fetch(`${h.env.BASE}/slow`)
    expect(Date.now() - started).toBeGreaterThanOrEqual(200)
    expect(res.status).toBe(200)
    expect(up.hits).toHaveLength(1)
  })

  it('refuse destroys the connection unanswered', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ refuse: true }] },
    })
    await expect(fetch(`${h.env.BASE}/x`)).rejects.toThrow()
    expect(up.hits).toHaveLength(0)
  })

  it('once fires one call and steps aside — fail-then-recover', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ refuse: true, once: true }] },
    })
    await expect(fetch(`${h.env.BASE}/x`)).rejects.toThrow()
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(200)
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(200)
    expect(up.hits).toHaveLength(2)
  })

  it('an exhausted rule list falls through to passthrough', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: {
        faults: [
          { respond: { status: 500, body: 'one' }, once: true },
          { respond: { status: 502, body: 'two' }, once: true },
        ],
      },
    })
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(500)
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(502)
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(200)
  })

  it('match narrows by method and by path, trailing-* included', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: {
        faults: [
          { match: { method: 'POST', path: '/v1/charge' }, respond: { status: 402, body: 'no' } },
          { match: { path: '/v1/orders/*' }, respond: { status: 418, body: 'teapot' } },
        ],
      },
    })
    expect((await fetch(`${h.env.BASE}/v1/charge`, { method: 'POST' })).status).toBe(402)
    // Same path, different method → no rule applies.
    expect((await fetch(`${h.env.BASE}/v1/charge`)).status).toBe(200)
    expect((await fetch(`${h.env.BASE}/v1/orders/17`)).status).toBe(418)
    // The wildcard needs a remainder, and the query is never part of the match.
    expect((await fetch(`${h.env.BASE}/v1/orders`)).status).toBe(200)
    expect((await fetch(`${h.env.BASE}/v1/orders/9?x=1`)).status).toBe(418)
  })

  it('a match-only rule is an explicit passthrough, and it consumes like any other', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ match: { path: '/x' }, once: true }, { respond: { status: 503, body: 'later' } }] },
    })
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(200)
    expect((await fetch(`${h.env.BASE}/x`)).status).toBe(503)
  })
})

describe('external proxy — one script and one log per SERVICE', () => {
  it('every endpoint of a service gets its own port, sharing the fault script and the call log', async () => {
    const forecast = await upstream()
    const geocoding = await upstream()
    const h = await proxies(
      [
        { envVar: 'FORECAST_BASE_URL', url: forecast.origin },
        { envVar: 'GEOCODING_BASE_URL', url: geocoding.origin },
      ],
      { vendor: { faults: [{ respond: { status: 503, body: 'down' }, once: true }], calls: 3 } },
    )

    expect(h.env.FORECAST_BASE_URL).not.toBe(h.env.GEOCODING_BASE_URL)

    // The single `once` rule is consumed by whichever host is hit FIRST — one script
    // for one service, not one per host.
    expect((await fetch(`${h.env.GEOCODING_BASE_URL}/v1/search`)).status).toBe(503)
    expect((await fetch(`${h.env.FORECAST_BASE_URL}/v1/forecast`)).status).toBe(200)
    expect((await fetch(`${h.env.GEOCODING_BASE_URL}/v1/search`)).status).toBe(200)

    // …and one call log: the count spans both hosts, so `calls: 3` settles clean.
    expect(h.settle()).toBeNull()
    const records = h.records()
    expect(records).toHaveLength(3)
    expect(records.map((r) => r.envVar)).toEqual([
      'GEOCODING_BASE_URL',
      'FORECAST_BASE_URL',
      'GEOCODING_BASE_URL',
    ])
    expect(records.map((r) => r.outcome)).toEqual(['respond', 'passthrough', 'passthrough'])
  })

  it('a wrong `calls` count settles as a violation naming the calls received', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], { vendor: { calls: 1 } })
    await fetch(`${h.env.BASE}/a`)
    await fetch(`${h.env.BASE}/b?q=1`)

    const violation = h.settle()
    expect(violation).not.toBeNull()
    expect(violation!.kind).toBe('calls')
    expect(violation!.expected).toContain('to be called 1 time(s)')
    expect(violation!.actual).toContain('called 2 time(s)')
    expect(violation!.detail.join('\n')).toContain('GET /b?q=1')
  })

  it('`calls: 0` holds when the service is never touched', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], { vendor: { calls: 0 } })
    expect(h.settle()).toBeNull()
    expect(up.hits).toHaveLength(0)
  })

  it('a scripted fault is never a violation on its own', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], {
      vendor: { faults: [{ refuse: true }] },
    })
    await expect(fetch(`${h.env.BASE}/x`)).rejects.toThrow()
    expect(h.settle()).toBeNull()
  })

  it('records the request headers so evidence can show (and redact) what was forwarded', async () => {
    const up = await upstream()
    const h = await proxies([{ envVar: 'BASE', url: up.origin }], { vendor: { calls: 0 } })
    await fetch(`${h.env.BASE}/x`, { method: 'POST', headers: { 'x-api-key': 'sekret' }, body: 'payload' })
    const record = h.records()[0]
    expect(record.headers['x-api-key']).toBe('sekret')
    expect(record.body).toBe('payload')
    expect(record.service).toBe('vendor')
  })
})

describe('external proxy — declaration errors and overrides', () => {
  it('scripting a service that is not provided is a CapabilityError', async () => {
    await expect(
      startExternalProxies({ targets: [], scripts: { stripe: { calls: 1 } } as never }),
    ).rejects.toThrow(CapabilityError)
    await expect(
      startExternalProxies({ targets: [], scripts: { stripe: { calls: 1 } } as never }),
    ).rejects.toThrow(/no external service named "stripe"/)
  })

  it('names the provided services when there ARE some, so the typo is obvious', async () => {
    const up = await upstream()
    await expect(
      startExternalProxies({
        targets: [{ service: 'open-meteo', endpoints: [{ envVar: 'BASE', url: up.origin }] }],
        scripts: { openmeteo: { calls: 1 } } as never,
      }),
    ).rejects.toThrow(/provided: open-meteo/)
  })

  it('an env var the scenario sets itself is NOT proxied — no port is spent on it', async () => {
    const up = await upstream()
    const h = await proxies(
      [
        { envVar: 'FORECAST_BASE_URL', url: up.origin },
        { envVar: 'GEOCODING_BASE_URL', url: up.origin },
      ],
      undefined,
      ['FORECAST_BASE_URL'],
    )
    expect(h.env.FORECAST_BASE_URL).toBeUndefined()
    expect(h.env.GEOCODING_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('stop() closes every port', async () => {
    const up = await upstream()
    const handle = await startExternalProxies({
      targets: [{ service: 'vendor', endpoints: [{ envVar: 'BASE', url: up.origin }] }],
      scripts: undefined,
    })
    const origin = handle!.env.BASE
    await handle!.stop()
    await expect(fetch(`${origin}/x`)).rejects.toThrow()
  })
})

describe('setup.externals — the schema', () => {
  const accept = (externals: unknown): boolean => GuardSetupSchema.safeParse({ externals }).success

  it('accepts the whole v1 vocabulary', () => {
    expect(
      accept({
        'open-meteo': {
          faults: [
            { match: { method: 'GET', path: '/v1/forecast' }, respond: { status: 503, json: {} }, once: true },
            { delayMs: 2000 },
            { refuse: true },
            { match: { path: '/v1/*' } },
          ],
          calls: 2,
        },
      }),
    ).toBe(true)
    expect(accept({ vendor: { calls: 0 } })).toBe(true)
  })

  it('refuses the shapes that would mean two things at once, or nothing', () => {
    // Both bodies on one response.
    expect(accept({ v: { faults: [{ respond: { status: 500, body: 'a', json: {} } }] } })).toBe(false)
    // respond AND refuse.
    expect(accept({ v: { faults: [{ respond: { status: 500 }, refuse: true }] } })).toBe(false)
    // An empty rule says nothing at all.
    expect(accept({ v: { faults: [{}] } })).toBe(false)
    // An empty entry.
    expect(accept({ v: {} })).toBe(false)
    // An empty fault list.
    expect(accept({ v: { faults: [] } })).toBe(false)
    // A relative match path.
    expect(accept({ v: { faults: [{ match: { path: 'v1/x' }, refuse: true }] } })).toBe(false)
    // An empty match.
    expect(accept({ v: { faults: [{ match: {}, refuse: true }] } })).toBe(false)
    // `refuse: false` is not a way to say anything.
    expect(accept({ v: { faults: [{ refuse: false }] } })).toBe(false)
    // Unknown keys are typos, not extensions.
    expect(accept({ v: { faults: [{ refuse: true }], retries: 2 } })).toBe(false)
    expect(accept({ v: { calls: -1 } })).toBe(false)
  })
})
