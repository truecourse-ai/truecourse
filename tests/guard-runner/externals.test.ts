import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  RecipeSchema,
  loadRecipe,
  computeRecipeFingerprint,
  loadExternalsLocal,
  mergeExternals,
  resolveExternals,
  loadResolvedExternals,
  externalsInjectEnv,
  externalsSecrets,
  firstIncompleteExternal,
  incompleteExternalMessage,
  ExternalsError,
  externalsLocalPath,
  recipePath,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from './helpers.js'

/**
 * External API accounts (item 62) — the schema, the committed/gitignored merge, the
 * one provided/incomplete/unprovided derivation, and the fingerprint split that
 * makes DECLARING a service re-author while ROTATING its key does not.
 */

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeRawRecipe(r: string, recipe: unknown): void {
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
}

function writeLocal(r: string, local: unknown): void {
  const target = externalsLocalPath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(local, null, 2))
}

/** A recipe with an api block carrying the given externals map. */
function recipeWith(externals: Record<string, unknown>): Record<string, unknown> {
  return { build: 'true', api: { serve: ['node', 'server.js'], externals } }
}

const OPEN_METEO = {
  baseUrlEnv: 'GEOCODING_BASE_URL',
  baseUrl: 'https://sandbox.open-meteo.test',
  mode: 'sandbox',
}

describe('api.externals — schema', () => {
  it('accepts a declaration-only entry and a fully provided one', () => {
    expect(RecipeSchema.safeParse(recipeWith({ 'open-meteo': OPEN_METEO })).success).toBe(true)
    expect(
      RecipeSchema.safeParse(
        recipeWith({ stripe: { baseUrlEnv: 'STRIPE_API_BASE', env: { STRIPE_KEY: {} } } }),
      ).success,
    ).toBe(true)
  })

  it('requires baseUrlEnv and rejects unknown keys (strict)', () => {
    expect(RecipeSchema.safeParse(recipeWith({ stripe: { baseUrl: 'https://x.test' } })).success).toBe(false)
    expect(
      RecipeSchema.safeParse(recipeWith({ stripe: { baseUrlEnv: 'X', apiKey: 'sk-live' } })).success,
    ).toBe(false)
  })

  it('rejects a non-absolute baseUrl and an unknown mode', () => {
    expect(
      RecipeSchema.safeParse(recipeWith({ stripe: { baseUrlEnv: 'X', baseUrl: 'x.test' } })).success,
    ).toBe(false)
    expect(
      RecipeSchema.safeParse(recipeWith({ stripe: { baseUrlEnv: 'X', mode: 'staging' } })).success,
    ).toBe(false)
  })

  it('an env var carries at most one source — both is refused, neither is the overlay shape', () => {
    const both = recipeWith({
      stripe: { baseUrlEnv: 'X', env: { KEY: { value: 'a', valueFromEnv: 'B' } } },
    })
    const parsed = RecipeSchema.safeParse(both)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join(' ')).toContain('at most one')
    }
    expect(RecipeSchema.safeParse(recipeWith({ stripe: { baseUrlEnv: 'X', env: { KEY: {} } } })).success).toBe(true)
  })

  it('refuses two services claiming the same env var — the injection would be ambiguous', () => {
    const parsed = RecipeSchema.safeParse(
      recipeWith({
        a: { baseUrlEnv: 'SHARED_BASE' },
        b: { baseUrlEnv: 'SHARED_BASE' },
      }),
    )
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain('exactly one owner')

    const envClash = RecipeSchema.safeParse(
      recipeWith({
        a: { baseUrlEnv: 'A_BASE', env: { SHARED_KEY: {} } },
        b: { baseUrlEnv: 'B_BASE', env: { SHARED_KEY: {} } },
      }),
    )
    expect(envClash.success).toBe(false)
  })
})

