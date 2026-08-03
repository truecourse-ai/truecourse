/**
 * The externals proxy through `runGuard` — a real app, in a real
 * sandbox, reaching a real "third party" through the runner's own proxy: that the
 * proxy is ALWAYS in the path for a provided account, that unscripted traffic
 * still lands on the real service, that a scenario's own `setup.env` still wins,
 * that a `calls` mismatch is a scenario FAIL with redacted evidence, and that a
 * script naming a service the run cannot reach is a loud `error`.
 *
 * The fixture server's `GET /upstream` calls `TC_UPSTREAM_BASE` and reports what it
 * got, and `GET /boot` echoes the env it booted with — between them the assertions
 * are on the APP's own view, never on the runner's internals.
 */

import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { runGuard, externalsLocalPath } from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

const repos: string[] = []
const servers: (() => Promise<void>)[] = []
afterEach(async () => {
  while (repos.length) rmrf(repos.pop()!)
  while (servers.length) await servers.pop()!()
})

function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** The REAL account the proxy forwards to — hermetic, but genuinely a third party. */
async function realService(): Promise<{ origin: string; hits: string[] }> {
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ live: true }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(() => new Promise((r) => server.close(() => r())))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits }
}

function only(scenarios: readonly GuardScenarioResult[]): GuardScenarioResult {
  expect(scenarios).toHaveLength(1)
  return scenarios[0]
}

function writeLocal(r: string, local: unknown): void {
  const target = externalsLocalPath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(local, null, 2))
}

