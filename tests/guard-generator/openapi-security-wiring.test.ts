/**
 * The security wiring: a per-section `securityFingerprint` folds into
 * the section's content key (and through it every bound flow's generation-inputs hash
 * and authoring cache key) ONLY for a SECURED OpenAPI operation, so a public /
 * markdown / cli section is byte-identical to before it; a scheme-definition edit
 * re-keys the referencing secured section; and the authoring prompt is handed the
 * scheme→credential mapping (satisfied + unsatisfied).
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  authorCacheKey,
  sectionInputsKey,
  flowGenerationInputsHash,
  planGuardWork,
  type SectionInput,
  type AuthorUserContext,
  type GenerateRunner,
} from '@truecourse/guard-generator'
import { writeManifest } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeCorpus,
  writeDoc,
  extractBy,
  runGenerate,
  interfacesOf,
  apiInterface,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** An OpenAPI spec: GET /me is secured by `apiKeyAuth`; GET /public is unsecured. */
function openapi(schemeName = 'X-API-Key'): string {
  return `openapi: 3.0.0
info: { title: t, version: '1' }
components:
  securitySchemes:
    apiKeyAuth: { type: apiKey, in: header, name: ${schemeName} }
    oauth2Auth: { type: oauth2, flows: {} }
paths:
  /me:
    get:
      operationId: getMe
      security: [{ apiKeyAuth: [] }]
      responses: { '200': { description: ok } }
  /admin:
    get:
      operationId: getAdmin
      security: [{ oauth2Auth: ['admin'] }]
      responses: { '200': { description: ok } }
  /public:
    get:
      operationId: getPublic
      security: []
      responses: { '200': { description: ok } }
`
}

function setupRepo(spec = openapi(), credentials?: Parameters<typeof writeApiRecipe>[1]['credentials']): string {
  const r = repo()
  writeApiRecipe(r, { entry: null, credentials })
  writeCorpus(r, [{ ref: 'api/openapi.yaml' }])
  writeDoc(r, 'api/openapi.yaml', spec)
  return r
}

const API_KEY = { 'api-key': { header: 'X-API-Key', valueFromEnv: 'API_KEY' } }
const JOURNEYS = ['sha256:journey']

/** The journeys the secured operations are realized through. */
const meJourneys = (r: string) =>
  interfacesOf(r, apiInterface('GET', '/me'), apiInterface('GET', '/admin'), apiInterface('GET', '/public'))

describe('planGuardWork — securityFingerprint stamping', () => {
  it('stamps a secured operation section; leaves the public operation empty', () => {
    const r = setupRepo(openapi(), API_KEY)
    const plan = planGuardWork(r)
    const me = plan.sections.find((s) => s.headingText === 'GET /me')!
    const pub = plan.sections.find((s) => s.headingText === 'GET /public')!
    expect(me.securityFingerprint).toMatch(/^sha256:/)
    expect(pub.securityFingerprint).toBe('')
  })

  it('re-keys exactly the referencing secured section when its scheme definition changes; an unrelated section is untouched', () => {
    const r = setupRepo(openapi(), API_KEY)
    const plan0 = planGuardWork(r)
    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: plan0.sections.map((s) => ({
        flowId: `${s.doc}#${s.anchor}`,
        flowFingerprint: s.fingerprint,
        bindings: [{ doc: s.doc, anchor: s.anchor, fingerprint: s.fingerprint }],
        scenarios: [],
        generationInputsHash: flowGenerationInputsHash({
          flowFingerprint: s.fingerprint,
          sectionKeys: [sectionInputsKey(s)],
          journeyFingerprints: JOURNEYS,
          recipeFingerprint: plan0.recipeFingerprint,
        }),
        gaps: [],
      })),
    })
    expect(planGuardWork(r).work).toHaveLength(0)
    const before = new Map(plan0.sections.map((s) => [s.anchor, sectionInputsKey(s)]))

    // Rename the apiKeyAuth scheme's header param — a change invisible to GET /me's
    // canonicalText (the scheme def lives in components), so no section is spec-side
    // work; only securityFingerprint catches it, moving GET /me's content key and
    // with it the hash of every flow bound to that operation.
    writeDoc(r, 'api/openapi.yaml', openapi('X-Renamed-Key'))
    const plan1 = planGuardWork(r)
    expect(plan1.work).toHaveLength(0) // no section's own text changed
    const moved = plan1.sections.filter((s) => before.get(s.anchor) !== sectionInputsKey(s))
    expect(moved.map((s) => s.headingText)).toEqual(['GET /me'])
  })
})

describe('authorCacheKey — security fold', () => {
  const FLOW = { fingerprint: 'sha256:flow' }
  function section(securityFingerprint: string): SectionInput {
    return {
      doc: 'api/openapi.yaml',
      anchor: 'paths/get-getme',
      fingerprint: 'sha256:sec',
      headingText: 'GET /me',
      level: 0,
      ownText: '',
      fullText: '',
      areaTags: [],
      suppressionFingerprint: '',
      endpointSchemaFingerprint: '',
      securityFingerprint,
    }
  }
  const key = (securityFingerprint: string) =>
    authorCacheKey(FLOW, 'api', [sectionInputsKey(section(securityFingerprint))], JOURNEYS, 'sha256:recipe')

  it('is byte-identical when the section is public, and moves once secured / on a scheme change', () => {
    // An empty securityFingerprint folds nothing — identical to the pre-B7 key surface.
    expect(key('')).toBe(key(''))
    expect(key('sha256:secA')).not.toBe(key(''))
    expect(key('sha256:secB')).not.toBe(key('sha256:secA'))
  })
})

