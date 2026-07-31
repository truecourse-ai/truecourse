/**
 * The live endpoint probe (item 77, step 1).
 *
 * `pickProbePath` is pure and gets unit coverage. `probeApiServers` boots the REAL
 * `seed-draft` fixture server through the runner's own `preflightApiServer` and calls
 * it for real — the pass bar (any HTTP status passes; only a boot failure, an
 * unreachable fetch, or 5xx-on-everything fails) is the whole point of the module, so
 * it is exercised against a live process rather than a stub.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickProbePath, probeApiServers } from '@truecourse/guard-generator'
import type { Recipe } from '@truecourse/guard-runner'
import { rmrf } from '../guard-runner/helpers.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-probe-'))
  repos.push(dir)
  fs.cpSync(FIXTURE, dir, { recursive: true })
  return dir
}

function recipeFor(r: string, over: Record<string, unknown> = {}): Recipe {
  return {
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json') },
      ...over,
    },
  } as Recipe
}

describe('pickProbePath', () => {
  // The ranking is the deterministic proposer's own (`rankHealthPath`), reused
  // rather than duplicated — a second ranking could disagree with the recipe.
  it('prefers the ranked health endpoint the app declares', () => {
    expect(pickProbePath('/', ['/orgs', '/healthz', '/bookings'])).toBe('/healthz')
  })

  it('falls back to the shortest parameter-free route', () => {
    expect(pickProbePath('/', ['/a/b/c', '/orgs', '/bookings'])).toBe('/bookings')
  })

  // Guessing an id would make the probe's own 404 look like an app failure.
  it('never picks a templated path', () => {
    expect(pickProbePath('/health', ['/orgs/{id}'])).toBe('/health')
  })

  // R6: a repo the route manifest knows nothing about degrades to the boot check,
  // never to a false failure.
  it('degrades to the health path when no routes are known', () => {
    expect(pickProbePath('/health', [])).toBe('/health')
  })

  it('is stable across equal-length candidates', () => {
    expect(pickProbePath('/', ['/zoo', '/api'])).toBe('/api')
  })
})

describe('probeApiServers', () => {
  it('boots the server and records the status the picked path answered', async () => {
    const r = fixtureRepo()

    const probes = await probeApiServers({ repoRoot: r, recipe: recipeFor(r) })

    expect(probes).toHaveLength(1)
    expect(probes[0]).toMatchObject({ server: 'default', ok: true, status: 200 })
  }, 60_000)

  // THE pass bar. A 404 means the route table moved, not that the recipe is broken —
  // and a 401 means the route exists and wants auth, which is the seed's job.
  it('PASSES on a 404 — the route table moved, the recipe did not break', async () => {
    const r = fixtureRepo()
    const probes = await probeApiServers({
      repoRoot: r,
      // `app` is the route-manifest join key (item 76) — without it nothing relates
      // a route to this server and the probe degrades to the health path.
      recipe: recipeFor(r, { healthPath: '/health', app: 'apps/api' }),
      manifest: { apps: [{ dir: 'apps/api', framework: 'other', routes: ['/nope'], prefixes: ['/nope'], opaque: false }] },
    })

    expect(probes[0].ok).toBe(true)
    expect(probes[0].status).toBe(404)
  }, 60_000)

  it('FAILS when the server does not boot at all', async () => {
    const r = fixtureRepo()
    const recipe = {
      build: 'true',
      api: { serve: ['node', path.join(r, 'does-not-exist.mjs')], healthPath: '/health', readyTimeoutMs: 4000 },
    } as Recipe

    const probes = await probeApiServers({ repoRoot: r, recipe })

    expect(probes[0].ok).toBe(false)
    expect(probes[0].error).toBeTruthy()
  }, 60_000)

  // 5xx on EVERY probed REAL route. The health path is deliberately not a sample:
  // the boot already polled it to 2xx, so counting it would make this verdict
  // unreachable.
  it('FAILS when every probed path answers 5xx', async () => {
    const r = fixtureRepo()

    const probes = await probeApiServers({
      repoRoot: r,
      // The health path still answers 2xx (the boot requires it); the app's only
      // known ROUTE is the fixture's `/boom`, which answers 500 — and real routes
      // are the only samples, so the verdict is the all-5xx one.
      recipe: recipeFor(r, { healthPath: '/health', app: 'apps/api' }),
      manifest: { apps: [{ dir: 'apps/api', framework: 'other', routes: ['/boom'], prefixes: ['/boom'], opaque: false }] },
    })

    expect(probes[0].ok).toBe(false)
    expect(probes[0].error).toMatch(/every probed path answered 5xx/)
  }, 60_000)

  it('reports one probe per declared server (item 75)', async () => {
    const r = fixtureRepo()
    const recipe = {
      build: 'true',
      api: {
        servers: {
          alpha: { serve: ['node', path.join(r, 'server.mjs')], healthPath: '/health' },
          beta: { serve: ['node', path.join(r, 'server.mjs')], healthPath: '/health' },
        },
        defaultServer: 'alpha',
        env: { SEED_STORE: path.join(r, 'store.json') },
      },
    } as Recipe

    const probes = await probeApiServers({ repoRoot: r, recipe })

    expect(probes.map((p) => p.server)).toEqual(['alpha', 'beta'])
    expect(probes.every((p) => p.ok)).toBe(true)
  }, 90_000)

  it('probes nothing for a cli-only recipe', async () => {
    expect(
      await probeApiServers({ repoRoot: fixtureRepo(), recipe: { build: 'true', entry: ['node', 'x.js'] } as Recipe }),
    ).toEqual([])
  })
})
