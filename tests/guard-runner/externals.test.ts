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
  externalProxyTargets,
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

// Item 64: extra base-URL variables are a first-class block, not env rows.
describe('api.externals.endpoints — schema + resolution', () => {
  it('accepts absolute origins and refuses anything else', () => {
    expect(
      RecipeSchema.safeParse(
        recipeWith({
          'open-meteo': {
            baseUrlEnv: 'FORECAST_BASE_URL',
            baseUrl: 'https://api.open-meteo.test',
            endpoints: { GEOCODING_BASE_URL: 'https://geo.open-meteo.test' },
          },
        }),
      ).success,
    ).toBe(true)
    expect(
      RecipeSchema.safeParse(
        recipeWith({ v: { baseUrlEnv: 'A', endpoints: { B: 'geo.test' } } }),
      ).success,
    ).toBe(false)
  })

  it('one variable has exactly one source — within a service and across two', () => {
    const withinService = RecipeSchema.safeParse(
      recipeWith({ v: { baseUrlEnv: 'A', endpoints: { A: 'https://x.test' } } }),
    )
    expect(withinService.success).toBe(false)
    if (!withinService.success) {
      expect(withinService.error.issues[0].message).toContain('declared twice')
    }
    const acrossServices = RecipeSchema.safeParse(
      recipeWith({
        a: { baseUrlEnv: 'A_BASE', endpoints: { SHARED: 'https://x.test' } },
        b: { baseUrlEnv: 'SHARED' },
      }),
    )
    expect(acrossServices.success).toBe(false)
  })

  it('each endpoint is a resolved requirement, is injected, and is proxy-visible', () => {
    const [resolved] = resolveExternals(
      {
        'open-meteo': {
          baseUrlEnv: 'FORECAST_BASE_URL',
          baseUrl: 'https://api.open-meteo.test',
          endpoints: { GEOCODING_BASE_URL: 'https://geo.open-meteo.test' },
        },
      },
      {},
      {},
    )
    expect(resolved.state).toBe('provided')
    expect(resolved.requirements.filter((r) => r.kind === 'base-url').map((r) => r.envVar)).toEqual([
      'FORECAST_BASE_URL',
      'GEOCODING_BASE_URL',
    ])
    expect(resolved.inject).toEqual({
      FORECAST_BASE_URL: 'https://api.open-meteo.test',
      GEOCODING_BASE_URL: 'https://geo.open-meteo.test',
    })
    expect(externalProxyTargets([resolved])).toEqual([
      {
        service: 'open-meteo',
        endpoints: [
          { envVar: 'FORECAST_BASE_URL', url: 'https://api.open-meteo.test' },
          { envVar: 'GEOCODING_BASE_URL', url: 'https://geo.open-meteo.test' },
        ],
      },
    ])
  })

  it('the overlay overrides one endpoint and surfaces an undeclared one', () => {
    const [merged] = mergeExternals(
      { v: { baseUrlEnv: 'A', baseUrl: 'https://a.test', endpoints: { B: 'https://b.test' } } },
      { v: { endpoints: { B: 'https://local-b.test', C: 'https://stray.test' } } },
    )
    expect(merged.endpoints).toEqual([{ envVar: 'B', url: 'https://local-b.test', source: 'local' }])
    expect(merged.undeclaredLocalEnv).toEqual(['C'])
  })

  it('an UNPROVIDED service exposes no proxy targets at all', () => {
    const [resolved] = resolveExternals({ v: { baseUrlEnv: 'A' } }, {}, {})
    expect(resolved.state).toBe('unprovided')
    expect(externalProxyTargets([resolved])).toEqual([])
  })

  /**
   * THE REGRESSION (cal.diy, 93 flows, zero tests). A skeleton declaration carries a
   * `baseUrlEnv` and, when detection saw a second host, an `endpoints` entry whose URL
   * came out of the CODEBASE. Counting that auto-resolved requirement made the service
   * `incomplete` — 1 of 2 satisfied — and one such service hard-stopped every run,
   * while the same skeleton with a single base-URL variable read `unprovided` and was
   * correctly ignored. Nothing about a second host is a request to reach the vendor.
   */
  it('a declaration-derived endpoint never moves the state — nothing supplied ⇒ unprovided', () => {
    const [resolved] = resolveExternals(
      {
        'hit-pay': {
          baseUrlEnv: 'NEXT_PUBLIC_API_HITPAY',
          endpoints: { NEXT_PUBLIC_API_HITPAY_SANDBOX: 'https://api.sandbox.hit-pay.test' },
        },
      },
      {},
      {},
    )
    expect(resolved.state).toBe('unprovided')
    expect(resolved.inject).toEqual({})
    expect(firstIncompleteExternal([resolved])).toBeNull()
    // Still LISTED, so `guard status` and the dashboard show the second host.
    expect(resolved.requirements.map((r) => [r.envVar, r.resolved, r.derived === true])).toEqual([
      ['NEXT_PUBLIC_API_HITPAY', false, false],
      ['NEXT_PUBLIC_API_HITPAY_SANDBOX', true, true],
    ])
  })

  // The overlay is the user pointing this host somewhere: that IS intent, so it votes
  // — and with the primary still missing, the dangerous half-configured state stands.
  it("a 'local' endpoint override counts as user intent ⇒ incomplete", () => {
    const declared = {
      'hit-pay': { baseUrlEnv: 'HITPAY_BASE', endpoints: { HITPAY_SANDBOX: 'https://prod.test' } },
    }
    const [resolved] = resolveExternals(declared, {
      'hit-pay': { endpoints: { HITPAY_SANDBOX: 'https://my-sandbox.test' } },
    }, {})
    expect(resolved.state).toBe('incomplete')
    expect(firstIncompleteExternal([resolved])?.service).toBe('hit-pay')
    expect(resolved.requirements.find((r) => r.envVar === 'HITPAY_SANDBOX')?.derived).toBeUndefined()

    // Supply the primary too and the same declaration is fully provided.
    const [full] = resolveExternals(declared, {
      'hit-pay': { baseUrl: 'https://my-hitpay.test', endpoints: { HITPAY_SANDBOX: 'https://my-sandbox.test' } },
    }, {})
    expect(full.state).toBe('provided')
    expect(full.inject).toEqual({
      HITPAY_BASE: 'https://my-hitpay.test',
      HITPAY_SANDBOX: 'https://my-sandbox.test',
    })
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

  // The derived endpoint is excluded from the vote in BOTH directions: it cannot
  // manufacture an `incomplete`, and it cannot hide one either.
  it('a derived endpoint does not rescue a half-configured account', () => {
    const [external] = resolveExternals(
      {
        'open-meteo': {
          baseUrlEnv: 'GEO_BASE',
          endpoints: { FORECAST_BASE: 'https://forecast.test' },
          env: { GEO_KEY: {} },
        },
      },
      { 'open-meteo': { env: { GEO_KEY: 'k' } } },
      {},
    )
    expect(external.state).toBe('incomplete')
    expect(external.inject).toEqual({})
    expect(incompleteExternalMessage(external)).toContain('GEO_BASE')
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