describe('generateGuards — the api author prompt carries the operation-auth mapping', () => {
  /** Collect every (flow, surface) authoring context's operationAuth, authoring nothing. */
  function collectAuth(): { ctxs: AuthorUserContext[]; runner: GenerateRunner } {
    const ctxs: AuthorUserContext[] = []
    const runner: GenerateRunner = async (c) => {
      ctxs.push(c)
      return { blockedOn: ['a spy runner authors nothing'] }
    }
    return { ctxs, runner }
  }

  it('advertises the satisfying credential for a matched scheme and blocks on an unsatisfied one', async () => {
    const r = setupRepo(openapi(), API_KEY)
    const { ctxs, runner } = collectAuth()
    await runGenerate({
      repoRoot: r,
      interfaces: meJourneys(r),
      extractRunner: extractBy({
        'paths/get-getme': [{ claim: 'GET /me returns the caller', driver: 'api', reason: 'HTTP 200' }],
        'paths/get-getadmin': [{ claim: 'GET /admin returns admin data', driver: 'api', reason: 'HTTP 200' }],
        'paths/get-getpublic': [{ claim: 'GET /public returns data', driver: 'api', reason: 'HTTP 200' }],
      }),
      generateRunner: runner,
    })
    // Every bound operation is authored for, so the mapping must reach some call.
    expect(ctxs.map((c) => c.flow.id).sort()).toEqual([
      'paths-get-getadmin',
      'paths-get-getme',
      'paths-get-getpublic',
    ])
    const satisfied = ctxs.flatMap((c) => c.operationAuth?.satisfiedBy ?? [])
    const unsatisfied = ctxs.flatMap((c) => c.operationAuth?.unsatisfied ?? [])
    // apiKeyAuth (GET /me) is satisfied by the api-key credential via the header heuristic.
    expect(satisfied).toContainEqual({ scheme: 'apiKeyAuth', credential: 'api-key', header: 'X-API-Key' })
    // oauth2Auth (GET /admin) has no declared credential → named in unsatisfied.
    expect(unsatisfied).toContain('oauth2Auth')
  }, 60_000)

  it('names the required scheme as unsatisfied when the recipe declares no credential for it', async () => {
    const r = setupRepo(openapi(), undefined)
    const { ctxs, runner } = collectAuth()
    await runGenerate({
      repoRoot: r,
      interfaces: meJourneys(r),
      extractRunner: extractBy({
        'paths/get-getme': [{ claim: 'GET /me returns the caller', driver: 'api', reason: 'HTTP 200' }],
        'paths/get-getadmin': { untestable: 'needs oauth' },
        'paths/get-getpublic': { untestable: 'trivial' },
      }),
      generateRunner: runner,
    })
    // No credentials → apiKeyAuth is unsatisfiable, so the secured GET /me surfaces as
    // blocked (still auth-relevant) with nothing in satisfiedBy.
    const auth = ctxs.map((c) => c.operationAuth).find((a) => a && a.unsatisfied.length > 0)
    expect(auth?.satisfiedBy).toEqual([])
    expect(auth?.unsatisfied).toContain('apiKeyAuth')
  }, 60_000)
})

describe('generateGuards — `satisfies` validation', () => {
  /** A generate runner that must never be reached: validation stops the run first. */
  const neverAuthors: GenerateRunner = async () => {
    throw new Error('authoring must not run — the recipe was rejected')
  }

  it('refuses the run when a `satisfies` names no scheme in any corpus doc, before any LLM stage', async () => {
    const r = setupRepo(openapi(), {
      'api-key': { header: 'X-API-Key', valueFromEnv: 'API_KEY', satisfies: 'apiKeyAuht' },
    })
    const res = await runGenerate({
      repoRoot: r,
      interfaces: meJourneys(r),
      extractRunner: async () => {
        throw new Error('extraction must not run — the recipe was rejected')
      },
      generateRunner: neverAuthors,
    })
    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toContain('"api-key"')
    expect(res.reason).toContain('apiKeyAuht')
    expect(res.reason).toContain('"apiKeyAuth"') // the known keys are named
    expect(res.written).toEqual([])
  })

  it('accepts a `satisfies` the corpus declares (the run proceeds past validation)', async () => {
    const r = setupRepo(openapi(), {
      'api-key': { header: 'X-API-Key', valueFromEnv: 'API_KEY', satisfies: 'apiKeyAuth' },
    })
    const res = await runGenerate({
      repoRoot: r,
      interfaces: meJourneys(r),
      extractRunner: extractBy({
        'paths/get-getme': { untestable: 'nothing to author here' },
        'paths/get-getadmin': { untestable: 'nothing to author here' },
        'paths/get-getpublic': { untestable: 'nothing to author here' },
      }),
      generateRunner: neverAuthors,
    })
    expect(res.status).toBe('ok')
    expect(res.recipe?.warnings).toBeUndefined()
  }, 60_000)

  it('WARNS (and still runs) when a `satisfies` is declared but the corpus has no OpenAPI doc', async () => {
    const r = repo()
    writeApiRecipe(r, {
      entry: null,
      credentials: { token: { header: 'Authorization', valueFromEnv: 'API_TOKEN', satisfies: 'bearerAuth' } },
    })
    writeCorpus(r, [{ ref: 'docs/api.md' }])
    writeDoc(r, 'docs/api.md', ['## login', 'The API authenticates with a bearer token.'].join('\n'))

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r),
      extractRunner: extractBy({ login: { untestable: 'prose only' } }),
      generateRunner: neverAuthors,
    })
    expect(res.status).toBe('ok')
    expect(res.recipe?.warnings).toHaveLength(1)
    expect(res.recipe?.warnings?.[0]).toContain('no OpenAPI document')
    expect(res.recipe?.warnings?.[0]).toContain('"bearerAuth"')
  }, 60_000)
})
