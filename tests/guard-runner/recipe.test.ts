import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  resolveApiCredentials,
  credentialShapeWarning,
  CredentialResolutionError,
  RecipeError,
  recipeControlledEnvVars,
  recipePath,
  resolveApiServers,
  resolveScenarioServer,
  DEFAULT_API_SERVER_NAME,
  type Recipe,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, FIXTURE_BIN } from './helpers.js'

/** Write a raw recipe.json (bypassing the schema-shaped helpers). */
function writeRawRecipe(repo: string, recipe: unknown): void {
  const target = recipePath(repo)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
}

/** A recipe.json with an `api` block plus the given `credentials` map. */
function apiRecipeWith(credentials: Record<string, unknown>): Record<string, unknown> {
  return {
    build: 'true',
    api: { serve: ['node', 'server.js'], healthPath: '/health', credentials },
  }
}

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('loadRecipe', () => {
  it('returns null when there is no recipe', () => {
    const r = repo()
    expect(loadRecipe(r, recipePath(r))).toBeNull()
  })

  it('loads a valid recipe with a fingerprint', () => {
    const r = repo()
    writeRecipe(r, { build: 'pnpm build', entry: ['node', 'dist/cli.js'] })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.build).toBe('pnpm build')
    expect(loaded?.recipe.entry).toEqual(['node', 'dist/cli.js'])
    expect(loaded?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('loads a recipe with an install step', () => {
    const r = repo()
    writeRecipe(r, { install: 'npm ci' })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.install).toBe('npm ci')
  })

  it('a recipe without install loads with install undefined (back-compat)', () => {
    const r = repo()
    writeRecipe(r, { build: 'pnpm build', entry: ['node', 'dist/cli.js'] })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.install).toBeUndefined()
  })

  it('throws RecipeError on an empty install command', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(
      recipePath(r),
      JSON.stringify({ install: '', build: 'true', entry: ['node', 'x.js'] }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('throws RecipeError on invalid JSON', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(recipePath(r), '{ not json')
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('throws RecipeError when the schema is violated', () => {
    const r = repo()
    fs.mkdirSync(path.dirname(recipePath(r)), { recursive: true })
    fs.writeFileSync(recipePath(r), JSON.stringify({ entry: [] }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })
})

describe('computeRecipeFingerprint', () => {
  it('is stable across calls and changes when an input changes', () => {
    const r = repo()
    const a = computeRecipeFingerprint(r)
    expect(computeRecipeFingerprint(r)).toBe(a)
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'tmp', version: '9.9.9' }))
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('folds the recipe file itself so a recipe edit invalidates the fingerprint', () => {
    const r = repo()
    writeRawRecipe(r, { build: 'true', entry: ['node', 'cli.js'] })
    const a = computeRecipeFingerprint(r)
    writeRawRecipe(r, { build: 'pnpm build', entry: ['node', 'cli.js'] })
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('changes when a credential is added, renamed, or its header changes', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({}))
    const none = computeRecipeFingerprint(r)

    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', valueFromEnv: 'API_KEY' } }))
    const withCred = computeRecipeFingerprint(r)
    expect(withCred).not.toBe(none)

    writeRawRecipe(r, apiRecipeWith({ 'other-key': { header: 'Authorization', valueFromEnv: 'API_KEY' } }))
    expect(computeRecipeFingerprint(r)).not.toBe(withCred) // renamed

    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'X-Api-Key', valueFromEnv: 'API_KEY' } }))
    expect(computeRecipeFingerprint(r)).not.toBe(withCred) // header changed
  })

  it('does NOT change when only an inline credential VALUE is rotated', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', value: 'secret-v1' } }))
    const v1 = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', value: 'secret-v2-rotated' } }))
    expect(computeRecipeFingerprint(r)).toBe(v1)
  })

  it('is invariant to JSON key ordering (canonical hash)', () => {
    const r = repo()
    writeRawRecipe(r, {
      build: 'true',
      api: {
        serve: ['node', 'server.js'],
        healthPath: '/health',
        credentials: { 'api-key': { header: 'Authorization', valueFromEnv: 'API_KEY' } },
      },
    })
    const a = computeRecipeFingerprint(r)
    // The SAME recipe with every object's keys reordered must fingerprint identically.
    writeRawRecipe(r, {
      api: {
        credentials: { 'api-key': { valueFromEnv: 'API_KEY', header: 'Authorization' } },
        healthPath: '/health',
        serve: ['node', 'server.js'],
      },
      build: 'true',
    })
    expect(computeRecipeFingerprint(r)).toBe(a)
  })
})

