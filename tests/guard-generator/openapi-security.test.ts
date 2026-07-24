import { describe, it, expect } from 'vitest'
import { canonicalStringify, parseOpenApiSpec, type OpenApiDoc } from '@truecourse/shared/openapi'
import {
  resolveSectionAuth,
  securityFingerprintForSection,
  type AuthCredential,
  type SectionInput,
} from '@truecourse/guard-generator'

/** An OpenAPI operation section whose fullText is the canonical slice. */
function opSection(method: string, path: string, operation: Record<string, unknown>, fingerprint = 'sha256:op'): SectionInput {
  return {
    doc: 'api/openapi.yaml',
    anchor: `paths/${method}-${path}`,
    fingerprint,
    headingText: `${method.toUpperCase()} ${path}`,
    level: 0,
    ownText: '',
    fullText: canonicalStringify({ method, path, operation }),
    areaTags: [],
    suppressionFingerprint: '',
    endpointSchemaFingerprint: '',
    securityFingerprint: '',
  }
}

/** A markdown prose section (never an operation). */
function mdSection(): SectionInput {
  return {
    doc: 'docs/api.md',
    anchor: 'api',
    fingerprint: 'sha256:md',
    headingText: 'api',
    level: 2,
    ownText: 'prose',
    fullText: 'prose',
    areaTags: [],
    suppressionFingerprint: '',
    endpointSchemaFingerprint: '',
    securityFingerprint: '',
  }
}

const SCHEMES = {
  apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  bearerAuth: { type: 'http', scheme: 'bearer' },
  oauth2Auth: { type: 'oauth2', flows: {} },
  basicAuth: { type: 'http', scheme: 'basic' },
}

function doc(security?: unknown): OpenApiDoc {
  return parseOpenApiSpec(
    JSON.stringify({ openapi: '3.0.0', components: { securitySchemes: SCHEMES }, ...(security ? { security } : {}) }),
  )!
}

const apiKeyCred: AuthCredential = { name: 'api-key', header: 'X-API-Key' }

