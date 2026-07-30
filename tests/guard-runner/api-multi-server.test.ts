/**
 * Multi-server recipes (item 75): a repo that ships more than one HTTP service
 * declares them all under `api.servers`, and each scenario binds to exactly one.
 *
 * The failure this prevents is the cal.com bench: one recipe server (the web app)
 * while the docs described a second service, so every scenario for the second
 * service asked the first one and died on its HTML 404 — a false failure about the
 * app, from a gap in the recipe.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeScenario,
  apiScenario,
  specBinds,
  FIXTURE_API_SERVER,
  FIXTURE_API_SERVER_V2,
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

/** The two-service recipe every test here starts from: `web` (todos) + `api-v2`. */
function writeTwoServerRecipe(r: string, overrides: Record<string, unknown> = {}): void {
  writeApiRecipe(r, {
    servers: {
      web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health', app: 'apps/web' },
      'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health', app: 'apps/api/v2' },
    },
    defaultServer: 'web',
    ...overrides,
  })
}

function resultsById(latest: { scenarios: { id: string }[] }): Map<string, any> {
  return new Map(latest.scenarios.map((s) => [s.id, s]))
}

describe('runGuard — multi-server recipes', () => {
  it('runs each scenario against the server it binds, and the default when it binds none', async () => {
    const r = repo()
    writeTwoServerRecipe(r)
    writeScenario(
      r,
      'api/web.yaml',
      apiScenario({
        id: 'on-web',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/todos' },
            expect: { status: 200, headers: { 'x-service': { equals: 'todos' } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/v2.yaml',
      apiScenario({
        id: 'on-api-v2',
        server: 'api-v2',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/v2/ping' },
            expect: {
              status: 200,
              headers: { 'x-service': { equals: 'api-v2' } },
              json: { service: { equals: 'api-v2' } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const byId = resultsById(res.latest)
    expect(byId.get('on-web')?.outcome).toBe('pass')
    expect(byId.get('on-api-v2')?.outcome).toBe('pass')
  })

  it('settles a scenario naming an undeclared server as an error, while its sibling still passes', async () => {
    const r = repo()
    writeTwoServerRecipe(r)
    writeScenario(
      r,
      'api/web.yaml',
      apiScenario({
        id: 'on-web',
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )
    writeScenario(
      r,
      'api/ghost.yaml',
      apiScenario({
        id: 'on-ghost',
        server: 'api-v3',
        binds: specBinds('cli/version'),
        steps: [{ request: { method: 'GET', path: '/v3/ping' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const byId = resultsById(res.latest)
    expect(byId.get('on-web')?.outcome).toBe('pass')
    const ghost = byId.get('on-ghost')
    expect(ghost?.outcome).toBe('error')
    expect(ghost?.failure?.actual).toContain('scenario binds server "api-v3"')
    expect(ghost?.failure?.actual).toContain('api-v2')
  })

  it('reports a preflight failure of the SECOND server naming it', async () => {
    const r = repo()
    writeTwoServerRecipe(r, { apiEnv: { TC_V2_FAIL_BOOT: '1' } })
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
    expect(res.status).toBe('entry-preflight-failed')
    if (res.status !== 'entry-preflight-failed') return
    expect(res.preflight.stderr).toContain('server "api-v2"')
    expect(res.preflight.stderr).toContain('api-v2 refused to boot')
  })

  it('never boots a declared server no scenario binds', async () => {
    const r = repo()
    const marker = path.join(r, 'v2-boots.log')
    writeApiRecipe(r, {
      servers: {
        web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
        'api-v2': {
          serve: ['node', FIXTURE_API_SERVER_V2],
          healthPath: '/v2/health',
          env: { TC_V2_MARKER: marker },
        },
      },
      defaultServer: 'web',
    })
    writeScenario(
      r,
      'api/web.yaml',
      apiScenario({
        id: 'on-web',
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('layers env per server: recipe env ⊕ api.env ⊕ the server’s own', async () => {
    const r = repo()
    writeApiRecipe(r, {
      env: { TC_LAYER: 'recipe', TC_ONLY_RECIPE: 'yes' },
      apiEnv: { TC_LAYER: 'api' },
      servers: {
        web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health', env: { TC_LAYER: 'server' } },
      },
    })
    writeScenario(
      r,
      'api/boot.yaml',
      apiScenario({
        id: 'boot-env',
        steps: [
          {
            request: { method: 'GET', path: '/boot' },
            expect: {
              status: 200,
              json: { 'env.TC_LAYER': { equals: 'server' }, 'env.TC_ONLY_RECIPE': { equals: 'yes' } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0]?.outcome).toBe('pass')
  })

  it('keeps a credential off a server its allowlist excludes, with an actionable error', async () => {
    const r = repo()
    writeApiRecipe(r, {
      servers: {
        web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
        'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health' },
      },
      defaultServer: 'web',
      credentials: { 'v2-key': { header: 'Authorization', value: 'Bearer v2-secret', servers: ['api-v2'] } },
    })
    writeScenario(
      r,
      'api/v2.yaml',
      apiScenario({
        id: 'v2-uses-it',
        server: 'api-v2',
        steps: [
          {
            request: { method: 'GET', path: '/v2/echo', headers: { Authorization: '{{cred:v2-key}}' } },
            expect: { status: 200, json: { authorization: { equals: 'Bearer v2-secret' } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/web.yaml',
      apiScenario({
        id: 'web-uses-it',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:v2-key}}' } },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const byId = resultsById(res.latest)
    expect(byId.get('v2-uses-it')?.outcome).toBe('pass')
    const web = byId.get('web-uses-it')
    expect(web?.outcome).toBe('error')
    expect(web?.failure?.expected).toContain('server "web"')
    expect(web?.failure?.actual).toContain('"api-v2"')
  })
})
