/**
 * NEEDS VS PROVIDES — the deterministic detector the recipe gate asks before it
 * does anything else. Every entry it reports opens a paid repair session, so
 * what is pinned here is mostly what it must NOT report.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recipeNeeds, recipeNeedsDiff, recipeNeedsOf, type DetectedWorld } from '@truecourse/guard-generator'
import { dependenciesPath, type Recipe } from '@truecourse/guard-runner'
import type { DetectedExternalService, DatastoreUrlRef, GuardDependencyClass } from '@truecourse/shared'
import { rmrf } from '../guard-runner/helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

/** A repo with nothing in it but whatever a case writes. */
function repo(catalog?: { service: string; class: GuardDependencyClass }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-needs-'))
  repos.push(dir)
  if (catalog) {
    const file = dependenciesPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        dependencies: [
          {
            name: catalog.service,
            class: catalog.class,
            summary: `the ${catalog.service} the app talks to`,
            services: [catalog.service],
            ...(catalog.class === 'supplied'
              ? {
                  registration: {
                    kind: 'env',
                    vars: [{ name: 'SVC_KEY', description: 'the key', secret: true }],
                  },
                }
              : { obtain: 'the engine stands it up' }),
          },
        ],
      }),
    )
  }
  return dir
}

const BASE: Recipe = { build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/health' } }

const world = (over: Partial<DetectedWorld> = {}): DetectedWorld => ({
  externalServices: [],
  database: null,
  datastoreUrls: [],
  ...over,
})

const datastore = (scheme: string, envVar?: string): DatastoreUrlRef => ({
  url: `${scheme}://localhost/app`,
  scheme,
  ...(envVar ? { envVar } : {}),
  location: { filePath: 'src/db.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
})

const service = (name: string, envVars: string[] = []): DetectedExternalService => ({
  service: name,
  source: 'sdk',
  evidence: [{ filePath: `src/${name}.ts`, importSource: name }],
  ...(envVars.length > 0
    ? { baseUrlEnvs: envVars.map((envVar) => ({ envVar, confidence: 'name-heuristic' as const })) }
    : {}),
})

describe('recipeNeeds', () => {
  // An env variable read without a fallback is a demand on the world and
  // belongs here, but no per-file fact says whether a read HAD a fallback — so
  // nothing about a bare env read is folded in, rather than a name-shaped guess
  // reporting a defaulted variable as a need.
  it('reads needs off the datastores, the driver and the third parties, and nothing else', () => {
    const needs = recipeNeeds(
      world({
        datastoreUrls: [datastore('redis', 'REDIS_URL')],
        database: { type: 'postgres', driver: 'prisma' },
        externalServices: [service('stripe', ['STRIPE_BASE_URL'])],
      }),
    )

    expect(needs.map((need) => need.id)).toEqual([
      'database:postgres:prisma',
      'datastore:redis:REDIS_URL',
      'third-party:stripe',
    ])
  })

  it('is stable whatever order the analysis pass reported things in', () => {
    const one = recipeNeeds(world({ externalServices: [service('a'), service('b')] }))
    const other = recipeNeeds(world({ externalServices: [service('b'), service('a')] }))
    expect(one).toEqual(other)
  })
})

describe('recipeNeedsDiff — the datastore rules', () => {
  it('reports a datastore url the recipe neither stands up nor points at', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: BASE,
      world: world({ datastoreUrls: [datastore('redis', 'REDIS_URL')] }),
    })

    expect(diff.unprovided.map((entry) => [entry.need.id, entry.answer])).toEqual([
      ['datastore:redis:REDIS_URL', 'recipe'],
    ])
    expect(diff.unprovided[0]!.provides).toContain('REDIS_URL')
  })

  it('reports nothing once a bring-up stands the world up', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: { ...BASE, api: { ...BASE.api!, services: { up: 'docker compose up -d' } } },
      world: world({ datastoreUrls: [datastore('redis', 'REDIS_URL')] }),
    })

    expect(diff.unprovided).toEqual([])
  })

  it('reports nothing when the recipe already names the variable', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: { ...BASE, env: { REDIS_URL: 'redis://127.0.0.1:6379' } },
      world: world({ datastoreUrls: [datastore('redis', 'REDIS_URL')] }),
    })

    expect(diff.unprovided).toEqual([])
  })

  // SQLite is the database file itself; there is no daemon for a recipe to
  // bring up, so demanding `api.services` for one would repair a healthy recipe.
  it('does not ask for a bring-up for an embedded datastore', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: BASE,
      world: world({ database: { type: 'sqlite', driver: 'prisma' } }),
    })

    expect(diff.unprovided).toEqual([])
  })
})