describe('externals.local.json — load + merge', () => {
  it('reads as empty when absent, and loudly rejects a broken file', () => {
    const r = repo()
    expect(loadExternalsLocal(r)).toEqual({})
    fs.mkdirSync(path.dirname(externalsLocalPath(r)), { recursive: true })
    fs.writeFileSync(externalsLocalPath(r), '{ nope')
    expect(() => loadExternalsLocal(r)).toThrow(ExternalsError)
    writeLocal(r, { stripe: { secretKey: 'sk' } })
    expect(() => loadExternalsLocal(r)).toThrow(/invalid/)
  })

  it('the overlay wins per FIELD; unmentioned recipe fields survive', () => {
    const merged = mergeExternals(
      {
        'open-meteo': {
          baseUrlEnv: 'GEO_BASE',
          baseUrl: 'https://committed.test',
          mode: 'sandbox',
          description: 'shared sandbox',
          env: { GEO_KEY: { valueFromEnv: 'HOST_GEO_KEY' } },
        },
      },
      { 'open-meteo': { baseUrl: 'https://local.test', env: { GEO_KEY: 'local-secret' } } },
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].baseUrl).toBe('https://local.test')
    expect(merged[0].baseUrlSource).toBe('local')
    expect(merged[0].mode).toBe('sandbox')
    expect(merged[0].description).toBe('shared sandbox')
    expect(merged[0].env[0]).toEqual({ name: 'GEO_KEY', valueFromEnv: 'HOST_GEO_KEY', localValue: 'local-secret' })
  })

  it('drops an overlay entry for an undeclared service and records undeclared env keys', () => {
    const merged = mergeExternals(
      { stripe: { baseUrlEnv: 'STRIPE_BASE', env: { STRIPE_KEY: {} } } },
      {
        stripe: { env: { STRIPE_KEY: 'sk', STRIPE_EXTRA: 'nope' } },
        sendgrid: { baseUrl: 'https://sg.test' },
      },
    )
    expect(merged.map((m) => m.service)).toEqual(['stripe'])
    expect(merged[0].undeclaredLocalEnv).toEqual(['STRIPE_EXTRA'])
  })
})

describe('provided / incomplete / unprovided', () => {
  const declared = {
    'open-meteo': { baseUrlEnv: 'GEO_BASE', env: { GEO_KEY: { valueFromEnv: 'HOST_GEO_KEY' } } },
  }

  it('every requirement met ⇒ provided, and it injects base URL + key', () => {
    const [external] = resolveExternals(declared, { 'open-meteo': { baseUrl: 'https://geo.test', env: { GEO_KEY: 'k1' } } }, {})
    expect(external.state).toBe('provided')
    expect(externalsInjectEnv([external])).toEqual({ GEO_BASE: 'https://geo.test', GEO_KEY: 'k1' })
    expect([...externalsSecrets([external])]).toEqual([['open-meteo.GEO_KEY', 'k1']])
  })

  it('the host env resolves a valueFromEnv key; blank counts as unset', () => {
    const provided = resolveExternals(declared, { 'open-meteo': { baseUrl: 'https://geo.test' } }, { HOST_GEO_KEY: 'k2' })
    expect(provided[0].state).toBe('provided')
    expect(provided[0].requirements.find((r) => r.envVar === 'GEO_KEY')?.source).toBe('process-env')

    const blank = resolveExternals(declared, { 'open-meteo': { baseUrl: 'https://geo.test' } }, { HOST_GEO_KEY: '  ' })
    expect(blank[0].state).toBe('incomplete')
    expect(blank[0].requirements.find((r) => r.envVar === 'GEO_KEY')?.reason).toContain('set but empty')
  })

  it('nothing configured ⇒ unprovided, injecting nothing (flows stay blocked)', () => {
    const [external] = resolveExternals(declared, {}, {})
    expect(external.state).toBe('unprovided')
    expect(external.inject).toEqual({})
    expect(external.requirements.every((r) => !r.resolved)).toBe(true)
  })

  it('partly configured ⇒ incomplete, injecting nothing and naming what is missing', () => {
    const noBaseUrl = resolveExternals(declared, { 'open-meteo': { env: { GEO_KEY: 'k' } } }, {})[0]
    expect(noBaseUrl.state).toBe('incomplete')
    expect(noBaseUrl.inject).toEqual({})
    expect(noBaseUrl.secrets).toEqual([])
    expect(firstIncompleteExternal([noBaseUrl])?.service).toBe('open-meteo')
    expect(incompleteExternalMessage(noBaseUrl)).toContain('GEO_BASE')
    expect(incompleteExternalMessage(noBaseUrl)).toContain('externals.local.json')
  })

  it('an inline recipe value resolves, and a base-URL-only service with no env is provided', () => {
    const [external] = resolveExternals(
      { svc: { baseUrlEnv: 'SVC_BASE', baseUrl: 'https://svc.test', env: { SVC_ID: { value: 'acct-1' } } } },
      {},
      {},
    )
    expect(external.state).toBe('provided')
    expect(external.inject).toEqual({ SVC_BASE: 'https://svc.test', SVC_ID: 'acct-1' })

    const bare = resolveExternals({ svc: { baseUrlEnv: 'B', baseUrl: 'https://b.test' } }, {}, {})[0]
    expect(bare.state).toBe('provided')
  })

  it('loadResolvedExternals reads the overlay from disk', () => {
    const r = repo()
    writeLocal(r, { 'open-meteo': { baseUrl: 'https://disk.test', env: { GEO_KEY: 'disk-key' } } })
    const [external] = loadResolvedExternals(r, declared, {})
    expect(external.state).toBe('provided')
    expect(external.baseUrl).toBe('https://disk.test')
  })
})

