/**
 * Item 45 / B7 — the security wiring: a per-section `securityFingerprint` folds into
 * the WORK gate and the authoring cache key ONLY for a SECURED OpenAPI operation, so a
 * public / markdown / cli section is byte-identical to before B7; a scheme-definition
 * edit re-plans the referencing secured section; and the authoring prompt is handed the
 * scheme→credential mapping (satisfied + unsatisfied).
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  authorCacheKey,
  generationInputsHash,
  planGuardWork,
  generateGuards,
  type SectionInput,
  type AuthorUserContext,
  type GenerateRunner,
} from '@truecourse/guard-generator'
import { writeManifest } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeApiRecipe, writeCorpus, writeDoc, extractBy } from './helpers.js'

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

describe('planGuardWork — securityFingerprint stamping', () => {
  it('stamps a secured operation section; leaves the public operation empty', () => {
    const r = setupRepo(openapi(), API_KEY)
    const plan = planGuardWork(r)
    const me = plan.sections.find((s) => s.headingText === 'GET /me')!
    const pub = plan.sections.find((s) => s.headingText === 'GET /public')!
    expect(me.securityFingerprint).toMatch(/^sha256:/)
    expect(pub.securityFingerprint).toBe('')
  })

  it('re-plans exactly the referencing secured section when its scheme definition changes; an unrelated section is untouched', () => {
    const r = setupRepo(openapi(), API_KEY)
    const plan0 = planGuardWork(r)
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      sections: plan0.sections.map((s) => ({
        doc: s.doc,
        anchor: s.anchor,
        fingerprint: s.fingerprint,
        scenarioIds: [],
        generationInputsHash: generationInputsHash(
          s.fingerprint,
          plan0.recipeFingerprint,
          s.suppressionFingerprint,
          s.endpointSchemaFingerprint,
          s.securityFingerprint,
        ),
      })),
    })
    expect(planGuardWork(r).work).toHaveLength(0)

    // Rename the apiKeyAuth scheme's header param — a change invisible to GET /me's
    // canonicalText (the scheme def lives in components), caught only by securityFingerprint.
    writeDoc(r, 'api/openapi.yaml', openapi('X-Renamed-Key'))
    const workHeadings = planGuardWork(r).work.map((s) => s.headingText).sort()
    expect(workHeadings).toContain('GET /me')
    expect(workHeadings).not.toContain('GET /public')
    expect(workHeadings).not.toContain('GET /admin')
  })
})

describe('authorCacheKey — security fold', () => {
  const CLAIM = { claim: 'GET /me returns the caller', driver: 'api', sectionAnchor: 'a', reason: 'r' } as const
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

  it('is byte-identical when the section is public, and moves once secured / on a scheme change', () => {
    const pub = authorCacheKey(CLAIM, section(''), 'sha256:recipe')
    const secured = authorCacheKey(CLAIM, section('sha256:secA'), 'sha256:recipe')
    const changed = authorCacheKey(CLAIM, section('sha256:secB'), 'sha256:recipe')
    // An empty securityFingerprint folds nothing — identical to the pre-B7 key surface.
    expect(authorCacheKey(CLAIM, section(''), 'sha256:recipe')).toBe(pub)
    expect(secured).not.toBe(pub)
    expect(changed).not.toBe(secured)
  })
})

describe('generateGuards — the api author prompt carries the operation-auth mapping', () => {
  /** Collect every author batch's operationAuth (batching may split claims). */
  function collectAuth(): { ctxs: AuthorUserContext[]; runner: GenerateRunner } {
    const ctxs: AuthorUserContext[] = []
    const runner: GenerateRunner = async (c) => {
      ctxs.push(c)
      return c.claims.map((cl) => ({ ref: cl.ref, scenarios: [] }))
    }
    return { ctxs, runner }
  }

  it('advertises the satisfying credential for a matched scheme and blocks on an unsatisfied one', async () => {
    const r = setupRepo(openapi(), API_KEY)
    const { ctxs, runner } = collectAuth()
    await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        'paths/get-getme': [{ claim: 'GET /me returns the caller', driver: 'api', reason: 'HTTP 200' }],
        'paths/get-getadmin': [{ claim: 'GET /admin returns admin data', driver: 'api', reason: 'HTTP 200' }],
        'paths/get-getpublic': [{ claim: 'GET /public returns data', driver: 'api', reason: 'HTTP 200' }],
      }),
      generateRunner: runner,
    })
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
    await generateGuards({
      repoRoot: r,
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