describe('resolveSectionAuth', () => {
  it('returns null for a section that is not an OpenAPI operation', () => {
    expect(resolveSectionAuth(mdSection(), doc(), [apiKeyCred])).toBeNull()
  })

  it('an operation with an explicit empty security is public — an empty SectionAuth', () => {
    const auth = resolveSectionAuth(opSection('get', '/x', { security: [] }), doc([{ apiKeyAuth: [] }]), [apiKeyCred])
    expect(auth).toEqual({ requiredSchemes: [], satisfiedBy: [], unsatisfied: [] })
  })

  it('matches an apiKey-in-header scheme heuristically by the credential header', () => {
    const auth = resolveSectionAuth(opSection('get', '/x', { security: [{ apiKeyAuth: [] }] }), doc(), [apiKeyCred])
    expect(auth).toEqual({
      requiredSchemes: ['apiKeyAuth'],
      satisfiedBy: [{ scheme: 'apiKeyAuth', credential: 'api-key', header: 'X-API-Key' }],
      unsatisfied: [],
    })
  })

  it('matches an http bearer scheme heuristically by an Authorization credential', () => {
    const bearer: AuthCredential = { name: 'token', header: 'Authorization' }
    const auth = resolveSectionAuth(opSection('get', '/x', { security: [{ bearerAuth: [] }] }), doc(), [bearer])
    expect(auth?.satisfiedBy).toEqual([{ scheme: 'bearerAuth', credential: 'token', header: 'Authorization' }])
    expect(auth?.unsatisfied).toEqual([])
  })

  it('a declared `satisfies` is authoritative — it overrides the header heuristic', () => {
    // Credential header does NOT match the scheme name, but `satisfies` binds it directly.
    const declared: AuthCredential = { name: 'special', header: 'X-Whatever', satisfies: 'apiKeyAuth' }
    const auth = resolveSectionAuth(opSection('get', '/x', { security: [{ apiKeyAuth: [] }] }), doc(), [declared])
    expect(auth?.satisfiedBy).toEqual([{ scheme: 'apiKeyAuth', credential: 'special', header: 'X-Whatever' }])
  })

  it('a `satisfies` fulfills an oauth2 scheme the heuristics never match; otherwise it blocks', () => {
    const op = opSection('get', '/x', { security: [{ oauth2Auth: ['read'] }] })
    // No credential → unsatisfied names the exact scheme.
    expect(resolveSectionAuth(op, doc(), [apiKeyCred])).toEqual({
      requiredSchemes: ['oauth2Auth'],
      satisfiedBy: [],
      unsatisfied: ['oauth2Auth'],
    })
    // A seed-minted bearer that declares satisfies fulfills it.
    const minted: AuthCredential = { name: 'user-token', header: 'Authorization', satisfies: 'oauth2Auth' }
    expect(resolveSectionAuth(op, doc(), [minted])?.satisfiedBy).toEqual([
      { scheme: 'oauth2Auth', credential: 'user-token', header: 'Authorization' },
    ])
  })

  it('an ambiguous heuristic advertises ALL matching credentials and never blocks', () => {
    const a: AuthCredential = { name: 'key-a', header: 'X-API-Key' }
    const b: AuthCredential = { name: 'key-b', header: 'x-api-key' }
    const auth = resolveSectionAuth(opSection('get', '/x', { security: [{ apiKeyAuth: [] }] }), doc(), [a, b])
    expect(auth?.unsatisfied).toEqual([])
    expect(auth?.satisfiedBy).toEqual([
      { scheme: 'apiKeyAuth', credential: 'key-a', header: 'X-API-Key' },
      { scheme: 'apiKeyAuth', credential: 'key-b', header: 'x-api-key' },
    ])
  })

  it('an AND-group is satisfied only when EVERY scheme in it matches', () => {
    // Group requires apiKeyAuth AND bearerAuth together; only the apiKey is provided.
    const op = opSection('get', '/x', { security: [{ apiKeyAuth: [], bearerAuth: [] }] })
    const auth = resolveSectionAuth(op, doc(), [apiKeyCred])
    expect(auth?.satisfiedBy).toEqual([])
    expect(auth?.unsatisfied).toEqual(['bearerAuth'])
  })

  it('advertises the FIRST fully-satisfied OR-group and ignores the unsatisfiable alternative', () => {
    // OR: (oauth2Auth) | (apiKeyAuth). Only the second is satisfiable → advertise it, no block.
    const op = opSection('get', '/x', { security: [{ oauth2Auth: [] }, { apiKeyAuth: [] }] })
    const auth = resolveSectionAuth(op, doc(), [apiKeyCred])
    expect(auth?.satisfiedBy).toEqual([{ scheme: 'apiKeyAuth', credential: 'api-key', header: 'X-API-Key' }])
    expect(auth?.unsatisfied).toEqual([])
  })

  it('falls back to the doc-level security when the operation declares none', () => {
    const op = opSection('get', '/x', { responses: { '200': { description: 'ok' } } })
    const auth = resolveSectionAuth(op, doc([{ apiKeyAuth: [] }]), [apiKeyCred])
    expect(auth?.satisfiedBy).toEqual([{ scheme: 'apiKeyAuth', credential: 'api-key', header: 'X-API-Key' }])
  })
})

describe('securityFingerprintForSection', () => {
  it('is empty for a public (unsecured) operation and for a non-operation section', () => {
    expect(securityFingerprintForSection(mdSection(), doc())).toBe('')
    expect(securityFingerprintForSection(opSection('get', '/x', { security: [] }), doc())).toBe('')
    expect(securityFingerprintForSection(opSection('get', '/x', { responses: {} }), doc())).toBe('')
  })

  it('is non-empty and stable for a secured operation', () => {
    const op = opSection('get', '/x', { security: [{ apiKeyAuth: [] }] })
    const fp = securityFingerprintForSection(op, doc())
    expect(fp).not.toBe('')
    expect(securityFingerprintForSection(op, doc())).toBe(fp)
  })

  it('moves when the REFERENCED scheme definition changes; not when an unrelated scheme changes', () => {
    const op = opSection('get', '/x', { security: [{ apiKeyAuth: [] }] })
    const base = securityFingerprintForSection(op, doc())

    // Edit the apiKeyAuth def (the referenced one) → fingerprint moves.
    const editedRef = parseOpenApiSpec(
      JSON.stringify({
        openapi: '3.0.0',
        components: { securitySchemes: { ...SCHEMES, apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Renamed' } } },
      }),
    )!
    expect(securityFingerprintForSection(op, editedRef)).not.toBe(base)

    // Edit an UNRELATED scheme (bearerAuth) → fingerprint unchanged.
    const editedOther = parseOpenApiSpec(
      JSON.stringify({
        openapi: '3.0.0',
        components: { securitySchemes: { ...SCHEMES, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      }),
    )!
    expect(securityFingerprintForSection(op, editedOther)).toBe(base)
  })
})