describe('computeRecipeFingerprint — the generated datastore (item 68)', () => {
  it('folds docker-compose.guard.yml: editing the datastore moves the fingerprint', () => {
    const r = repo()
    const compose = path.join(r, 'docker-compose.guard.yml')
    // Absent, it folds nothing — every repo without one keeps the value it had.
    const without = computeRecipeFingerprint(r)

    fs.writeFileSync(compose, 'services:\n  postgres:\n    image: postgres:16-alpine\n')
    const withCompose = computeRecipeFingerprint(r)
    expect(withCompose).not.toBe(without)

    // The world the scenarios ran against changed: a different engine version.
    fs.writeFileSync(compose, 'services:\n  postgres:\n    image: postgres:15-alpine\n')
    expect(computeRecipeFingerprint(r)).not.toBe(withCompose)

    fs.rmSync(compose)
    expect(computeRecipeFingerprint(r)).toBe(without)
  })

  it("does NOT fold the repo's OWN compose file — that one is not guard's", () => {
    const r = repo()
    const before = computeRecipeFingerprint(r)
    fs.writeFileSync(path.join(r, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n')
    expect(computeRecipeFingerprint(r)).toBe(before)
  })
})

describe('computeRecipeFingerprint — the seed script (item 66)', () => {
  /** An api recipe whose seed names a script FILE (`api.seed.script`). */
  function seedRecipe(script?: string): Record<string, unknown> {
    return {
      build: 'true',
      api: {
        serve: ['node', 'server.js'],
        seed: {
          command: 'node scripts/guard-seed.mjs',
          ...(script ? { script } : {}),
          provides: { fixtures: { org: ['id'] } },
        },
      },
    }
  }

  it('declaring the seed re-keys, and EDITING the named script re-keys too', () => {
    const r = repo()
    writeRawRecipe(r, { build: 'true', api: { serve: ['node', 'server.js'] } })
    const noSeed = computeRecipeFingerprint(r)

    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'console.log(1)\n')
    writeRawRecipe(r, seedRecipe('scripts/guard-seed.mjs'))
    const withSeed = computeRecipeFingerprint(r)
    expect(withSeed).not.toBe(noSeed)

    // The whole point of the explicit `script` field: the FILE is an input.
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'console.log(2)\n')
    expect(computeRecipeFingerprint(r)).not.toBe(withSeed)
  })

  it('an unrelated file, and a script the recipe does NOT name, leave it alone', () => {
    const r = repo()
    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'console.log(1)\n')
    // No `script` field ⇒ the file is not an input, exactly as before item 66.
    writeRawRecipe(r, seedRecipe())
    const unnamed = computeRecipeFingerprint(r)
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'console.log(2)\n')
    expect(computeRecipeFingerprint(r)).toBe(unnamed)

    writeRawRecipe(r, seedRecipe('scripts/guard-seed.mjs'))
    const named = computeRecipeFingerprint(r)
    fs.writeFileSync(path.join(r, 'notes.txt'), 'nothing to do with the recipe')
    expect(computeRecipeFingerprint(r)).toBe(named)
  })

  it('a missing script, and one that escapes the repo, fold nothing (never throw)', () => {
    const r = repo()
    writeRawRecipe(r, seedRecipe('scripts/gone.mjs'))
    const missing = computeRecipeFingerprint(r)
    expect(missing).toMatch(/^sha256:/)

    writeRawRecipe(r, seedRecipe('../outside.mjs'))
    expect(computeRecipeFingerprint(r)).toMatch(/^sha256:/)
  })
})

