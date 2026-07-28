/**
 * The `http` setup capability through the DRIVERS — a real app in a real sandbox
 * calling a scripted stub whose origin reached it through `setup.env`: the
 * lifecycle ordering (stubs up before the app boots), the pass path, the three
 * violation kinds surfacing as scenario FAILURES, an undeclared stub reference
 * surfacing as an `error`, and the redaction of recorded request excerpts.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeRecipe,
  writeScenario,
  apiScenario,
  scenario,
  specBinds,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function only(scenarios: readonly GuardScenarioResult[]): GuardScenarioResult {
  expect(scenarios).toHaveLength(1)
  return scenarios[0]
}

describe('setup.http — the api driver', () => {
  it('serves the app under test from the stub, and asserts what it sent', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/upstream-ok.yaml',
      apiScenario({
        id: 'upstream-ok',
        binds: specBinds('a/b'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: {
            vendor: {
              routes: [
                {
                  method: 'GET',
                  path: '/v1/quote',
                  status: 200,
                  json: { price: 42 },
                  expect: { query: { sku: 'abc' }, headers: { 'content-type': 'application/json' } },
                  calls: 1,
                },
                // Declared but never called — `calls: 0` is the "must not touch it" assertion.
                { method: 'POST', path: '/v1/charge', status: 500, json: {}, calls: 0 },
              ],
            },
          },
        },
        steps: [
          {
            request: { method: 'GET', path: '/upstream?path=/v1/quote%3Fsku%3Dabc' },
            expect: { status: 200, json: { upstreamStatus: { equals: 200 }, upstreamBody: { contains: '"price":42' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('pass')
  })

  it('starts the stubs BEFORE the app boots — a startup call to the stub succeeds', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/ordering.yaml',
      apiScenario({
        id: 'stub-before-app',
        binds: specBinds('a/b'),
        setup: {
          // The fixture calls the stub at STARTUP, before it listens: nothing else can
          // make this pass if the stub came up after the server.
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}', TC_UPSTREAM_PING: '/v1/hello' },
          http: { vendor: { routes: [{ method: 'GET', path: '/v1/hello', json: { hello: 'early' }, calls: 1 }] } },
        },
        steps: [
          {
            request: { method: 'GET', path: '/startup-ping' },
            expect: { status: 200, json: { 'ping.status': { equals: 200 }, 'ping.body': { contains: 'early' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
  })

  it('FAILS the scenario on an unscripted call, even when every step passed', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/unmatched.yaml',
      apiScenario({
        id: 'unscripted-call',
        binds: specBinds('a/b'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: { vendor: { routes: [{ method: 'GET', path: '/v1/quote', json: { price: 1 } }] } },
        },
        steps: [
          // The step itself passes — the app faithfully reports the stub's 404.
          {
            request: { method: 'GET', path: '/upstream?path=/v1/charge' },
            milestone: 1,
            expect: { status: 200, json: { upstreamStatus: { equals: 404 } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('fail')
    expect(result.failure!.step).toBe(1)
    expect(result.failedMilestone).toBe(1)
    expect(result.failure!.actual).toContain('GET /v1/charge')
    // The transcript carries the received request as evidence.
    const diff = fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')
    expect(diff).toContain('stub mismatch')
    expect(diff).toContain('unscripted request')
  })

  it('tolerates an unscripted call under `unmatched: "404"`', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/unmatched-ok.yaml',
      apiScenario({
        id: 'unscripted-tolerated',
        binds: specBinds('a/b'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: {
            vendor: { unmatched: '404', routes: [{ method: 'GET', path: '/v1/quote', json: { price: 1 } }] },
          },
        },
        steps: [
          {
            request: { method: 'GET', path: '/upstream?path=/v1/charge' },
            expect: { status: 200, json: { upstreamStatus: { equals: 404 } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
  })

  it('FAILS on a violated request assertion and on a wrong call count', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/bad-request.yaml',
      apiScenario({
        id: 'wrong-request',
        binds: specBinds('a/b'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: {
            vendor: {
              routes: [
                {
                  method: 'POST',
                  path: '/v1/orders',
                  json: { ok: true },
                  expect: { jsonPath: { total: 99 } },
                },
              ],
            },
          },
        },
        steps: [
          {
            request: { method: 'POST', path: '/upstream?path=/v1/orders&method=POST', json: { total: 1 } },
            expect: { status: 200 },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/bad-count.yaml',
      apiScenario({
        id: 'wrong-count',
        binds: specBinds('cli/version'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: { vendor: { routes: [{ method: 'GET', path: '/v1/quote', json: { price: 1 }, calls: 2 }] } },
        },
        steps: [
          { request: { method: 'GET', path: '/upstream?path=/v1/quote' }, expect: { status: 200 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 2, pass: 0, fail: 2, error: 0 })

    const request = res.latest.scenarios.find((s) => s.id === 'wrong-request')!
    expect(request.failure!.expected).toContain('json total equals 99')
    expect(request.failure!.actual).toContain('was 1')

    const count = res.latest.scenarios.find((s) => s.id === 'wrong-count')!
    expect(count.failure!.expected).toContain('to be called 2 time(s)')
    expect(count.failure!.actual).toContain('called 1 time(s)')
  })

  it('ERRORS (never fails) when `${HTTP_STUB:…}` names a stub the scenario never declared', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/undeclared.yaml',
      apiScenario({
        id: 'undeclared-stub',
        binds: specBinds('a/b'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:typo}' },
          http: { vendor: { routes: [{ method: 'GET', path: '/v1/quote', json: {} }] } },
        },
        steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('error')
    expect(result.failure!.expected).toBe('setup capabilities to materialize')
    expect(result.failure!.actual).toContain('setup.http')
    expect(result.failure!.actual).toContain('no stub named "typo"')
  })

  it('redacts a resolved credential the app forwarded upstream out of the stub evidence', async () => {
    const r = repo()
    const SECRET = 'Bearer stub-secret-token'
    writeApiRecipe(r, { credentials: { 'api-key': { header: 'Authorization', value: SECRET } } })
    writeScenario(
      r,
      'api/redact.yaml',
      apiScenario({
        id: 'stub-redaction',
        binds: specBinds('a/b'),
        setup: {
          env: { TC_UPSTREAM_BASE: '${HTTP_STUB:vendor}' },
          http: {
            vendor: {
              routes: [
                // Deliberately unmet, so the violation excerpts the whole request —
                // including the `authorization` header the app forwarded upstream.
                { method: 'GET', path: '/v1/quote', json: {}, expect: { headers: { 'x-absent': 'yes' } } },
              ],
            },
          },
        },
        steps: [
          {
            request: {
              method: 'GET',
              path: '/upstream?path=/v1/quote',
              headers: { Authorization: '{{cred:api-key}}' },
            },
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
    const diff = fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')
    expect(diff).toContain('authorization:')
    expect(diff).not.toContain('stub-secret-token')
    expect(diff).toContain('«cred:api-key»')
  })
})

describe('setup.http — the cli driver', () => {
  it('serves a cli program whose base URL comes from setup.env, and asserts its request', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/upstream.yaml',
      scenario({
        id: 'cli-upstream-ok',
        binds: specBinds('a/b'),
        setup: {
          env: { RELKIT_API_BASE: '${HTTP_STUB:vendor}' },
          http: {
            vendor: {
              routes: [
                {
                  method: 'POST',
                  path: '/v1/releases',
                  status: 201,
                  json: { released: true },
                  expect: { headers: { 'x-relkit': '2.4.1' }, jsonPath: { tag: 'v9' } },
                  calls: 1,
                },
              ],
            },
          },
        },
        steps: [
          {
            run: ['fetch', '/v1/releases', 'POST', '{"tag":"v9"}'],
            expect: { exit: 0, stdout: { contains: 'status=201' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(only(res.latest.scenarios).outcome).toBe('pass')
  })

  it('FAILS the cli scenario on an unscripted call, with the request in the evidence', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/upstream-bad.yaml',
      scenario({
        id: 'cli-upstream-unscripted',
        binds: specBinds('a/b'),
        setup: {
          env: { RELKIT_API_BASE: '${HTTP_STUB:vendor}' },
          http: { vendor: { routes: [{ method: 'GET', path: '/v1/known', body: 'ok' }] } },
        },
        steps: [
          // The program's own assertion passes — the stub answered 404 and it printed it.
          { run: ['fetch', '/v1/unknown'], expect: { exit: 0, stdout: { contains: 'status=404' } } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = only(res.latest.scenarios)
    expect(result.outcome).toBe('fail')
    expect(result.failure!.actual).toContain('GET /v1/unknown')
    const diff = fs.readFileSync(path.join(r, result.evidencePath!, 'diff.txt'), 'utf-8')
    expect(diff).toContain('unscripted request')
  })
})
