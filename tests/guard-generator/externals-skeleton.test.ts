/**
 * The externals declaration skeleton (`guard setup`, step 3) — pure derivation, so these
 * tests are pure too.
 *
 * The two invariants worth defending are both "never be confidently wrong": the
 * skeleton must never INVENT a `baseUrlEnv` (it is injected into the app's env at
 * every run), and it must never EDIT a declaration the user already has.
 */

import { describe, it, expect } from 'vitest'
import { deriveExternalsSkeleton } from '@truecourse/guard-generator'
import { resolveExternals, firstIncompleteExternal } from '@truecourse/guard-runner'
import type { DetectedExternalService } from '@truecourse/shared'
import type { Recipe } from '@truecourse/guard-runner'

const apiRecipe = (externals?: Record<string, unknown>): Recipe =>
  ({
    build: 'true',
    api: { serve: ['node', 'dist/index.js'], ...(externals ? { externals } : {}) },
  }) as Recipe

const detected = (over: Partial<DetectedExternalService> & { service: string }): DetectedExternalService =>
  ({ evidence: [], ...over }) as DetectedExternalService

describe('deriveExternalsSkeleton', () => {
  it('declares a detected service with the base-URL variable detection saw', () => {
    const skeleton = deriveExternalsSkeleton(
      apiRecipe(),
      [detected({ service: 'stripe', category: 'payment', baseUrlEnv: 'STRIPE_BASE_URL' })],
    )

    expect(skeleton.declare.stripe.baseUrlEnv).toBe('STRIPE_BASE_URL')
    // No baseUrl: the ACCOUNT is the user's to supply, and its absence is exactly
    // the "declared but not provided" state authoring already handles.
    expect(skeleton.declare.stripe.baseUrl).toBeUndefined()
    expect(skeleton.declare.stripe.description).toMatch(/no account provided yet/)
    expect(skeleton.undeclarable).toEqual([])
  })

  // The central trick: a service with NO account still gets its declaration in, so
  // supplying the key later touches only the gitignored overlay and re-authors nothing.
  it('declares a service the user has no account for', () => {
    const skeleton = deriveExternalsSkeleton(apiRecipe(), [
      detected({ service: 'sendgrid', baseUrlEnv: 'SENDGRID_BASE_URL' }),
    ])

    expect(Object.keys(skeleton.declare)).toEqual(['sendgrid'])
  })

  // A vendor reached through several hosts has one variable per host, and
  // each is an ORIGIN the runner proxies — not a key it forwards.
  it('turns the extra detected base-URL variables into `endpoints`', () => {
    const skeleton = deriveExternalsSkeleton(apiRecipe(), [
      detected({
        service: 'open-meteo',
        source: 'http',
        baseUrlEnvs: [
          { envVar: 'GEOCODING_BASE_URL', defaultUrl: 'https://geocoding-api.open-meteo.com', confidence: 'literal-fallback' },
          { envVar: 'FORECAST_BASE_URL', defaultUrl: 'https://api.open-meteo.com', confidence: 'literal-fallback' },
        ],
      }),
    ])

    expect(skeleton.declare['open-meteo']).toMatchObject({
      baseUrlEnv: 'GEOCODING_BASE_URL',
      endpoints: { FORECAST_BASE_URL: 'https://api.open-meteo.com' },
    })
  })

  // `baseUrlEnv` is REQUIRED by the schema and is injected into the app's env at
  // every run — so a guess would silently point the app somewhere it never reads.
  it('reports a service with no detected base-URL variable as UNDECLARABLE', () => {
    const skeleton = deriveExternalsSkeleton(apiRecipe(), [detected({ service: 'twilio' })])

    expect(skeleton.declare).toEqual({})
    expect(skeleton.undeclarable).toEqual(['twilio'])
  })

  it('leaves an already-declared service byte-identical', () => {
    const recipe = apiRecipe({
      stripe: { baseUrlEnv: 'MY_STRIPE_URL', baseUrl: 'https://sandbox.stripe.test', mode: 'sandbox' },
    })

    const skeleton = deriveExternalsSkeleton(recipe, [
      detected({ service: 'stripe', baseUrlEnv: 'STRIPE_BASE_URL' }),
    ])

    expect(skeleton.declare).toEqual({})
    expect(skeleton.alreadyDeclared).toEqual(['stripe'])
  })

  // The recipe schema refuses two owners for one variable; the skeleton must not be
  // the thing that produces such a recipe.
  it('never re-claims a variable another declaration already owns', () => {
    const recipe = apiRecipe({ payments: { baseUrlEnv: 'STRIPE_BASE_URL' } })

    const skeleton = deriveExternalsSkeleton(recipe, [
      detected({ service: 'stripe', baseUrlEnv: 'STRIPE_BASE_URL' }),
    ])

    expect(skeleton.declare).toEqual({})
    expect(skeleton.undeclarable).toEqual(['stripe'])
  })

  it('is stable: services are declared in name order', () => {
    const skeleton = deriveExternalsSkeleton(apiRecipe(), [
      detected({ service: 'zzz', baseUrlEnv: 'Z_URL' }),
      detected({ service: 'aaa', baseUrlEnv: 'A_URL' }),
    ])

    expect(Object.keys(skeleton.declare)).toEqual(['aaa', 'zzz'])
  })
})

