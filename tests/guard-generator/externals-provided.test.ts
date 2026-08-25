/**
 * PROVIDED EXTERNAL ACCOUNTS in generate — the authoring half.
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
import {
  makeTempRepo,
  rmrf,
  writeDoc,
  writeCorpus,
  extractSessionBy,
  submitWorkerSessions,
  runGenerate,
  withExternalServices,
  writeApiRecipe,
  interfacesOf,
  apiInterface,
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

/** Run one api generate and hand back the api WORKER's briefing (the payload the
 *  retired one-shot author context used to carry). */
async function apiBriefing(repo: string, detected: { service: string; baseUrlEnv?: string }[]): Promise<string> {
  writeCorpus(repo, [{ ref: API_DOC }])
  writeDoc(repo, API_DOC, API_DOC_CONTENT)
  const briefings: string[] = []
  await runGenerate({
    repoRoot: repo,
    interfaces: withExternalServices(
      interfacesOf(repo, apiInterface('GET', '/todos')),
      ...detected.map((d) => ({ category: 'ai' as const, ...d })),
    ),
    extractSession: extractSessionBy({
      list: [{ driver: 'api', claim: 'GET /todos returns 200 with the todo list', reason: 'HTTP status' }],
    }),
    flowWorkerSession: submitWorkerSessions(() => rawApi('GET /todos answers 200', PASSING_API_STEPS), {
      onBriefing: (_task, text) => briefings.push(text),
    }),
  })
  return briefings[0]
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

    const prompt = await apiBriefing(r, [{ service: 'open-meteo', baseUrlEnv: 'OM_BASE' }])
    // The RECIPE's declaration wins over the detector's guess — GEOCODING_BASE_URL
    // is the var the runner actually injects, so OM_BASE never reaches the worker.
    expect(prompt).not.toContain('OM_BASE')
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

    const prompt = await apiBriefing(r, [{ service: 'open-meteo', baseUrlEnv: 'OM_BASE' }])
    expect(prompt).toContain('open-meteo (base URL env: OM_BASE')
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

    const prompt = await apiBriefing(r, [{ service: 'stripe', baseUrlEnv: 'STRIPE_API_BASE' }])
    // Both blocks render: stripe is still a blocker, billing-co is a capability.
    expect(prompt).toContain('detected in its source: stripe (base URL env: STRIPE_API_BASE — stubable via setup.http, or provide it)')
    expect(prompt).toContain('- billing-co: real account; the server reaches it via BILLING_BASE')
  })

  // The fault-injection vocabulary is advertised BESIDE the live-account
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

    const prompt = await apiBriefing(r, [{ service: 'open-meteo', baseUrlEnv: 'FORECAST_BASE_URL' }])
    expect(prompt).toContain('setup.externals')
    expect(prompt).toContain('fail once and then recover')
    expect(prompt).toContain('A flow about UPSTREAM FAILURE behavior is therefore authorable')
  })

  it('a repo with no externals declared renders no live-account block', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, { entry: null })
    const prompt = await apiBriefing(r, [{ service: 'stripe', baseUrlEnv: 'STRIPE_API_BASE' }])
    expect(prompt).toContain('stripe (base URL env: STRIPE_API_BASE')
    expect(prompt).not.toContain('AVAILABLE FOR REAL')
  })
})
