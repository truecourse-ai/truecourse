/**
 * Route-existence preflight at generate time: a documented path whose
 * workspace app the recipe declares no server for never becomes a scenario.
 *
 * The cal.com bench is the failure: the recipe declared the web app while the docs
 * described `apps/api/v2`, so authoring produced scenarios that asked the web app
 * for `/v2/...`, collected its HTML 404, and reported them as findings about the
 * app. The gates below turn that into ONE visible gap whose fix is a recipe edit —
 * and the last two tests pin the asymmetry (R6): where nothing is positively known,
 * generate must behave exactly as it did before the gates existed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { GuardScenarioSchema, guardScenarioDrivers } from '@truecourse/shared'
import type { MatchRunner } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractSessionBy,
  submitWorkerSessions,
  flowOfAllSession,
  noEpicSessions,
  runGenerate,
  interfacesOf,
  apiInterface,
  rawApi,
  FIXTURE_API_SERVER,
  FIXTURE_API_SERVER_V2,
} from './helpers.js'

/** The committed two-app fixture: a Next web app and a Nest `/v2` api app. */
const MONOREPO = fileURLToPath(new URL('../fixtures/route-manifest-monorepo', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

/** A temp repo whose tree IS the two-app monorepo fixture (routes and all). */
function monorepo(): string {
  const r = makeTempRepo()
  repos.push(r)
  fs.cpSync(MONOREPO, r, { recursive: true })
  return r
}

/** The same fixture with a proxying web app whose statically known routes stay positive facts. */
function monorepoWithOpaqueWeb(): string {
  const r = monorepo()
  fs.writeFileSync(
    path.join(r, 'apps/web/next.config.js'),
    'module.exports = { async rewrites() { return [] } }',
  )
  return r
}

/** A temp repo with no workspace apps at all — the route manifest finds nothing. */
function plainRepo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/api.md'
/** One documented `/v2` endpoint — the app the fixture's Nest service serves. */
const V2_DOC = ['## bookings', 'GET /v2/bookings returns 200 with the booking list.'].join('\n')
/** One documented web endpoint — an exact route even when the app can also proxy. */
const WEB_DOC = ['## version', 'GET /api/version returns 200 with the version.'].join('\n')
/** One documented endpoint on each service — the span case. */
const BOTH_DOC = [
  '## bookings',
  'GET /v2/bookings returns 200 with the booking list.',
  '',
  '## version',
  'GET /api/version returns 200 with the version.',
].join('\n')

const v2Extract = extractSessionBy({
  bookings: [{ driver: 'api', claim: 'GET /v2/bookings returns 200', reason: 'HTTP status + body' }],
})
const webExtract = extractSessionBy({
  version: [{ driver: 'api', claim: 'GET /api/version returns 200', reason: 'HTTP status + body' }],
})
const bothExtract = extractSessionBy({
  bookings: [{ driver: 'api', claim: 'GET /v2/bookings returns 200', reason: 'HTTP status + body' }],
  version: [{ driver: 'api', claim: 'GET /api/version returns 200', reason: 'HTTP status + body' }],
})

/** Both fixture services, joined to the fixture monorepo's app dirs. */
const TWO_SERVERS = {
  web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health', app: 'apps/web' },
  'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health', app: 'apps/api/v2' },
}

/** A matcher that walks milestone N through interface N — the multi-app plan. */
const matchEachInterface: MatchRunner = async ({ milestones, interfaces }) => ({
  plan: milestones.map((m, i) => ({ interfaceId: interfaces[Math.min(i, interfaces.length - 1)].id, milestone: m.order })),
})

describe('generateGuards — the route gate', () => {
  it('blocks a flow whose documented paths belong to an app with no declared server, before any call', async () => {
    const r = monorepo()
    // Only the web app has a server; `/v2/*` is `apps/api/v2`, which has none.
    writeApiRecipe(r, { entry: null, servers: { web: TWO_SERVERS.web }, defaultServer: 'web' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, V2_DOC)

    let matchCalls = 0
    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/v2/bookings')),
      extractSession: v2Extract,
      matchRunner: async (ctx) => {
        matchCalls++
        return { plan: ctx.milestones.map((m) => ({ interfaceId: ctx.interfaces[0].id, milestone: m.order })) }
      },
      flowWorkerSession: submitWorkerSessions(() => undefined, {
        onBriefing: () => authorCalls++,
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toEqual([])
    // GATE A: the match call is skipped too — the block needs no LLM to be certain.
    expect(matchCalls).toBe(0)
    expect(authorCalls).toBe(0)

    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on' && g.surface === 'api')
    expect(gap?.reason).toContain('missing-server')
    expect(gap?.reason).toContain('apps/api/v2')
    expect(gap?.reason).toContain('/v2/*')
    expect(gap?.reason).toContain('declares no server for it')
  }, 60_000)

  it('re-derives the same gap on a no-op re-generate', async () => {
    const r = monorepo()
    writeApiRecipe(r, { entry: null, servers: { web: TWO_SERVERS.web }, defaultServer: 'web' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, V2_DOC)

    const opts = {
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/v2/bookings')),
      extractSession: v2Extract,
    }
    const first = await runGenerate(opts)
    expect(first.coverageGaps.some((g) => g.reason.includes('missing-server'))).toBe(true)

    const second = await runGenerate(opts)
    expect(second.written).toEqual([])
    expect(second.errors).toEqual([])
    const gap = second.coverageGaps.find((g) => g.kind === 'blocked-on' && g.surface === 'api')
    expect(gap?.reason).toContain('apps/api/v2')
  }, 60_000)

  it('authors against the second server once the recipe declares it, stamping `server` on the YAML', async () => {
    const r = monorepo()
    writeApiRecipe(r, { entry: null, servers: TWO_SERVERS, defaultServer: 'web' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, V2_DOC)

    let briefing = ''
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/v2/bookings'), apiInterface('GET', '/api/version')),
      extractSession: v2Extract,
      flowWorkerSession: submitWorkerSessions(
        () =>
          rawApi('GET /v2/ping answers 200', [
            { request: { method: 'GET', path: '/v2/ping' }, expect: { status: 200 } },
          ]),
        { onBriefing: (_t, text) => (briefing = text) },
      ),
    })

    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)
    const committed = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as {
      server?: string
    }
    // The engine owns the field: the model never authored it, and it is stamped
    // because the flow bound a server OTHER than the recipe's default.
    expect(guardScenarioDrivers(GuardScenarioSchema.parse(committed))).toEqual(['api'])
    expect(committed.server).toBe('api-v2')
    // The briefing described THAT service — and only its own operations: the web
    // app's `/api/version` is another service's, so the setup catalog drops it.
    expect(briefing).toContain('api-v2')
    expect(briefing).toContain('apps/api/v2')
    expect(briefing).toContain('/v2/health')
    expect(briefing).not.toContain('/api/version')
  }, 60_000)

  it('binds a known route of an opaque app to its declared server and stamps the YAML', async () => {
    const r = monorepoWithOpaqueWeb()
    writeApiRecipe(r, { entry: null, servers: TWO_SERVERS, defaultServer: 'api-v2' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, WEB_DOC)

    let briefing = ''
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/api/version')),
      extractSession: webExtract,
      // The fixture web server 404s that path, so the worker DECLARES the red —
      // the scenario still commits, which is what the `server` stamp is about.
      flowWorkerSession: submitWorkerSessions(
        () => ({
          red: rawApi('GET /api/version answers 200', [
            { request: { method: 'GET', path: '/api/version' }, expect: { status: 200 } },
          ]),
        }),
        { onBriefing: (_t, text) => (briefing = text) },
      ),
    })

    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)
    const committed = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as {
      server?: string
    }
    expect(committed.server).toBe('web')
    expect(briefing).toContain('apps/web')
  }, 60_000)

  it('blocks a flow that spans two declared servers — a scenario runs against one', async () => {
    const r = monorepo()
    writeApiRecipe(r, { entry: null, servers: TWO_SERVERS, defaultServer: 'web' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, BOTH_DOC)

    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/v2/bookings'), apiInterface('GET', '/api/version')),
      extractSession: bothExtract,
      flowsAreaSession: flowOfAllSession('Book through the api, then read the web version'),
      flowsEpicSession: noEpicSessions,
      matchRunner: matchEachInterface,
      flowWorkerSession: submitWorkerSessions(() => undefined, {
        onBriefing: () => authorCalls++,
      }),
    })

    expect(res.written).toEqual([])
    expect(authorCalls).toBe(0)
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on' && g.surface === 'api')
    expect(gap?.reason).toContain('multi-server-flow')
    expect(gap?.reason).toContain('apps/api/v2 + apps/web')
    expect(gap?.reason).toContain('a scenario runs against one server')
  }, 60_000)

  it('advertises only the credentials the bound server accepts', async () => {
    const r = monorepo()
    writeApiRecipe(r, {
      entry: null,
      servers: TWO_SERVERS,
      defaultServer: 'web',
      credentials: {
        'web-session': { header: 'Cookie', value: 'sid=abc', servers: ['web'] },
        'api-key': { header: 'Authorization', value: 'Bearer k', servers: ['api-v2'] },
        shared: { header: 'X-Shared', value: 'both' },
      },
    })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, V2_DOC)

    let briefing = ''
    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/v2/bookings')),
      extractSession: v2Extract,
      flowWorkerSession: submitWorkerSessions(
        () =>
          rawApi('GET /v2/ping answers 200', [
            { request: { method: 'GET', path: '/v2/ping' }, expect: { status: 200 } },
          ]),
        { onBriefing: (_t, text) => (briefing = text) },
      ),
    })

    // A web session cookie is not an api-v2 credential; one with no allowlist is.
    expect(briefing).toContain('api-key')
    expect(briefing).toContain('shared')
    expect(briefing).not.toContain('web-session')
  }, 60_000)

  it('authors exactly as before in a repo the route manifest knows nothing about', async () => {
    const r = plainRepo()
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: DOC }])
    // Documented `/v2` paths, and NOTHING in the tree claims them: unknown is not a
    // block, so the flow authors exactly as it did before the gate existed.
    writeDoc(r, DOC, V2_DOC)

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/v2/bookings')),
      extractSession: v2Extract,
      flowWorkerSession: submitWorkerSessions(() =>
        rawApi('GET /todos answers 200', [
          { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
        ]),
      ),
    })

    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)
    const committed = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as { server?: string }
    expect(committed.server).toBeUndefined()
  }, 60_000)
})
