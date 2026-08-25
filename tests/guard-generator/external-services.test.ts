/**
 * EXTERNAL SERVICES in generate — the detected third parties a
 * blocked flow is stamped with.
 *
 * Three things are asserted here, because three surfaces read the same fact:
 *  - `enrichBlockedOn` — the pure rewrite (generic noun → the repo's services),
 *    including what it must NOT rewrite;
 *  - the WIRING — a refusal's gap reason names the services, the reason still
 *    round-trips through `parseBlockedOnCapabilities`, and the run summary tallies
 *    per SERVICE rather than per placeholder;
 *  - the REPORT — the whole detected list rides `result.json`, independent of gaps.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  buildAuthorUserPrompt,
  enrichBlockedOn,
  GENERATE_API_SYSTEM_PROMPT,
  type AuthorUserContext,
} from '@truecourse/guard-generator'
import {
  GuardGenerateReportSchema,
  composeGuardStatus,
  parseBlockedOnCapabilities,
  type DetectedExternalService,
} from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractSessionBy,
  submitWorkerSessions,
  raw,
  PASSING_STEPS,
  runGenerate,
  withExternalServices,
  writeApiRecipe,
  interfacesOf,
  apiInterface,
  rawApi,
  PASSING_API_STEPS,
  DEFAULT_INTERFACES,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const API_DOC = 'docs/api.md'
const API_DOC_CONTENT = ['## list', 'GET /todos returns 200 with the todo list.'].join('\n')

const DOC = 'docs/pay.md'
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const svc = (service: string, category: DetectedExternalService['category'] = 'payment'): DetectedExternalService => ({
  service,
  category,
  evidence: [{ filePath: 'src/pay.ts', importSource: service }],
})

describe('enrichBlockedOn', () => {
  const detected = [svc('stripe'), svc('sendgrid', 'messaging')]

  it('replaces a generic third-party noun with the repo’s detected services', () => {
    expect(enrichBlockedOn(['external-service'], detected)).toEqual(['stripe', 'sendgrid'])
    expect(enrichBlockedOn(['third party'], detected)).toEqual(['stripe', 'sendgrid'])
    expect(enrichBlockedOn(['saas'], detected)).toEqual(['stripe', 'sendgrid'])
  })

  it('canonicalizes a noun that already names a detected service', () => {
    expect(enrichBlockedOn(['stripe api'], detected)).toEqual(['stripe'])
    expect(enrichBlockedOn(['Stripe'], detected)).toEqual(['stripe'])
    // Word-boundary only — a name that merely CONTAINS a service is not that service.
    expect(enrichBlockedOn(['restripes'], detected)).toEqual(['restripes'])
  })

  it('leaves every other capability alone — it only ever adds information', () => {
    expect(enrichBlockedOn(['db', 'credentials'], detected)).toEqual(['db', 'credentials'])
    // `service` is deliberately NOT generic: a sibling service is not a third party.
    expect(enrichBlockedOn(['service'], detected)).toEqual(['service'])
    // Nothing detected → nothing to say; the honest generic noun survives.
    expect(enrichBlockedOn(['external-service'], [])).toEqual(['external-service'])
  })

  it('dedupes across nouns and keeps first-seen order', () => {
    expect(enrichBlockedOn(['stripe', 'external-service', 'db'], detected)).toEqual(['stripe', 'sendgrid', 'db'])
  })
})

describe('generateGuards — blocked-on gaps carry the detected services', () => {
  it('names the services in the capability segment, so the reason round-trips and tallies per service', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      interfaces: withExternalServices(
        DEFAULT_INTERFACES(r),
        { service: 'stripe', category: 'payment' },
        { service: 'sendgrid', category: 'messaging' },
      ),
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({ blocked: [{ order: 1, capability: 'external-service' }] })),
    })

    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.reason).toBe('blocked on stripe, sendgrid: version')
    // The format is unchanged, so the shared inverse still recovers the nouns…
    expect(parseBlockedOnCapabilities(gap.reason)).toEqual(['stripe', 'sendgrid'])
    // …and the EXISTING breakdown counts third parties by name, not by placeholder.
    const summary = composeGuardStatus(null, null, { ...res, generatedAt: '2026-07-28T00:00:00Z' }).lastGenerate!
    expect(summary.blockedOnCapabilities).toEqual({ stripe: 1, sendgrid: 1 })
  })

  it('leaves the reason untouched when nothing was detected', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({ blocked: [{ order: 1, capability: 'external-service' }] })),
    })

    expect(res.coverageGaps.find((g) => g.kind === 'blocked-on')!.reason).toBe('blocked on external-service: version')
    expect(res.externalServices).toEqual([])
  })

  it('reports the whole detected list on the result, gaps or no gaps', async () => {
    const r = seed()

    const res = await runGenerate({
      repoRoot: r,
      interfaces: withExternalServices(DEFAULT_INTERFACES(r), { service: 'stripe', category: 'payment' }),
      extractSession: extractSessionBy({}),
      // Nothing is blocked — the dependency is still a fact about the repo.
      flowWorkerSession: submitWorkerSessions(() => raw('the version prints', PASSING_STEPS)),
    })

    expect(res.externalServices.map((s) => s.service)).toEqual(['stripe'])
    // …and it survives the persisted report's strict schema.
    const parsed = GuardGenerateReportSchema.safeParse({ ...res, generatedAt: '2026-07-28T00:00:00Z' })
    expect(parsed.success).toBe(true)
  })
})

describe('generateGuards — the api worker briefing advertises the detected services', () => {
  it('names the canonical services in the api worker briefing', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: API_DOC }])
    writeDoc(r, API_DOC, API_DOC_CONTENT)
    const briefings: string[] = []

    await runGenerate({
      repoRoot: r,
      interfaces: withExternalServices(
        interfacesOf(r, apiInterface('GET', '/todos')),
        { service: 'stripe', category: 'payment' },
      ),
      extractSession: extractSessionBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status' }],
      }),
      flowWorkerSession: submitWorkerSessions(() => rawApi('GET /todos answers 200', PASSING_API_STEPS), {
        onBriefing: (_task, text) => briefings.push(text),
      }),
    })

    // The api worker's BRIEFING renders them as the blockers worth naming —
    // never as a capability.
    expect(briefings).toHaveLength(1)
    expect(briefings[0]).toContain('THIRD PARTIES THIS REPO DEPENDS ON — detected in its source: stripe.')
    expect(briefings[0]).toContain('"blockedOn": ["stripe"]')

    // A context with no detection renders the prompt exactly as before.
    const bare = buildAuthorUserPrompt({
      flow: { id: 'f', title: 't', goal: 'g' },
      milestones: [],
      interfacePath: [],
      areaTags: [],
      driver: 'api',
      recipeEntry: [],
      recipeBuild: 'true',
    } as AuthorUserContext)
    expect(bare).not.toContain('THIRD PARTIES')
  })

  // A detected base-URL env var is the `setup.http` precondition,
  // so the per-repo list says which service is stubable and which is a real blocker.
  it('names the base-URL env var — and the stub — for a service that has one', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: API_DOC }])
    writeDoc(r, API_DOC, API_DOC_CONTENT)
    const briefings: string[] = []

    await runGenerate({
      repoRoot: r,
      interfaces: withExternalServices(
        interfacesOf(r, apiInterface('GET', '/todos')),
        { service: 'stripe', category: 'payment', baseUrlEnv: 'STRIPE_API_BASE' },
      ),
      extractSession: extractSessionBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status' }],
      }),
      flowWorkerSession: submitWorkerSessions(() => rawApi('GET /todos answers 200', PASSING_API_STEPS), {
        onBriefing: (_task, text) => briefings.push(text),
      }),
    })

    expect(briefings[0]).toContain('stripe (base URL env: STRIPE_API_BASE — stubable via setup.http, or provide it)')
    expect(briefings[0]).toContain('${HTTP_STUB:<name>}')
  })

  // An HTTP-detected vendor is often reached through SEVERAL hosts, each with
  // its own override variable. A stub that only redirects one leaves the other live,
  // so the prompt must advertise all of them.
  it('names EVERY base-URL env var of a service reached through more than one host', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: API_DOC }])
    writeDoc(r, API_DOC, API_DOC_CONTENT)
    const briefings: string[] = []

    await runGenerate({
      repoRoot: r,
      interfaces: withExternalServices(interfacesOf(r, apiInterface('GET', '/todos')), {
        service: 'open-meteo',
        source: 'http',
        baseUrlEnv: 'GEOCODING_BASE_URL',
        baseUrlEnvs: [
          {
            envVar: 'GEOCODING_BASE_URL',
            defaultUrl: 'https://geocoding-api.open-meteo.com',
            confidence: 'literal-fallback',
          },
          {
            envVar: 'FORECAST_BASE_URL',
            defaultUrl: 'https://api.open-meteo.com',
            confidence: 'literal-fallback',
          },
        ],
      }),
      extractSession: extractSessionBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status' }],
      }),
      flowWorkerSession: submitWorkerSessions(() => rawApi('GET /todos answers 200', PASSING_API_STEPS), {
        onBriefing: (_task, text) => briefings.push(text),
      }),
    })

    expect(briefings[0]).toContain(
      'open-meteo (base URL envs: GEOCODING_BASE_URL, FORECAST_BASE_URL — stubable via setup.http, or provide it)',
    )
    expect(briefings[0]).toContain('EVERY one of that service')
  })
})

describe('the api SYSTEM prompt asks for the service by name', () => {
  it('says a named blocker beats a generic noun', () => {
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('NAME the blocker as precisely as you')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('"stripe"')
  })
})
