import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  resolveApiCredentials,
  CredentialResolutionError,
  RecipeError,
  recipePath,
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
