import { describe, expect, it } from 'vitest'
import { canonicalJson, type CodeFact, type Requirement, type RequirementKind, type RequirementModality } from '../../packages/shared/src/types/spec-compliance'
import { evaluateSpecCompliance } from '../../packages/core/src/services/spec-compliance-matchers.service'

const range = { startLine: 1, endLine: 1 }
const extractor = { name: 'test-extractor', version: '1.0.0' }

function req(
  id: string,
  input: Partial<Requirement> & {
    kind: RequirementKind
    subject: string
    action?: string
    modality?: RequirementModality
  },
): Requirement {
  return {
    id,
    sourceFile: 'docs/spec.md',
    sourceRange: range,
    kind: input.kind,
    modality: input.modality ?? 'must',
    subject: input.subject,
    action: input.action ?? 'exist',
    object: input.object,
    constraints: input.constraints ?? [],
    acceptanceCriteria: input.acceptanceCriteria,
    evidenceText: input.evidenceText ?? `${input.subject} ${input.action ?? 'must exist'} ${input.object ?? ''}`,
    confidence: input.confidence ?? 0.9,
    extractor,
  }
}

function fact(id: string, input: Partial<CodeFact> & Pick<CodeFact, 'kind' | 'predicate' | 'value'>): CodeFact {
  return {
    id,
    sourceFile: input.sourceFile ?? 'src/app.tsx',
    sourceRange: input.sourceRange ?? range,
    kind: input.kind,
    predicate: input.predicate,
    value: input.value,
    confidence: 1,
    extractor,
  }
}

