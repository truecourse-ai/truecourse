/**
 * SEED EVIDENCE — the deterministic facts the seed step establishes before any
 * session reasons: whether the api surface authenticates (on any signal, not
 * only an OpenAPI scheme), which mapped operations make cheap probes, and
 * which resources the route surface references by id or handle.
 */

import { describe, it, expect } from 'vitest'
import type { Interface } from '@truecourse/shared'
import { apiAuthEvidence, probeCandidatesFromInterfaces, requiredResources } from '@truecourse/guard-generator'
import { apiInterface } from './helpers.js'

/** An api interface carrying a request contract (headers/body/query). */
function withRequest(
  iface: Interface,
  request: { headers?: string[]; body?: string[]; query?: string[] },
): Interface {
  const field = (name: string) => ({ name, required: true })
  return {
    ...iface,
    contract: {
      surface: 'api',
      operation: {
        request: {
          ...(request.headers ? { headers: request.headers.map(field) } : {}),
          ...(request.body ? { body: request.body.map(field) } : {}),
          ...(request.query ? { query: request.query.map(field) } : {}),
        },
      },
    },
  } as Interface
}

const table = (name: string) => ({ name, columns: [{ name: 'id', type: 'Int', isPrimaryKey: true }] })
const database = (...names: string[]) => ({ type: 'postgres', driver: 'prisma', tables: names.map(table), relations: [], appImports: [] })

describe('apiAuthEvidence — the api surface authenticates on any signal', () => {
  it('finds nothing for an open API: no scheme, no header, no token table, no doc', () => {
    expect(
      apiAuthEvidence({
        interfaces: [apiInterface('GET', '/todos')],
        database: database('Todo'),
        docs: [{ doc: 'docs/api.md', text: 'GET /todos lists todos.' }],
        securitySchemes: [],
      }),
    ).toEqual([])
  })

  it('reads a credential header off a mapped operation, a token table off the schema, and a bearer header off the docs', () => {
    const evidence = apiAuthEvidence({
      interfaces: [withRequest(apiInterface('GET', '/api/v2/document'), { headers: ['Authorization', 'Content-Type'] })],
      database: database('User', 'ApiToken'),
      docs: [{ doc: 'docs/developers/auth.md', text: 'Send `Authorization: Bearer <token>` with every request.' }],
      securitySchemes: [],
    })
    expect(evidence.map((e) => e.kind)).toEqual(['header', 'token-table', 'doc'])
    expect(evidence[0].detail).toContain('Authorization')
    expect(evidence[0].detail).toContain('GET /api/v2/document')
    expect(evidence[1].detail).toContain('ApiToken')
    expect(evidence[2].detail).toContain('docs/developers/auth.md')
  })

  it('a declared scheme is one signal among them, listed first', () => {
    const evidence = apiAuthEvidence({
      interfaces: [],
      database: null,
      docs: [],
      securitySchemes: [{ name: 'bearerAuth' }],
    })
    expect(evidence).toEqual([{ kind: 'scheme', detail: 'the corpus declares 1 security scheme(s): bearerAuth' }])
  })

  it('a Content-Type header and a plain "token" column name are not credentials', () => {
    expect(
      apiAuthEvidence({
        interfaces: [withRequest(apiInterface('POST', '/upload'), { headers: ['Content-Type', 'Accept'] })],
        database: database('Session'),
        docs: [{ doc: 'docs/x.md', text: 'the CSRF token is sent as a form field' }],
        securitySchemes: [],
      }),
    ).toEqual([])
  })
})

describe('probeCandidatesFromInterfaces — the cheapest operations to confirm against', () => {
  it('ranks parameter-free GETs first, then templated GETs, then writes; names no scheme', () => {
    const candidates = probeCandidatesFromInterfaces([
      apiInterface('POST', '/api/v1/documents'),
      apiInterface('GET', '/api/v1/documents/{id}'),
      apiInterface('GET', '/api/v1/me'),
      apiInterface('GET', '/api/v1/documents'),
    ])
    expect(candidates.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v1/documents',
      'GET /api/v1/me',
      'GET /api/v1/documents/{id}',
      'POST /api/v1/documents',
    ])
    expect(candidates.every((c) => c.schemes.length === 0)).toBe(true)
  })

  it('caps the list and skips RPC procedures', () => {
    const many = Array.from({ length: 20 }, (_, i) => apiInterface('GET', `/api/r${i}`))
    expect(probeCandidatesFromInterfaces(many)).toHaveLength(12)
    const rpc = { ...apiInterface('POST', '/api/trpc/x'), procedure: { router: 'x', name: 'y' } } as unknown as Interface
    expect(probeCandidatesFromInterfaces([rpc])).toEqual([])
  })
})

describe('requiredResources — what the route surface references by id or handle', () => {
  it('folds path parameters and id-shaped body fields to the resource they name, most-referenced first', () => {
    const resources = requiredResources([
      apiInterface('GET', '/api/v2/envelope/{envelopeId}'),
      apiInterface('DELETE', '/api/v2/envelope/{envelopeId}/recipient/{recipientId}'),
      withRequest(apiInterface('POST', '/api/v2/envelope/distribute'), { body: ['envelopeId', 'message'] }),
      apiInterface('GET', '/api/v1/documents/{id}'),
      apiInterface('GET', '/o/{orgUrl}/settings'),
      apiInterface('GET', '/api/v2/openapi/{version}'),
    ])
    expect(resources.map((r) => [r.resource, r.references])).toEqual([
      ['envelope', 3],
      ['document', 1],
      ['org', 1],
      ['recipient', 1],
    ])
    const envelope = resources[0]
    expect(envelope.params).toEqual(['envelopeId'])
    expect(envelope.example).toBe('GET /api/v2/envelope/{envelopeId}')
    expect(resources.find((r) => r.resource === 'org')!.params).toEqual(['orgUrl'])
    // `{id}` reads its resource off the preceding segment, singularized.
    expect(resources.find((r) => r.resource === 'document')!.params).toEqual(['id'])
  })

  it('is empty for a surface with no references, and never counts a `{version}`', () => {
    expect(requiredResources([apiInterface('GET', '/health'), apiInterface('GET', '/api/{version}/openapi')])).toEqual([])
  })
})