describe('the recipe fingerprint', () => {
  it('MOVES when a service is declared — the self-unblocking signal', () => {
    const r = repo()
    writeRawRecipe(r, { build: 'true', api: { serve: ['node', 's.js'] } })
    const before = computeRecipeFingerprint(r)
    writeRawRecipe(r, recipeWith({ 'open-meteo': OPEN_METEO }))
    expect(computeRecipeFingerprint(r)).not.toBe(before)
  })

  it('does NOT move when an inline env value rotates (a key is never a re-author)', () => {
    const r = repo()
    writeRawRecipe(r, recipeWith({ svc: { baseUrlEnv: 'B', env: { K: { value: 'sk-old' } } } }))
    const before = computeRecipeFingerprint(r)
    writeRawRecipe(r, recipeWith({ svc: { baseUrlEnv: 'B', env: { K: { value: 'sk-new' } } } }))
    expect(computeRecipeFingerprint(r)).toBe(before)
  })

  it('is NEUTRAL to the local overlay — a supplied secret or URL never re-authors', () => {
    const r = repo()
    writeRawRecipe(r, recipeWith({ 'open-meteo': { baseUrlEnv: 'GEO_BASE', env: { GEO_KEY: {} } } }))
    const before = computeRecipeFingerprint(r)
    writeLocal(r, { 'open-meteo': { baseUrl: 'https://sandbox.test', env: { GEO_KEY: 'sk-1' } } })
    expect(computeRecipeFingerprint(r)).toBe(before)
    writeLocal(r, { 'open-meteo': { baseUrl: 'https://other.test', env: { GEO_KEY: 'sk-2' } } })
    expect(computeRecipeFingerprint(r)).toBe(before)
  })

  it('MOVES when the declaration itself changes (a new env var, a committed base URL)', () => {
    const r = repo()
    writeRawRecipe(r, recipeWith({ svc: { baseUrlEnv: 'B' } }))
    const bare = computeRecipeFingerprint(r)
    writeRawRecipe(r, recipeWith({ svc: { baseUrlEnv: 'B', env: { K: {} } } }))
    const withEnv = computeRecipeFingerprint(r)
    expect(withEnv).not.toBe(bare)
    writeRawRecipe(r, recipeWith({ svc: { baseUrlEnv: 'B', baseUrl: 'https://b.test', env: { K: {} } } }))
    expect(computeRecipeFingerprint(r)).not.toBe(withEnv)
  })

  it('a declared external loads through loadRecipe', () => {
    const r = repo()
    writeRawRecipe(r, recipeWith({ 'open-meteo': OPEN_METEO }))
    const loaded = loadRecipe(r, recipePath(r))
    expect(loaded?.recipe.api?.externals?.['open-meteo'].baseUrl).toBe('https://sandbox.open-meteo.test')
  })
})