/**
 * THE INVARIANT THIS MODULE'S HEADER CLAIMS, now enforced rather than asserted in
 * prose: "a declared-but-unprovided entry is a state authoring already treats
 * identically to undeclared … so the skeleton changes no verdict today".
 *
 * It was false for a service detection saw through more than one host: the derived
 * `endpoints` entry resolved on its own, so the service read `incomplete` and the
 * runner hard-stopped every flow in the repo (cal.diy, `hit-pay`). Setup writes these
 * declarations unasked, so the property must hold for EVERY detection shape.
 */
describe('the skeleton never changes a verdict', () => {
  const shapes: { name: string; detected: DetectedExternalService[] }[] = [
    { name: 'one base-URL variable', detected: [detected({ service: 'sendgrid', baseUrlEnv: 'SENDGRID_BASE_URL' })] },
    {
      name: 'two base-URL variables, both with default URLs (the cal.diy hit-pay shape)',
      detected: [
        detected({
          service: 'hit-pay',
          category: 'payment',
          source: 'http',
          baseUrlEnvs: [
            { envVar: 'NEXT_PUBLIC_API_HITPAY', defaultUrl: 'https://api.hit-pay.com', confidence: 'literal-fallback' },
            { envVar: 'NEXT_PUBLIC_API_HITPAY_SANDBOX', defaultUrl: 'https://api.sandbox.hit-pay.com', confidence: 'literal-fallback' },
          ],
        }),
      ],
    },
    {
      name: 'three base-URL variables, one without a default URL',
      detected: [
        detected({
          service: 'acme',
          baseUrlEnvs: [
            { envVar: 'ACME_A', defaultUrl: 'https://a.acme.test', confidence: 'literal-fallback' },
            { envVar: 'ACME_B', confidence: 'name-heuristic' },
            { envVar: 'ACME_C', defaultUrl: 'https://c.acme.test', confidence: 'literal-fallback' },
          ],
        }),
      ],
    },
    {
      name: 'several services at once, mixed shapes',
      detected: [
        detected({ service: 'stripe', category: 'payment', baseUrlEnv: 'STRIPE_BASE_URL' }),
        detected({ service: 'twilio' }),
        detected({
          service: 'open-meteo',
          source: 'http',
          baseUrlEnvs: [
            { envVar: 'GEOCODING_BASE_URL', defaultUrl: 'https://geocoding-api.open-meteo.com', confidence: 'literal-fallback' },
            { envVar: 'FORECAST_BASE_URL', defaultUrl: 'https://api.open-meteo.com', confidence: 'literal-fallback' },
          ],
        }),
      ],
    },
  ]

  for (const shape of shapes) {
    it(`every skeleton-declared service resolves UNPROVIDED — ${shape.name}`, () => {
      const { declare } = deriveExternalsSkeleton(apiRecipe(), shape.detected)
      const resolved = resolveExternals(declare, {}, {})

      expect(resolved.length).toBe(Object.keys(declare).length)
      expect(resolved.map((e) => e.state)).toEqual(resolved.map(() => 'unprovided'))
      // Which is the whole point: no injection, and no run-stopping veto.
      expect(resolved.every((e) => Object.keys(e.inject).length === 0)).toBe(true)
      expect(firstIncompleteExternal(resolved)).toBeNull()
    })
  }
})
