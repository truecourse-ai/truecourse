/**
 * Run-time route triage (item 76): the bound server answered 404 for a path ANOTHER
 * workspace app serves. Nothing about the spec or the code is in dispute — the
 * recipe declares no server for the service that owns the path — so the scenario
 * settles `error` (infrastructure) with an `unservedRoute` annotation, never a
 * `fail` that reads as a finding about the app.
 *
 * The negatives are as load-bearing as the positive (R6/R7): a step that EXPECTS a
 * 404, an app that may proxy, and a server with no `app` join key must all keep the
 * ordinary verdict guard has always produced.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGuard } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeScenario,
  apiScenario,
  FIXTURE_API_SERVER,
  FIXTURE_API_SERVER_V2,
} from './helpers.js'

/** The committed two-app fixture: a Next web app and a Nest `/v2` api app. */
const MONOREPO = fileURLToPath(new URL('../fixtures/route-manifest-monorepo', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

/** A repo whose TREE is the two-app monorepo — so the route manifest has facts. */
function monorepo(): string {
  const r = makeTempRepo()
  repos.push(r)
  fs.cpSync(MONOREPO, r, { recursive: true })
  return r
}

/** `web` is the only declared server (the todos fixture); `/v2/*` is apps/api/v2's. */
function writeWebOnlyRecipe(r: string, webApp: string | null = 'apps/web'): void {
  writeApiRecipe(r, {
    servers: {
      web: {
        serve: ['node', FIXTURE_API_SERVER],
        healthPath: '/health',
        ...(webApp ? { app: webApp } : {}),
      },
    },
  })
}

/** One `web`-bound scenario requesting `path`, expecting `status`. */
function writeV2Scenario(r: string, expectStatus = 200, requestPath = '/v2/ping'): void {
  writeScenario(
    r,
    'api/v2.yaml',
    apiScenario({
      id: 'asks-the-wrong-server',
      steps: [{ request: { method: 'GET', path: requestPath }, expect: { status: expectStatus } }],
    }),
  )
}

describe('runGuard — a 404 on a path another app serves is infrastructure, not drift', () => {
  it('settles `error` + unservedRoute naming the app that does serve it, with evidence', async () => {
    const r = monorepo()
    writeWebOnlyRecipe(r)
    writeV2Scenario(r)

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const row = res.latest.scenarios[0]
    expect(row.outcome).toBe('error')
    expect(row.unservedRoute).toBe(true)
    expect(row.failure?.expected).toContain('the bound server "web" (apps/web) to serve GET /v2/ping')
    expect(row.failure?.actual).toContain('is served by apps/api/v2')
    expect(row.failure?.actual).toContain('api.servers')
    // The transcript is written exactly as any other settled outcome's.
    expect(row.evidencePath).toBeTruthy()
    expect(fs.existsSync(path.join(r, row.evidencePath!, 'transcript.txt'))).toBe(true)
  })

  it('leaves a step that EXPECTS 404 alone — "an unknown path answers 404" is a real claim', async () => {
    const r = monorepo()
    writeWebOnlyRecipe(r)
    writeV2Scenario(r, 404)

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const row = res.latest.scenarios[0]
    expect(row.outcome).toBe('pass')
    expect(row.unservedRoute).toBeUndefined()
  })

  it('degrades to the ordinary `fail` when the bound app may forward what it does not declare', async () => {
    const r = monorepo()
    // A `rewrites()` in the web app's next.config: it can answer for paths it never
    // declares, so guard may never tell it that it does not serve one.
    fs.writeFileSync(
      path.join(r, 'apps/web/next.config.js'),
      'module.exports = { async rewrites() { return [{ source: "/v2/:p*", destination: "http://api/:p*" }] } }\n',
    )
    writeWebOnlyRecipe(r)
    writeV2Scenario(r)

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const row = res.latest.scenarios[0]
    expect(row.outcome).toBe('fail')
    expect(row.unservedRoute).toBeUndefined()
  })

  it('never triages a server with no `app` — the join key is what makes the claim positive', async () => {
    const r = monorepo()
    writeWebOnlyRecipe(r, null)
    writeV2Scenario(r)

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const row = res.latest.scenarios[0]
    expect(row.outcome).toBe('fail')
    expect(row.unservedRoute).toBeUndefined()
  })

  it('keeps a 404 the BOUND server itself owns a plain failure', async () => {
    const r = monorepo()
    writeWebOnlyRecipe(r)
    // `/api/version` is the web app's OWN route; the todos fixture happens not to
    // serve it, and that disagreement is exactly the kind guard must keep reporting.
    writeV2Scenario(r, 200, '/api/version')

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const row = res.latest.scenarios[0]
    expect(row.outcome).toBe('fail')
    expect(row.unservedRoute).toBeUndefined()
  })
})

/** The second fixture service exists so "which server answered?" stays observable. */
it('a scenario bound to the api-v2 server is never triaged for its own paths', async () => {
  const r = makeTempRepo()
  repos.push(r)
  fs.cpSync(MONOREPO, r, { recursive: true })
  writeApiRecipe(r, {
    servers: {
      web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health', app: 'apps/web' },
      'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health', app: 'apps/api/v2' },
    },
    defaultServer: 'web',
  })
  writeScenario(
    r,
    'api/v2.yaml',
    apiScenario({
      id: 'on-api-v2',
      server: 'api-v2',
      steps: [{ request: { method: 'GET', path: '/v2/ping' }, expect: { status: 200 } }],
    }),
  )

  const res = await runGuard({ repoRoot: r, skipBuild: true })
  expect(res.status).toBe('ok')
  if (res.status !== 'ok') return
  expect(res.latest.scenarios[0]?.outcome).toBe('pass')
})