describe('ownHosts — the repo\'s own origins', () => {
  it('loads a recipe declaring ownHosts, and rejects an empty entry', () => {
    const r = repo()
    writeRawRecipe(r, { build: 'true', entry: ['node', 'cli.js'], ownHosts: ['cal.com', 'https://app.acme.io'] })
    expect(loadRecipe(r, recipePath(r))?.recipe.ownHosts).toEqual(['cal.com', 'https://app.acme.io'])

    writeRawRecipe(r, { build: 'true', entry: ['node', 'cli.js'], ownHosts: [''] })
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })
})

describe('api.cwd — where the server process runs', () => {
  it('accepts repo and sandbox, defaults to absent, rejects anything else', () => {
    const r = repo()
    writeRawRecipe(r, { build: 'true', api: { serve: ['node', 'server.js'], cwd: 'repo' } })
    expect(loadRecipe(r, recipePath(r))?.recipe.api?.cwd).toBe('repo')

    writeRawRecipe(r, { build: 'true', api: { serve: ['node', 'server.js'] } })
    expect(loadRecipe(r, recipePath(r))?.recipe.api?.cwd).toBeUndefined()

    writeRawRecipe(r, { build: 'true', api: { serve: ['node', 'server.js'], cwd: '/tmp/x' } })
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })
})

describe('recipeControlledEnvVars', () => {
  it('unions env and api.env, minus every variable an external owns', () => {
    const r = repo()
    writeRawRecipe(r, {
      build: 'true',
      env: { DATABASE_URL: 'postgres://x', NEXT_PUBLIC_WEBAPP_URL: 'http://localhost:3000' },
      api: {
        serve: ['node', 'server.js'],
        env: { FEATURE_FLAG: '1', GEOCODING_BASE_URL: 'should-not-count' },
        externals: {
          'open-meteo': {
            baseUrlEnv: 'GEOCODING_BASE_URL',
            endpoints: { FORECAST_BASE_URL: 'https://api.open-meteo.com' },
            env: { METEO_API_KEY: {} },
          },
        },
      },
    })
    const recipe = loadRecipe(r, recipePath(r))!.recipe
    // Externals-owned vars point AWAY from the app — never own-host evidence,
    // even when a recipe also pins one under an env block.
    expect(recipeControlledEnvVars(recipe)).toEqual([
      'DATABASE_URL',
      'FEATURE_FLAG',
      'NEXT_PUBLIC_WEBAPP_URL',
    ])
  })

  it('a recipe with no env blocks controls nothing', () => {
    const r = repo()
    writeRawRecipe(r, { build: 'true', entry: ['node', 'cli.js'] })
    expect(recipeControlledEnvVars(loadRecipe(r, recipePath(r))!.recipe)).toEqual([])
  })
})

