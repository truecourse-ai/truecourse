/**
 * PROVIDED EXTERNAL ACCOUNTS in generate (item 62) — the authoring half.
 *
 * Phase 3 advertises detected third parties as BLOCKERS worth naming. When the user
 * declares an account for one in `api.externals` and it fully resolves, the same
 * service must flip to a CAPABILITY: announced as live, never stubbed, asserted on
 * shapes. A declared-but-incomplete account must NOT flip it — the runner refuses
 * that repo, so authoring against it would be a lie.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildAuthorUserPrompt, type AuthorUserContext } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  runGenerate,
  withExternalServices,
  writeApiRecipe,
  journeysOf,
  apiJourney,
  rawApi,
  PASSING_API_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const API_DOC = 'docs/api.md'
const API_DOC_CONTENT = ['## list', 'GET /todos returns 200 with the todo list.'].join('\n')

function writeLocal(repo: string, local: unknown): void {
  const target = path.join(repo, '.truecourse', 'scenarios', 'externals.local.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(local, null, 2))
}

/** Run one api generate and hand back the api author context it built. */
async function apiContext(repo: string, detected: { service: string; baseUrlEnv?: string }[]): Promise<AuthorUserContext> {
  writeCorpus(repo, [{ ref: API_DOC }])
  writeDoc(repo, API_DOC, API_DOC_CONTENT)
  const contexts: AuthorUserContext[] = []
  await runGenerate({
    repoRoot: repo,
    journeys: withExternalServices(
      journeysOf(repo, apiJourney('GET', '/todos')),
      ...detected.map((d) => ({ category: 'ai' as const, ...d })),
    ),
    extractRunner: extractBy({
      list: [{ driver: 'api', claim: 'GET /todos returns 200 with the todo list', reason: 'HTTP status' }],
    }),
    generateRunner: authorBy({ list: rawApi('GET /todos answers 200', PASSING_API_STEPS) }, (ctx) =>
      contexts.push(ctx),
    ),
  })
  return contexts.find((c) => c.driver === 'api')!
}

describe('generate — a PROVIDED external is advertised as live', () => {
  it('flips a detected service from blocker to capability and forbids stubbing it', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, {
      entry: null,
      externals: {
        'open-meteo': {
          baseUrlEnv: 'GEOCODING_BASE_URL',
          baseUrl: 'https://sandbox.open-meteo.test',
          mode: 'sandbox',
          description: 'shared team sandbox',
          env: { GEO_KEY: {} },
        },
      },
    })
    writeLocal(r, { 'open-meteo': { env: { GEO_KEY: 'sandbox-key' } } })

    const ctx = await apiContext(r, [{ service: 'open-meteo', baseUrlEnv: 'OM_BASE' }])
    expect(ctx.externalServices).toEqual([
      {
        name: 'open-meteo',
        // The RECIPE's declaration wins over the detector's guess — it is the var
        // the runner actually injects.
        baseUrlEnv: 'GEOCODING_BASE_URL',
        provided: true,
        mode: 'sandbox',
        description: 'shared team sandbox',
      },
    ])

    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('EXTERNAL SERVICES AVAILABLE FOR REAL')
    expect(prompt).toContain('open-meteo: sandbox account; the server reaches it via GEOCODING_BASE_URL; shared team sandbox')
    expect(prompt).toContain('do NOT stub them')
    expect(prompt).toContain('assert shapes and invariants')
    // It is no longer listed among the blockers.
    expect(prompt).not.toContain('THIRD PARTIES THIS REPO DEPENDS ON')
  })

  it('a declared but INCOMPLETE account changes nothing — the service stays a blocker', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, {
      entry: null,
      externals: {
        'open-meteo': {
          baseUrlEnv: 'GEOCODING_BASE_URL',
          baseUrl: 'https://sandbox.open-meteo.test',
          env: { GEO_KEY: { valueFromEnv: 'TC_UNSET_GEO_KEY' } },
        },
      },
    })

    const ctx = await apiContext(r, [{ service: 'open-meteo', baseUrlEnv: 'OM_BASE' }])
    expect(ctx.externalServices).toEqual([{ name: 'open-meteo', baseUrlEnv: 'OM_BASE' }])
    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('THIRD PARTIES THIS REPO DEPENDS ON')
    expect(prompt).not.toContain('EXTERNAL SERVICES AVAILABLE FOR REAL')
  })

  it('advertises a PROVIDED account the detector never saw, and keeps the blockers beside it', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, {
      entry: null,
      externals: { 'billing-co': { baseUrlEnv: 'BILLING_BASE', baseUrl: 'https://billing.test', mode: 'real' } },
    })

    const ctx = await apiContext(r, [{ service: 'stripe', baseUrlEnv: 'STRIPE_API_BASE' }])
    expect(ctx.externalServices).toEqual([
      { name: 'stripe', baseUrlEnv: 'STRIPE_API_BASE' },
      { name: 'billing-co', baseUrlEnv: 'BILLING_BASE', provided: true, mode: 'real' },
    ])
    const prompt = buildAuthorUserPrompt(ctx)
    // Both blocks render: stripe is still a blocker, billing-co is a capability.
    expect(prompt).toContain('detected in its source: stripe (base URL env: STRIPE_API_BASE — stubable via setup.http, or provide it)')
    expect(prompt).toContain('- billing-co: real account; the server reaches it via BILLING_BASE')
  })

  // Item 64: the fault-injection vocabulary is advertised BESIDE the live-account
  // rules — a flow about upstream failure is authorable, not blocked.
  it('tells the author a provided account\u2019s FAULTS are scriptable', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, {
      entry: null,
      externals: {
        'open-meteo': { baseUrlEnv: 'FORECAST_BASE_URL', baseUrl: 'https://sandbox.open-meteo.test' },
      },
    })

    const ctx = await apiContext(r, [{ service: 'open-meteo', baseUrlEnv: 'FORECAST_BASE_URL' }])
    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('setup.externals')
    expect(prompt).toContain('fail once and then recover')
    expect(prompt).toContain('A flow about UPSTREAM FAILURE behavior is therefore authorable')
  })

  it('a repo with no externals declared renders the pre-item-62 prompt byte-identically', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, { entry: null })
    const ctx = await apiContext(r, [{ service: 'stripe', baseUrlEnv: 'STRIPE_API_BASE' }])
    expect(ctx.externalServices).toEqual([{ name: 'stripe', baseUrlEnv: 'STRIPE_API_BASE' }])
    expect(buildAuthorUserPrompt(ctx)).not.toContain('AVAILABLE FOR REAL')
  })
})