describe('recipeNeedsDiff — the third parties', () => {
  it('sends a third party nobody has classified to a registration, not to a repair', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: BASE,
      world: world({ externalServices: [service('stripe')] }),
    })

    expect(diff.unprovided.map((entry) => [entry.need.id, entry.answer])).toEqual([
      ['third-party:stripe', 'registration'],
    ])
    expect(recipeNeedsOf(diff)).toEqual([])
  })

  it('reports nothing for a service the recipe already declares', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: { ...BASE, api: { ...BASE.api!, externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } } } },
      world: world({ externalServices: [service('stripe', ['STRIPE_BASE_URL'])] }),
    })

    expect(diff.unprovided).toEqual([])
  })

  // A `supplied` entry IS the registration prompt: a real-world account nobody
  // may fabricate, and nothing a recipe edit could answer.
  it('reports nothing for a service the catalog files as supplied', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo({ service: 'stripe', class: 'supplied' }),
      recipe: BASE,
      world: world({ externalServices: [service('stripe')] }),
    })

    expect(diff.unprovided).toEqual([])
  })

  // The catalog's CLASS is what says a third party can be stood up locally:
  // `seedable` state is the engine's to materialize, so a compose service can
  // stand in for it, and standing one up is a recipe edit.
  it('sends a locally emulable dependency to the recipe', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo({ service: 'minio', class: 'seedable' }),
      recipe: BASE,
      world: world({ externalServices: [service('minio')] }),
    })

    expect(diff.unprovided.map((entry) => [entry.need.id, entry.answer])).toEqual([
      ['third-party:minio', 'recipe'],
    ])
    expect(recipeNeedsOf(diff)).toHaveLength(1)
  })

  it('reports nothing for a locally emulable dependency the recipe already stands up', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo({ service: 'minio', class: 'seedable' }),
      recipe: { ...BASE, api: { ...BASE.api!, services: { up: 'docker compose up -d' } } },
      world: world({ externalServices: [service('minio')] }),
    })

    expect(diff.unprovided).toEqual([])
  })
})

describe('recipeNeedsDiff — the fingerprint', () => {
  it('moves when the repository needs something new, and not when the recipe changes', () => {
    const r = repo()
    const before = recipeNeedsDiff({ repoRoot: r, recipe: BASE, world: world() })
    const edited = recipeNeedsDiff({
      repoRoot: r,
      recipe: { ...BASE, build: 'pnpm build' },
      world: world(),
    })
    const grown = recipeNeedsDiff({
      repoRoot: r,
      recipe: BASE,
      world: world({ datastoreUrls: [datastore('redis', 'REDIS_URL')] }),
    })

    expect(edited.fingerprint).toBe(before.fingerprint)
    expect(grown.fingerprint).not.toBe(before.fingerprint)
  })

  it('has no verdict for a repository with no recipe yet', () => {
    const diff = recipeNeedsDiff({
      repoRoot: repo(),
      recipe: null,
      world: world({ datastoreUrls: [datastore('redis', 'REDIS_URL')] }),
    })

    expect(diff.needs).toHaveLength(1)
    expect(diff.unprovided).toEqual([])
  })
})
