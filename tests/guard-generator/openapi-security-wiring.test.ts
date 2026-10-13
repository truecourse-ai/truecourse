/**
 * The security wiring at the recipe gate: a credential's `satisfies` must name
 * a security scheme some corpus OpenAPI document declares, checked before any
 * LLM stage runs.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { FlowWorkerSessionSeam } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeCorpus,
  writeDoc,
  claimsBy,
  submitWorkerSessions,
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

/** The interfaces the secured operations are realized through. */
const meInterfaces = (r: string) =>
  interfacesOf(r, apiInterface('GET', '/me'), apiInterface('GET', '/admin'), apiInterface('GET', '/public'))

describe('generateGuards — `satisfies` validation', () => {
  /** A worker seam that must never be reached: validation stops the run first. */
  const neverAuthors: FlowWorkerSessionSeam = async () => {
    throw new Error('authoring must not run — the recipe was rejected')
  }

  it('refuses the run when a `satisfies` names no scheme in any corpus doc, before any LLM stage', async () => {
    const r = setupRepo(openapi(), {
      'api-key': { header: 'X-API-Key', valueFromEnv: 'API_KEY', satisfies: 'apiKeyAuht' },
    })
    const res = await runGenerate({
      repoRoot: r,
      interfaces: meInterfaces(r),
      flowWorkerSession: neverAuthors,
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
      interfaces: meInterfaces(r),
      // An OpenAPI document is one section of the tree, so its one claim is untestable.
      claims: claimsBy({ 'openapi-yaml': { untestable: 'nothing to author here' } }),
      flowWorkerSession: neverAuthors,
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
      claims: claimsBy({ login: { untestable: 'prose only' } }),
      flowWorkerSession: neverAuthors,
    })
    expect(res.status).toBe('ok')
    expect(res.recipe?.warnings).toHaveLength(1)
    expect(res.recipe?.warnings?.[0]).toContain('no OpenAPI document')
    expect(res.recipe?.warnings?.[0]).toContain('"bearerAuth"')
  }, 60_000)
})