describe('RecipeApiSchema — credentials', () => {
  it('accepts a credential sourced from an inline value', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', value: 'sekret' } }))
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.credentials?.['api-key']).toEqual({ header: 'Authorization', value: 'sekret' })
  })

  it('accepts a credential sourced from an env var', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', valueFromEnv: 'API_KEY' } }))
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.credentials?.['api-key']).toEqual({ header: 'Authorization', valueFromEnv: 'API_KEY' })
  })

  it('rejects a credential carrying BOTH value and valueFromEnv', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', value: 'x', valueFromEnv: 'API_KEY' } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects a credential carrying NEITHER value nor valueFromEnv', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization' } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  // --- item 59b: the `fromRequest` credential source ---------------------------------

  it('accepts a credential sourced from a login request', () => {
    const r = repo()
    const fromRequest = {
      method: 'POST',
      path: '/auth/login',
      json: { user: 'dev' },
      capture: 'token',
      template: 'Bearer ${value}',
    }
    writeRawRecipe(r, apiRecipeWith({ session: { header: 'Authorization', fromRequest } }))
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.credentials?.session).toEqual({ header: 'Authorization', fromRequest })
  })

  it('accepts a login request capturing from a response header', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/auth/login', captureHeader: 'X-Token' },
        },
      }),
    )
    expect(loadRecipe(r, recipePath(r))?.recipe.api?.credentials?.session.fromRequest?.captureHeader).toBe('X-Token')
  })

  it('rejects a credential carrying fromRequest AND another source', () => {
    const r = repo()
    const fromRequest = { method: 'POST', path: '/auth/login', capture: 'token' }
    writeRawRecipe(r, apiRecipeWith({ session: { header: 'Authorization', value: 'x', fromRequest } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(/exactly one of `value`, `valueFromEnv`, or `fromRequest`/)
  })

  it('rejects a login request that captures from BOTH a body path and a header', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/l', capture: 'token', captureHeader: 'X-Token' },
        },
      }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects a login request that captures from NEITHER source', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({ session: { header: 'Authorization', fromRequest: { method: 'POST', path: '/l' } } }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects a login request path that does not start with /', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({
        session: { header: 'Authorization', fromRequest: { method: 'POST', path: 'auth/login', capture: 'token' } },
      }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects a login request template with no ${value} placeholder', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/l', capture: 'token', template: 'Bearer token' },
        },
      }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(/\$\{value\}/)
  })

  it('rejects a login request carrying both `body` and `json`', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/l', body: 'x', json: {}, capture: 'token' },
        },
      }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects an unknown key inside a login request (strict)', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({
        session: {
          header: 'Authorization',
          fromRequest: { method: 'POST', path: '/l', capture: 'token', follow: true },
        },
      }),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('a fromRequest credential is SKIPPED by the static resolver (it needs a booted server)', () => {
    const resolved = resolveApiCredentials({
      session: {
        header: 'Authorization',
        fromRequest: { method: 'POST', path: '/l', capture: 'token' },
      },
      static: { header: 'X-Api-Key', value: 'k' },
    })
    expect([...resolved.keys()]).toEqual(['static'])
  })

  it('rejects a credential with an empty header', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: '', value: 'x' } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects an unknown key inside a credential (strict)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'Authorization', value: 'x', extra: 1 } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('accepts an optional `satisfies` naming the OpenAPI security scheme the credential fulfills', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWith({ 'api-key': { header: 'X-API-Key', valueFromEnv: 'API_KEY', satisfies: 'apiKeyAuth' } }),
    )
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.credentials?.['api-key']).toEqual({
      header: 'X-API-Key',
      valueFromEnv: 'API_KEY',
      satisfies: 'apiKeyAuth',
    })
  })

  it('rejects an empty `satisfies` (min 1)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'X-API-Key', value: 'x', satisfies: '' } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('accepts `satisfies` on a seed-provided credential', () => {
    const r = repo()
    writeRawRecipe(r, {
      build: 'true',
      api: {
        serve: ['node', 'server.js'],
        seed: {
          command: 'node seed.mjs',
          provides: { credentials: { 'user-token': { header: 'Authorization', satisfies: 'bearerAuth' } } },
        },
      },
    })
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.seed?.provides.credentials?.['user-token']).toEqual({
      header: 'Authorization',
      satisfies: 'bearerAuth',
    })
  })

  it('re-plans (fingerprint moves) when a credential `satisfies` changes — it is a capability change', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'X-API-Key', value: 'x', satisfies: 'apiKeyAuth' } }))
    const a = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'X-API-Key', value: 'x', satisfies: 'otherScheme' } }))
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('does NOT re-plan when only the inline VALUE rotates alongside a stable `satisfies`', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'X-API-Key', value: 'v1', satisfies: 'apiKeyAuth' } }))
    const v1 = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWith({ 'api-key': { header: 'X-API-Key', value: 'v2', satisfies: 'apiKeyAuth' } }))
    expect(computeRecipeFingerprint(r)).toBe(v1)
  })
})