describe('runGuard — a provided external is always proxied', () => {
  it('routes the app through the proxy, and unscripted traffic reaches the real service', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin } },
    })
    writeScenario(
      r,
      'api/passthrough.yaml',
      apiScenario({
        id: 'passthrough',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote%3Fsku%3Dabc' },
            expect: {
              status: 200,
              json: { upstreamStatus: { equals: 200 }, upstreamBody: { contains: '"live":true' } },
            },
          },
          {
            // The app's base URL is the PROXY's loopback origin, not the account's —
            // which is the whole claim of "always on".
            request: { method: 'GET', path: '/boot' },
            expect: { status: 200, json: { 'env.TC_UPSTREAM_BASE': { matches: '^http://127\\.0\\.0\\.1:\\d+$' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
    // Forwarded verbatim, query string included.
    expect(live.hits).toEqual(['GET /v1/quote?sku=abc'])
  })

  it('a scripted fault answers instead of the account, and never touches it', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin } },
    })
    writeScenario(
      r,
      'api/forced.yaml',
      apiScenario({
        id: 'forced-503',
        binds: specBinds('cli/version'),
        setup: {
          externals: {
            vendor: { faults: [{ respond: { status: 503, json: { error: 'melted' } } }], calls: 1 },
          },
        },
        steps: [
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote' },
            expect: {
              status: 200,
              json: { upstreamStatus: { equals: 503 }, upstreamBody: { contains: 'melted' } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
    expect(live.hits).toEqual([])
  })

  it('a refused connection reaches the app as a network failure', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin } },
    })
    writeScenario(
      r,
      'api/refused.yaml',
      apiScenario({
        id: 'refused',
        binds: specBinds('cli/version'),
        setup: { externals: { vendor: { faults: [{ refuse: true, once: true }], calls: 2 } } },
        steps: [
          // The fixture answers 502 when its own upstream call throws…
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote' },
            expect: { status: 502, json: { error: { contains: 'upstream call failed' } } },
          },
          // …and the very next call recovers, because `once` consumed the rule.
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote' },
            expect: { status: 200, json: { upstreamStatus: { equals: 200 } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
    expect(live.hits).toHaveLength(1)
  })

  it('a wrong `calls` count FAILS the scenario even though every step passed', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin } },
    })
    writeScenario(
      r,
      'api/counted.yaml',
      apiScenario({
        id: 'counted',
        binds: specBinds('cli/version'),
        setup: { externals: { vendor: { calls: 3 } } },
        steps: [
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote' },
            expect: { status: 200, json: { upstreamStatus: { equals: 200 } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('fail')
    expect(result.failure?.expected).toContain('to be called 3 time(s)')
    expect(result.failure?.actual).toContain('called 1 time(s)')
    const evidence = fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')
    expect(evidence).toContain('external mismatch')
    expect(evidence).toContain('GET /v1/quote')
  })

  it('masks a forwarded external secret out of the recorded calls', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: {
        vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin, env: { TC_EXT_KEY: {} } },
      },
    })
    writeLocal(r, { vendor: { env: { TC_EXT_KEY: 'ext-secret-value' } } })
    writeScenario(
      r,
      'api/redaction.yaml',
      apiScenario({
        id: 'redaction',
        binds: specBinds('cli/version'),
        // The count is wrong on purpose: the mismatch is what prints the calls.
        setup: { externals: { vendor: { calls: 9 } } },
        steps: [
          {
            // A vendor key riding the QUERY STRING is the shape that lands in the
            // recorded call line — which is exactly why that line is redacted.
            request: { method: 'GET', path: '/upstream?path=/v1/quote%3Fkey%3Dext-secret-value' },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('fail')
    const evidence = fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')
    expect(evidence).not.toContain('ext-secret-value')
    expect(evidence).toContain('«external:vendor.TC_EXT_KEY»')
  })
})

describe('runGuard — precedence and refusals', () => {
  it("a scenario's own setup.env still wins: the stub answers and the account is untouched", async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin } },
    })
    writeScenario(
      r,
      'api/stub-wins.yaml',
      apiScenario({
        id: 'stub-wins',
        binds: specBinds('cli/version'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: { vendor: { routes: [{ method: 'GET', path: '/v1/quote', json: { stubbed: true }, calls: 1 }] } },
          // The proxy stands aside for that variable, so the service sees nothing.
          externals: { vendor: { calls: 0 } },
        },
        steps: [
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote' },
            expect: { status: 200, json: { upstreamBody: { contains: 'stubbed' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
    expect(live.hits).toEqual([])
  })

  it('scripting a service the recipe never declared is an ERROR, not a silent pass', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE', baseUrl: live.origin } },
    })
    writeScenario(
      r,
      'api/undeclared.yaml',
      apiScenario({
        id: 'undeclared-external',
        binds: specBinds('cli/version'),
        setup: { externals: { stripe: { faults: [{ refuse: true }] } } },
        steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('setup.externals')
    expect(result.failure?.actual).toContain('stripe')
  })

  it('an UNPROVIDED declared service proxies nothing — and scripting it is an error', async () => {
    const r = repo()
    writeApiRecipe(r, { externals: { vendor: { baseUrlEnv: 'TC_UPSTREAM_BASE' } } })
    writeScenario(
      r,
      'api/unprovided-quiet.yaml',
      apiScenario({
        id: 'unprovided-quiet',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/boot' },
            expect: { status: 200, json: { 'env.TC_UPSTREAM_BASE': { absent: true } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/unprovided-scripted.yaml',
      apiScenario({
        id: 'unprovided-scripted',
        binds: specBinds('cli/version'),
        setup: { externals: { vendor: { calls: 0 } } },
        steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const byId = new Map(res.latest.scenarios.map((s) => [s.id, s]))
    expect(byId.get('unprovided-quiet')!.outcome).toBe('pass')
    expect(byId.get('unprovided-scripted')!.outcome).toBe('error')
  })

  it('a cli scenario cannot script externals — the accounts configure the api server', async () => {
    const r = repo()
    const { writeRecipe, scenario } = await import('./helpers.js')
    writeRecipe(r)
    writeScenario(
      r,
      'cli/externals.yaml',
      scenario({
        id: 'cli-externals',
        binds: specBinds('cli/version'),
        setup: { externals: { vendor: { calls: 0 } } },
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('setup.externals')
  })
})

describe('runGuard — multi-endpoint services', () => {
  it('proxies EVERY base-URL variable of a service, sharing one script and one count', async () => {
    const r = repo()
    const live = await realService()
    writeApiRecipe(r, {
      externals: {
        vendor: {
          baseUrlEnv: 'TC_UPSTREAM_BASE',
          baseUrl: live.origin,
          endpoints: { TC_OTHER_BASE: live.origin },
        },
      },
    })
    writeScenario(
      r,
      'api/multi.yaml',
      apiScenario({
        id: 'multi-endpoint',
        binds: specBinds('cli/version'),
        setup: { externals: { vendor: { calls: 1 } } },
        steps: [
          {
            request: { method: 'GET', path: '/boot' },
            expect: {
              status: 200,
              json: {
                // Both variables are set, both to a loopback proxy, and to DIFFERENT
                // ports — one proxy per endpoint.
                'env.TC_UPSTREAM_BASE': { matches: '^http://127\\.0\\.0\\.1:\\d+$' },
                'env.TC_OTHER_BASE': { matches: '^http://127\\.0\\.0\\.1:\\d+$' },
              },
            },
          },
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote' },
            expect: { status: 200, json: { upstreamStatus: { equals: 200 } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
  })
})