describe('evaluateSpecCompliance', () => {
  it('returns exactly one deterministically sorted result per requirement and hides satisfied results by default', () => {
    const requirements = [
      req('req_z', { kind: 'api', subject: 'missing route', object: 'GET /missing' }),
      req('req_a', { kind: 'api', subject: 'health route', object: 'GET /health' }),
    ]
    const facts = [
      fact('fact_route', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/health', middlewares: [] } }),
    ]

    const result = evaluateSpecCompliance({ requirements, facts })

    expect(result.results).toHaveLength(2)
    expect(result.results.map((item) => canonicalJson(item))).toEqual([...result.results.map((item) => canonicalJson(item))].sort())
    expect(new Set(result.results.map((item) => item.requirementId))).toEqual(new Set(['req_a', 'req_z']))
    expect(result.visibleResults.map((item) => item.status)).toEqual(['missing'])
    expect(result.findings.map((item) => item.requirementId)).toEqual(['req_z'])
  })

  it('covers satisfied, missing, partial, conflicting, ambiguous, and unverifiable statuses', () => {
    const requirements = [
      req('req_satisfied', { kind: 'api', subject: 'health route', object: 'GET /health' }),
      req('req_missing', { kind: 'ui', subject: 'settings page', object: '/settings', evidenceText: 'Settings page route /settings must exist' }),
      req('req_partial', {
        kind: 'api',
        subject: 'profile route auth',
        object: 'GET /profile',
        constraints: [{ type: 'auth', value: 'authenticated user' }],
      }),
      req('req_conflicting', { kind: 'config', subject: 'debug env', object: 'DEBUG_MODE', modality: 'must_not' }),
      req('req_ambiguous', { kind: 'unknown', subject: 'unclear behavior', confidence: 0.4 }),
      req('req_unverifiable', { kind: 'workflow', subject: 'approval flow', object: 'manager approval' }),
    ]
    const facts = [
      fact('fact_health', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/health', middlewares: [] } }),
      fact('fact_profile', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/profile', middlewares: [] } }),
      fact('fact_debug', { kind: 'config.env', predicate: 'env.read', value: { name: 'DEBUG_MODE', access: 'dot' } }),
    ]

    const statuses = Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.requirementId, item.status]))

    expect(statuses).toEqual({
      req_ambiguous: 'ambiguous',
      req_conflicting: 'conflicting',
      req_missing: 'missing',
      req_partial: 'partial',
      req_satisfied: 'satisfied',
      req_unverifiable: 'unverifiable',
    })
  })

  it('maps modalities to severities', () => {
    const requirements = [
      req('req_must', { kind: 'api', modality: 'must', subject: 'must route', object: 'GET /must' }),
      req('req_must_not', { kind: 'api', modality: 'must_not', subject: 'forbidden route', object: 'GET /forbidden' }),
      req('req_should', { kind: 'api', modality: 'should', subject: 'should route', object: 'GET /should' }),
      req('req_may', { kind: 'api', modality: 'may', subject: 'may route', object: 'GET /may' }),
      req('req_ambiguous_may', { kind: 'unknown', modality: 'may', subject: 'optional unclear', confidence: 0.2 }),
    ]
    const facts = [
      fact('fact_forbidden', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/forbidden', middlewares: [] } }),
    ]
    const severities = Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.requirementId, item.severity]))

    expect(severities).toEqual({
      req_ambiguous_may: 'info',
      req_may: 'info',
      req_must: 'error',
      req_must_not: 'error',
      req_should: 'warning',
    })
  })

  it('matches API routes and route auth requirements', () => {
    const requirements = [
      req('req_route', { kind: 'api', subject: 'checkout route', object: 'POST /checkout' }),
      req('req_auth', {
        kind: 'api',
        subject: 'admin route',
        object: 'POST /admin',
        constraints: [{ type: 'auth', value: 'authenticated admin' }],
      }),
    ]
    const facts = [
      fact('fact_checkout', { kind: 'api.route', predicate: 'route.exists', value: { method: 'POST', path: '/checkout', middlewares: [] } }),
      fact('fact_admin', { kind: 'api.route', predicate: 'route.exists', value: { method: 'POST', path: '/admin', middlewares: ['requireAuth'] } }),
      fact('fact_admin_auth', { kind: 'auth.signal', predicate: 'auth.detected', value: { signal: 'requireAuth', source: 'middleware', route: '/admin' } }),
    ]

    expect(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => item.status)).toEqual(['satisfied', 'satisfied'])
  })

  it('matches UI routes, text, form fields, and validation messages', () => {
    const requirements = [
      req('req_field', { kind: 'ui', subject: 'email field', object: 'email', evidenceText: 'The form must include an email field.' }),
      req('req_message', { kind: 'ui', subject: 'email validation', object: 'Email is required', evidenceText: 'The form must show validation message Email is required.' }),
      req('req_route', { kind: 'ui', subject: 'profile page', object: '/profile', evidenceText: 'The profile page route /profile must exist.' }),
      req('req_text', { kind: 'ui', subject: 'welcome copy', object: 'Welcome back', evidenceText: 'The UI must show text Welcome back.' }),
    ]
    const facts = [
      fact('fact_field', { kind: 'ui.form_field', predicate: 'field.exists', value: { tag: 'input', name: 'email', label: 'Email', required: true } }),
      fact('fact_message', { kind: 'ui.text', predicate: 'text.visible', value: { text: 'Email is required' } }),
      fact('fact_route', { kind: 'ui.route', predicate: 'route.exists', value: { path: '/profile', componentName: 'Profile' } }),
      fact('fact_text', { kind: 'ui.text', predicate: 'text.visible', value: { text: 'Welcome back' } }),
    ]

    expect(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.matcher.name, item.status])).toEqual([
      ['ui.form.field_exists', 'satisfied'],
      ['ui.form.validation_message_exists', 'satisfied'],
      ['ui.route.exists', 'satisfied'],
      ['ui.text.exists', 'satisfied'],
    ])
  })

  it('matches role, env var, and test coverage hint requirements', () => {
    const requirements = [
      req('req_role', { kind: 'auth', subject: 'admin access', object: 'admin', evidenceText: 'Only admin role may access settings.' }),
      req('req_env', { kind: 'config', subject: 'api key', object: 'API_KEY' }),
      req('req_test', { kind: 'test', subject: 'duplicate email', object: 'duplicate email' }),
    ]
    const facts = [
      fact('fact_role', { kind: 'auth.signal', predicate: 'auth.detected', value: { signal: 'requireRole("admin")', source: 'role-check' } }),
      fact('fact_env', { kind: 'config.env', predicate: 'env.read', value: { name: 'API_KEY', access: 'bracket' } }),
      fact('fact_test', { kind: 'test.case', predicate: 'test.named', value: { name: 'rejects duplicate email', fullName: 'users > rejects duplicate email', suitePath: ['users'], stringReferences: [] } }),
    ]

    expect(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => item.status)).toEqual(['satisfied', 'satisfied', 'satisfied'])
  })

  it('returns unverifiable for request and data fields when future fact taxonomy is absent, and matches when present', () => {
    const requirements = [
      req('req_request', { kind: 'api', subject: 'create user payload', object: 'email', evidenceText: 'POST /users request body must include email field.' }),
      req('req_data', { kind: 'data', subject: 'user table', object: 'email', evidenceText: 'User data must include email field.' }),
    ]

    expect(evaluateSpecCompliance({ requirements, facts: [] }).results.map((item) => item.status)).toEqual(['unverifiable', 'unverifiable'])

    const facts = [
      fact('fact_request', { kind: 'api.request.field', predicate: 'field.required', value: { method: 'POST', path: '/users', name: 'email', required: true } }),
      fact('fact_data', { kind: 'data.field', predicate: 'field.exists', value: { entity: 'User', name: 'email' } }),
    ]
    expect(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => item.status)).toEqual(['satisfied', 'satisfied'])
  })

  it('inverts must_not requirements to conflicting when facts exist and satisfied when absent', () => {
    const requirements = [
      req('req_forbidden_present', { kind: 'api', modality: 'must_not', subject: 'legacy route', object: 'GET /legacy' }),
      req('req_forbidden_absent', { kind: 'api', modality: 'must_not', subject: 'old route', object: 'GET /old' }),
    ]
    const facts = [
      fact('fact_legacy', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/legacy', middlewares: [] } }),
    ]

    expect(Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.requirementId, item.status]))).toEqual({
      req_forbidden_absent: 'satisfied',
      req_forbidden_present: 'conflicting',
    })
  })

  it('emits unspecified implementation findings for unmatched API routes, UI routes, and env vars', () => {
    const result = evaluateSpecCompliance({
      requirements: [req('req_route', { kind: 'api', subject: 'health route', object: 'GET /health' })],
      facts: [
        fact('fact_health', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/health', middlewares: [] } }),
        fact('fact_admin', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/admin', middlewares: [] } }),
        fact('fact_ui', { kind: 'ui.route', predicate: 'route.exists', value: { path: '/settings' } }),
        fact('fact_env', { kind: 'config.env', predicate: 'env.read', value: { name: 'SECRET_KEY', access: 'dot' } }),
      ],
      includeSatisfiedResults: true,
      includeUnspecifiedFindings: true,
    })

    expect(result.findings.filter((item) => item.status === 'unspecified').map((item) => item.factId)).toEqual(['fact_admin', 'fact_env', 'fact_ui'])
  })

  it('is byte-stable under canonical JSON', () => {
    const requirements = [
      req('req_route', { kind: 'api', subject: 'health route', object: 'GET /health' }),
      req('req_env', { kind: 'config', subject: 'api key', object: 'API_KEY' }),
    ]
    const facts = [
      fact('fact_env', { kind: 'config.env', predicate: 'env.read', value: { access: 'dot', name: 'API_KEY' } }),
      fact('fact_route', { kind: 'api.route', predicate: 'route.exists', value: { middlewares: [], path: '/health', method: 'GET' } }),
    ]

    const first = canonicalJson(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true, includeUnspecifiedFindings: true }))
    const second = canonicalJson(evaluateSpecCompliance({ requirements: [...requirements].reverse(), facts: [...facts].reverse(), includeSatisfiedResults: true, includeUnspecifiedFindings: true }))

    expect(first).toBe(second)
    expect(first).toContain('"matcher":{"name":"api.route.exists","version":"1.0.0"}')
    expect(first).toContain('"matcher":{"name":"config.env_var_required","version":"1.0.0"}')
  })
})