describe('resolveApiCredentials', () => {
  it('returns an empty map when no credentials are declared', () => {
    expect(resolveApiCredentials(undefined, {}).size).toBe(0)
  })

  it('resolves an inline value', () => {
    const map = resolveApiCredentials({ 'api-key': { header: 'Authorization', value: 'sekret' } }, {})
    expect(map.get('api-key')).toEqual({ header: 'Authorization', value: 'sekret' })
  })

  it('resolves a value from the host env', () => {
    const map = resolveApiCredentials(
      { 'api-key': { header: 'Authorization', valueFromEnv: 'MY_API_KEY' } },
      { MY_API_KEY: 'env-secret' },
    )
    expect(map.get('api-key')).toEqual({ header: 'Authorization', value: 'env-secret' })
  })

  it('throws a clear error naming the missing env var (no silent skip)', () => {
    expect(() =>
      resolveApiCredentials({ 'api-key': { header: 'Authorization', valueFromEnv: 'MY_API_KEY' } }, {}),
    ).toThrow(CredentialResolutionError)
    try {
      resolveApiCredentials({ 'api-key': { header: 'Authorization', valueFromEnv: 'MY_API_KEY' } }, {})
    } catch (e) {
      expect((e as Error).message).toContain('MY_API_KEY')
      expect((e as Error).message).toContain('api-key')
    }
  })

  it('rejects an env var that is set but EMPTY (no un-authenticated run)', () => {
    expect(() =>
      resolveApiCredentials({ 'api-key': { header: 'Authorization', valueFromEnv: 'MY_API_KEY' } }, { MY_API_KEY: '' }),
    ).toThrow(CredentialResolutionError)
  })

  it('rejects an env var that is whitespace-only', () => {
    let message = ''
    try {
      resolveApiCredentials({ 'api-key': { header: 'Authorization', valueFromEnv: 'MY_API_KEY' } }, { MY_API_KEY: '   ' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('MY_API_KEY')
    expect(message).toContain('api-key')
  })
})

describe('RecipeApiSchema — seed stage (Phase 2)', () => {
  /** A recipe.json with an `api` block carrying a `seed` stage. */
  function apiRecipeWithSeed(seed: unknown, credentials?: Record<string, unknown>): Record<string, unknown> {
    return {
      build: 'true',
      api: {
        serve: ['node', 'server.js'],
        healthPath: '/health',
        ...(credentials ? { credentials } : {}),
        seed,
      },
    }
  }

  it('accepts a seed stage declaring credentials and fixtures', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWithSeed({
        command: 'node seed.mjs',
        provides: {
          credentials: { 'api-key': { header: 'Authorization', description: 'regular pro user' } },
          fixtures: { user: ['id', 'username'], eventType: ['id'] },
        },
      }),
    )
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.seed?.command).toBe('node seed.mjs')
    expect(loaded?.recipe.api?.seed?.provides.credentials?.['api-key']).toEqual({
      header: 'Authorization',
      description: 'regular pro user',
    })
    expect(loaded?.recipe.api?.seed?.provides.fixtures).toEqual({ user: ['id', 'username'], eventType: ['id'] })
  })

  it('accepts a seed stage that provides only fixtures', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node seed.mjs', provides: { fixtures: { user: ['id'] } } }))
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.seed?.provides.fixtures).toEqual({ user: ['id'] })
    expect(loaded?.recipe.api?.seed?.provides.credentials).toBeUndefined()
  })

  it('rejects a seed stage with an empty command', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWithSeed({ command: '', provides: { fixtures: { user: ['id'] } } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects a declared fixture with no fields (min 1)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node seed.mjs', provides: { fixtures: { user: [] } } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('rejects an unknown key inside the seed stage (strict)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node seed.mjs', provides: { fixtures: { user: ['id'] } }, extra: 1 }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('refuses a name collision between api.credentials and seed.provides.credentials (ambiguity)', () => {
    const r = repo()
    writeRawRecipe(
      r,
      apiRecipeWithSeed(
        { command: 'node seed.mjs', provides: { credentials: { 'api-key': { header: 'Authorization' } } } },
        { 'api-key': { header: 'X-Api-Key', value: 'x' } },
      ),
    )
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('folds the seed provides into the fingerprint (adding/changing a fixture re-plans)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node seed.mjs', provides: { fixtures: { user: ['id'] } } }))
    const a = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node seed.mjs', provides: { fixtures: { user: ['id', 'username'] } } }))
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('folds the seed command into the fingerprint (a command edit re-plans)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node seed.mjs', provides: { fixtures: { user: ['id'] } } }))
    const a = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWithSeed({ command: 'node other-seed.mjs', provides: { fixtures: { user: ['id'] } } }))
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })
})

