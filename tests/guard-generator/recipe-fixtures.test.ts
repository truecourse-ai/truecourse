/**
 * The cross-language recipe acceptance (item 55, Phase 1): REAL repositories on
 * disk under `tests/fixtures/recipe-propose/`, not file maps written inline.
 * Each one is copied to a temp dir first — verification installs, builds, and
 * boots inside the repo it is given, and a fixture that grows a `dist/` or a
 * `bin/` is no longer a fixture.
 *
 * Three levels, deliberately:
 *  - the JS fixture runs END TO END (`discoverRecipe` really builds it and really
 *    boots the server to its health path) and asserts the recipe FILE's exact
 *    bytes. It is dependency-free so that stays true offline, in CI, forever.
 *  - the FastAPI and ASP.NET fixtures always assert the proposed recipe's shape,
 *    which needs no toolchain at all.
 *  - their boots are GATED on the host having the toolchain (uvicorn importable /
 *    the .NET SDK installed), the same way the Roslyn tests gate on the built
 *    C# host. Nothing here ever reaches the network: the python boot skips the
 *    (pip) install step, and the .NET build restores from the SDK's own packs.
 *
 * The model runner throws in every test — a fixture that falls through to the LLM
 * is a REGRESSION in the deterministic proposer, and it fails loudly here.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { discoverRecipe, proposeRecipe, type ApiRouteRef, type RecipeRunner } from '@truecourse/guard-generator'
import {
  recipePath,
  resolveEntry,
  preflightApiServer,
  DEFAULT_API_READY_TIMEOUT_MS,
  type Recipe,
} from '@truecourse/guard-runner'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'recipe-propose')

const temps: string[] = []
afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true })
})

/** The fixture, copied to a temp dir — builds and boots must never touch the checkout. */
function fixture(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tc-fixture-${name}-`))
  temps.push(dir)
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true })
  return dir
}

/** The LLM fallback must never be reached — these repos declare their own answer. */
const neverCalled: RecipeRunner = async () => {
  throw new Error('the model proposer was called — the deterministic path should have decided')
}

/** The api surface the journey mapper would hand discovery: a health route and a
 *  business route, so `/healthz` is RANKED rather than assumed. */
const ROUTES: ApiRouteRef[] = [
  { method: 'GET', path: '/healthz' },
  { method: 'GET', path: '/forecast' },
]

function proposalOf(repo: string): Recipe {
  const outcome = proposeRecipe(repo, { routes: ROUTES, securitySchemes: {} })
  if (!outcome.ok) throw new Error(`expected a proposal, got a bail: ${outcome.reason}`)
  return outcome.recipe
}

/** Boot the proposed server in the runner's own sandbox and poll its health path —
 *  the exact check `verifyProposal`'s api branch makes, minus install/build. */
async function bootsHealthy(repo: string, recipe: Recipe): Promise<string> {
  const api = recipe.api
  if (!api) throw new Error('the proposal has no api block to boot')
  const result = await preflightApiServer({
    resolvedServe: resolveEntry(repo, api.serve),
    displayServe: api.serve,
    recipeEnv: { ...recipe.env, ...api.env },
    healthPath: api.healthPath ?? '/',
    readyTimeoutMs: DEFAULT_API_READY_TIMEOUT_MS,
  })
  return result.ok ? '' : result.stderr
}

// ---------------------------------------------------------------------------
// JS/TS — the speced-api shape, end to end
// ---------------------------------------------------------------------------

describe('recipe discovery — the speced-api-mini fixture (end to end)', () => {
  it(
    'writes exactly the recipe the repo implies, having really built and booted it',
    async () => {
      const repo = fixture('speced-api-mini')

      const result = await discoverRecipe(repo, neverCalled, { routes: async () => ROUTES })

      expect(result.status).toBe('discovered')
      if (result.status !== 'discovered') return
      expect(result.source).toBe('deterministic')
      expect(result.todos).toEqual([])
      // The FILE, byte for byte — this is the acceptance criterion, not a deep
      // equal on an in-memory object. `install` is absent by design: the fixture
      // declares no dependencies, and running a package manager to fetch nothing
      // is the documented omission.
      expect(fs.readFileSync(recipePath(repo), 'utf-8')).toBe(
        `{
  "build": "npm run build",
  "api": {
    "serve": [
      "node",
      "dist/index.js"
    ],
    "healthPath": "/healthz"
  }
}
`,
      )
    },
    120_000,
  )
})

// ---------------------------------------------------------------------------
// Python — FastAPI
// ---------------------------------------------------------------------------

/** The host can import the fixture's own dependencies — the python boot's gate. */
const pythonServesFastapi =
  spawnSync('python3', ['-c', 'import fastapi, uvicorn'], { stdio: 'ignore' }).status === 0

describe('recipe proposal — the fastapi-mini fixture', () => {
  it('derives the uvicorn recipe from the declared dependency and the app assignment', () => {
    const recipe = proposalOf(fixture('fastapi-mini'))

    expect(recipe).toEqual({
      install: 'pip install -r requirements.txt',
      build: 'true',
      api: {
        serve: [
          'python3',
          '-m',
          'uvicorn',
          'main:app',
          '--app-dir',
          '.',
          '--host',
          '127.0.0.1',
          '--port',
          '${PORT}',
        ],
        healthPath: '/healthz',
      },
    })
  })

  it.skipIf(!pythonServesFastapi)(
    'boots that argv to a healthy /healthz from the runner sandbox',
    async () => {
      const repo = fixture('fastapi-mini')
      // The install step is SKIPPED on purpose: `pip install -r requirements.txt`
      // is a network call, and the gate above already proves the host has what the
      // fixture declares. Everything else is the runner's real boot path.
      expect(await bootsHealthy(repo, proposalOf(repo))).toBe('')
    },
    120_000,
  )
})

// ---------------------------------------------------------------------------
// C# — ASP.NET minimal API
// ---------------------------------------------------------------------------

/** The .NET SDK is installed — the same kind of gate the Roslyn-host tests use. */
const dotnetSdk = spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0

describe('recipe proposal — the aspnet-mini fixture', () => {
  it('derives the web-SDK recipe, binding Kestrel to the run port', () => {
    const recipe = proposalOf(fixture('aspnet-mini'))

    expect(recipe).toEqual({
      build: 'dotnet build -c Release aspnet-mini.csproj',
      api: {
        serve: ['dotnet', 'run', '--project', 'aspnet-mini.csproj', '--no-build', '-c', 'Release'],
        healthPath: '/healthz',
        // `PORT` means nothing to Kestrel — ASPNETCORE_URLS is what it binds.
        env: { ASPNETCORE_URLS: 'http://127.0.0.1:${PORT}' },
      },
    })
  })

  it.skipIf(!dotnetSdk)(
    'builds and boots end to end, writing the same recipe',
    async () => {
      const repo = fixture('aspnet-mini')

      const result = await discoverRecipe(repo, neverCalled, { routes: async () => ROUTES })

      expect(result.status).toBe('discovered')
      if (result.status !== 'discovered') return
      expect(result.source).toBe('deterministic')
      expect(result.recipe).toEqual(proposalOf(path.join(FIXTURES, 'aspnet-mini')))
    },
    600_000,
  )
})