describe('RecipeApiCredentialSchema — description (Phase 3)', () => {
  it('accepts an optional description on a declared credential', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ owner: { header: 'Authorization', value: 'x', description: 'org owner' } }))
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.credentials?.owner).toEqual({ header: 'Authorization', value: 'x', description: 'org owner' })
  })

  it('rejects an empty description (min 1)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ owner: { header: 'Authorization', value: 'x', description: '' } }))
    expect(() => loadRecipe(r, recipePath(r))).toThrow(RecipeError)
  })

  it('folds a credential description into the fingerprint (it changes authoring output)', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ owner: { header: 'Authorization', valueFromEnv: 'K', description: 'org owner' } }))
    const a = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWith({ owner: { header: 'Authorization', valueFromEnv: 'K', description: 'regular member' } }))
    expect(computeRecipeFingerprint(r)).not.toBe(a)
  })

  it('still does NOT fold an inline value even when a description is present', () => {
    const r = repo()
    writeRawRecipe(r, apiRecipeWith({ owner: { header: 'Authorization', value: 'v1', description: 'org owner' } }))
    const a = computeRecipeFingerprint(r)
    writeRawRecipe(r, apiRecipeWith({ owner: { header: 'Authorization', value: 'v2-rotated', description: 'org owner' } }))
    expect(computeRecipeFingerprint(r)).toBe(a)
  })
})

describe('resolveEntry', () => {
  it('pins a bare interpreter to an absolute host path (a scenario PATH cannot swap it)', () => {
    const r = repo()
    const [cmd] = resolveEntry(r, ['node', 'x'])
    expect(path.isAbsolute(cmd)).toBe(true)
    expect(path.basename(cmd)).toMatch(/^node(\.exe)?$/)
    expect(fs.existsSync(cmd)).toBe(true)
  })

  it('falls back to the bare name when the command is not on the host PATH', () => {
    const r = repo()
    const [cmd] = resolveEntry(r, ['tc-definitely-not-a-real-binary'])
    expect(cmd).toBe('tc-definitely-not-a-real-binary')
  })

  it('absolutizes a repo-relative entry file that exists', () => {
    const r = repo()
    fs.writeFileSync(path.join(r, 'entry.mjs'), '// stub')
    const resolved = resolveEntry(r, ['node', 'entry.mjs'])
    expect(resolved[1]).toBe(path.join(r, 'entry.mjs'))
    expect(path.isAbsolute(resolved[1])).toBe(true)
  })

  it('leaves flags and non-existent args untouched', () => {
    const r = repo()
    const resolved = resolveEntry(r, ['node', FIXTURE_BIN, '--flag', 'nope/missing'])
    expect(path.isAbsolute(resolved[0])).toBe(true) // interpreter pinned to the host path
    expect(resolved.slice(1)).toEqual([FIXTURE_BIN, '--flag', 'nope/missing'])
  })

  it('absolutizes a path-anchored directory arg — `uvicorn --app-dir .` names the repo', () => {
    const r = repo()
    const resolved = resolveEntry(r, ['python3', '-m', 'uvicorn', 'main:app', '--app-dir', '.'])
    // Left relative it would resolve to the sandbox's empty temp cwd and the app
    // module would be unimportable.
    expect(resolved[5]).toBe(path.resolve(r))
  })

  it('absolutizes a nested directory arg, but never a bare subcommand that collides with one', () => {
    const r = repo()
    fs.mkdirSync(path.join(r, 'src', 'app'), { recursive: true })
    fs.mkdirSync(path.join(r, 'build'))
    const resolved = resolveEntry(r, ['dotnet', 'build', 'src/app'])
    // `build` is a subcommand the author wrote as a word — it stays one, even
    // though a `build/` directory exists; `src/app` was written as a path.
    expect(resolved.slice(1)).toEqual(['build', path.join(r, 'src', 'app')])
  })

  it('resolves a dot-anchored command against the repo root', () => {
    const r = repo()
    fs.mkdirSync(path.join(r, 'bin'))
    fs.writeFileSync(path.join(r, 'bin', 'cli'), '#!/bin/sh\n')
    const [cmd] = resolveEntry(r, ['./bin/cli'])
    expect(cmd).toBe(path.join(r, 'bin', 'cli'))
  })
})

describe('credentialShapeWarning (item 56 — the silent-401 shape check)', () => {
  it('warns for an Authorization value with no auth-scheme token, naming the credential but NEVER the value', () => {
    const warning = credentialShapeWarning('user-token', { header: 'Authorization', value: 'eyJhbGciOiJIUzI1NiJ9.secret' })
    expect(warning).toContain('user-token')
    expect(warning).toContain('Bearer')
    expect(warning).not.toContain('eyJhbGciOiJIUzI1NiJ9.secret')
  })

  it('accepts the canonical `Bearer `/`Basic `/`Digest ` forms', () => {
    expect(credentialShapeWarning('t', { header: 'Authorization', value: 'Bearer abc' })).toBeNull()
    expect(credentialShapeWarning('t', { header: 'Authorization', value: 'Basic dXNlcjpwdw==' })).toBeNull()
    expect(credentialShapeWarning('t', { header: 'Authorization', value: 'Digest username="u"' })).toBeNull()
  })

  it('nudges non-canonical casing without calling it wrong', () => {
    const warning = credentialShapeWarning('t', { header: 'Authorization', value: 'bearer abc' })
    expect(warning).toContain('canonical')
    expect(warning).toContain('Bearer')
    expect(warning).not.toContain('abc')
  })

  it('never inspects a non-Authorization header, whatever the value looks like', () => {
    expect(credentialShapeWarning('k', { header: 'X-API-Key', value: 'raw-token' })).toBeNull()
    expect(credentialShapeWarning('k', { header: 'Cookie', value: 'session=abc' })).toBeNull()
  })

  it('matches the header case-insensitively (HTTP headers are)', () => {
    expect(credentialShapeWarning('t', { header: 'authorization', value: 'raw-token' })).not.toBeNull()
  })
})

describe('resolveApiCredentials — shape warnings', () => {
  let warnings: string[]
  let spy: MockInstance
  beforeEach(() => {
    warnings = []
    spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.join(' '))
    })
  })
  afterEach(() => spy.mockRestore())

  it('warns once for a raw Authorization value, naming the credential without the secret', () => {
    resolveApiCredentials({ 'user-token': { header: 'Authorization', value: 'raw-jwt-value' } }, {})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('[guard credentials]')
    expect(warnings[0]).toContain('user-token')
    expect(warnings[0]).not.toContain('raw-jwt-value')
  })

  it('stays silent for a `Bearer `/`Basic ` value and for a non-Authorization header', () => {
    resolveApiCredentials(
      {
        bearer: { header: 'Authorization', value: 'Bearer abc' },
        basic: { header: 'Authorization', value: 'Basic dXNlcjpwdw==' },
        key: { header: 'X-API-Key', value: 'raw-key' },
      },
      {},
    )
    expect(warnings).toEqual([])
  })

  it('checks the env-sourced value too', () => {
    resolveApiCredentials({ tok: { header: 'Authorization', valueFromEnv: 'TOK' } }, { TOK: 'plain-token' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('tok')
    expect(warnings[0]).not.toContain('plain-token')
  })
})

// --- Multi-server recipes (item 75) -----------------------------------------

/** Parse a raw recipe through the loader, returning the error message on failure. */
function loadRaw(r: string, recipe: unknown): { ok: true; recipe: Recipe } | { ok: false; message: string } {
  writeRawRecipe(r, recipe)
  try {
    return { ok: true, recipe: loadRecipe(r, recipePath(r))!.recipe }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

const WEB = { serve: ['node', 'web.js'], healthPath: '/health', app: 'apps/web' }
const V2 = { serve: ['node', 'v2.js'], healthPath: '/v2/health', app: 'apps/api/v2' }

describe('recipe api.servers', () => {
  it('parses a named servers map with a default', () => {
    const loaded = loadRaw(repo(), {
      build: 'true',
      api: { servers: { web: WEB, 'api-v2': V2 }, defaultServer: 'web' },
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(Object.keys(loaded.recipe.api!.servers!)).toEqual(['web', 'api-v2'])
    expect(loaded.recipe.api!.servers!['api-v2'].app).toBe('apps/api/v2')
  })

  it('refuses `serve` and `servers` together — a recipe has one shape', () => {
    const loaded = loadRaw(repo(), {
      build: 'true',
      api: { serve: ['node', 'server.js'], servers: { web: WEB }, defaultServer: 'web' },
    })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.message).toContain('never both')
  })

  it('refuses an api-level serve COMPANION beside `servers`', () => {
    for (const field of [{ cwd: 'repo' }, { healthPath: '/health' }, { readyTimeoutMs: 1000 }, { app: 'apps/web' }]) {
      const loaded = loadRaw(repo(), {
        build: 'true',
        api: { servers: { web: WEB }, ...field },
      })
      expect(loaded.ok).toBe(false)
      if (loaded.ok) continue
      expect(loaded.message).toContain('belongs to a server entry')
    }
  })

  it('refuses a `defaultServer` that names no declared server', () => {
    const loaded = loadRaw(repo(), {
      build: 'true',
      api: { servers: { web: WEB }, defaultServer: 'api-v2' },
    })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.message).toContain('is not a declared server')
  })

  it('requires `defaultServer` past one server (R1)', () => {
    const loaded = loadRaw(repo(), { build: 'true', api: { servers: { web: WEB, 'api-v2': V2 } } })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.message).toContain('defaultServer must name one of the declared servers')
  })

  it('refuses a credential allowlist naming an undeclared server', () => {
    const loaded = loadRaw(repo(), {
      build: 'true',
      api: {
        servers: { web: WEB },
        credentials: { key: { header: 'X-Key', value: 'k', servers: ['api-v2'] } },
      },
    })
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.message).toContain('server "api-v2" is not declared by this recipe')
  })
})

describe('resolveApiServers', () => {
  it('collapses a legacy `api.serve` into one server named `default`, defaults applied', () => {
    const recipe = loadRaw(repo(), {
      build: 'true',
      api: { serve: ['node', 'server.js'], cwd: 'repo' },
    })
    expect(recipe.ok).toBe(true)
    if (!recipe.ok) return
    const resolved = resolveApiServers(recipe.recipe)
    expect(resolved.defaultServer).toBe(DEFAULT_API_SERVER_NAME)
    const server = resolved.servers.get(DEFAULT_API_SERVER_NAME)!
    expect(server.serve).toEqual(['node', 'server.js'])
    expect(server.cwd).toBe('repo')
    expect(server.healthPath).toBe('/')
    expect(server.readyTimeoutMs).toBe(30_000)
  })

  it('layers env recipe ⊕ api.env ⊕ server.env, per server', () => {
    const recipe = loadRaw(repo(), {
      build: 'true',
      env: { A: 'recipe', B: 'recipe' },
      api: {
        env: { B: 'api', C: 'api' },
        servers: { web: { ...WEB, env: { C: 'web' } }, 'api-v2': V2 },
        defaultServer: 'web',
      },
    })
    expect(recipe.ok).toBe(true)
    if (!recipe.ok) return
    const resolved = resolveApiServers(recipe.recipe)
    expect(resolved.servers.get('web')!.env).toEqual({ A: 'recipe', B: 'api', C: 'web' })
    expect(resolved.servers.get('api-v2')!.env).toEqual({ A: 'recipe', B: 'api', C: 'api' })
  })

  it('resolves a scenario to its bound server, or an actionable reason', () => {
    const recipe = loadRaw(repo(), {
      build: 'true',
      api: { servers: { web: WEB, 'api-v2': V2 }, defaultServer: 'web' },
    })
    expect(recipe.ok).toBe(true)
    if (!recipe.ok) return
    const resolved = resolveApiServers(recipe.recipe)
    expect(resolveScenarioServer({}, resolved)).toMatchObject({ ok: true, server: { name: 'web' } })
    expect(resolveScenarioServer({ server: 'api-v2' }, resolved)).toMatchObject({
      ok: true,
      server: { name: 'api-v2', app: 'apps/api/v2' },
    })
    const missing = resolveScenarioServer({ server: 'api-v3' }, resolved)
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.reason).toBe(
      'scenario binds server "api-v3", which recipe.json does not declare (declared: web, api-v2)',
    )
  })
})
