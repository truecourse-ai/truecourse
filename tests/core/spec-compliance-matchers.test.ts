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

  it('matches OpenAPI operation status codes, required request fields, and auth partially', () => {
    const requirements = [
      req('req_openapi_satisfied', {
        kind: 'api',
        subject: 'create user',
        object: 'POST /users',
        constraints: [
          { type: 'statusCode', value: ['201'] },
          { type: 'requestField', value: [{ name: 'email', required: true }] },
          { type: 'auth', value: [{ bearerAuth: [] }] },
        ],
      }),
      req('req_openapi_partial', {
        kind: 'api',
        subject: 'create account',
        object: 'POST /accounts',
        constraints: [
          { type: 'statusCode', value: ['201'] },
          { type: 'requestField', value: [{ name: 'email', required: true }] },
        ],
      }),
    ]
    const facts = [
      fact('fact_users', { kind: 'api.route', predicate: 'route.exists', value: { method: 'POST', path: '/users', middlewares: ['requireAuth'] } }),
      fact('fact_users_auth', { kind: 'auth.signal', predicate: 'auth.detected', value: { signal: 'requireAuth', source: 'middleware', route: '/users' } }),
      fact('fact_users_status', { kind: 'api.response.status', predicate: 'status.returned', value: { method: 'POST', path: '/users', statusCode: 201 } }),
      fact('fact_users_field', { kind: 'api.request.field', predicate: 'field.used', value: { method: 'POST', path: '/users', name: 'email' } }),
      fact('fact_accounts', { kind: 'api.route', predicate: 'route.exists', value: { method: 'POST', path: '/accounts', middlewares: [] } }),
      fact('fact_accounts_status', { kind: 'api.response.status', predicate: 'status.returned', value: { method: 'POST', path: '/accounts', statusCode: 200 } }),
      fact('fact_accounts_field', { kind: 'api.request.field', predicate: 'field.used', value: { method: 'POST', path: '/accounts', name: 'name' } }),
    ]

    expect(Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.requirementId, item.status]))).toEqual({
      req_openapi_partial: 'partial',
      req_openapi_satisfied: 'satisfied',
    })
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

  it('normalizes extracted field and route targets from prose requirements', () => {
    const requirements = [
      req('req_data_field', {
        kind: 'data',
        subject: '`article` table',
        action: 'include',
        object: '`id` field',
        evidenceText: '`id` | uuid | Stable article identifier.',
      }),
      req('req_ui_fields', {
        kind: 'ui',
        subject: 'create mode UI',
        action: 'require',
        object: 'title and URL fields',
        evidenceText: 'Required fields in the UI: title and URL.',
      }),
      req('req_query_route', {
        kind: 'api',
        subject: 'DELETE /api/articles?id={id}',
        action: 'delete',
        object: 'DELETE /api/articles?id={id}',
      }),
      req('req_dynamic_route_field', {
        kind: 'api',
        subject: 'publish route',
        action: 'accept',
        object: 'POST /api/articles/[id]/publish',
        constraints: [{ type: 'requestField', value: 'updatedAt field' }],
      }),
    ]
    const facts = [
      fact('fact_id', { kind: 'data.field', predicate: 'field.exists', value: { table: 'article', name: 'id' } }),
      fact('fact_title', { kind: 'ui.form_field', predicate: 'field.exists', value: { id: 'title', label: 'Title *' } }),
      fact('fact_url', { kind: 'ui.form_field', predicate: 'field.exists', value: { id: 'url', label: 'URL *' } }),
      fact('fact_delete_route', { kind: 'api.route', predicate: 'route.exists', value: { method: 'DELETE', path: '/api/articles', middlewares: [] } }),
      fact('fact_delete_param', { kind: 'api.query.param', predicate: 'param.used', value: { method: 'DELETE', path: '/api/articles', name: 'id' } }),
      fact('fact_publish_route', { kind: 'api.route', predicate: 'route.exists', value: { method: 'POST', path: '/api/articles/:id/publish', middlewares: [] } }),
      fact('fact_publish_field', { kind: 'api.request.field', predicate: 'field.used', value: { method: 'POST', path: '/api/articles/:id/publish', name: 'updatedAt' } }),
    ]

    expect(Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.requirementId, [item.matcher.name, item.status]]))).toEqual({
      req_data_field: ['data.field_exists', 'satisfied'],
      req_dynamic_route_field: ['api.openapi_operation', 'satisfied'],
      req_query_route: ['api.query.param_exists', 'satisfied'],
      req_ui_fields: ['ui.form.field_exists', 'satisfied'],
    })
  })

  it('matches API validation, mutation fields, and UI workflow semantics', () => {
    const requirements = [
      req('req_title_validation', {
        kind: 'api',
        subject: 'create article validation',
        object: 'POST /api/articles',
        constraints: [{ type: 'validationField', value: 'title' }],
        evidenceText: 'POST /api/articles must validate required title.',
      }),
      req('req_url_validation', {
        kind: 'api',
        subject: 'create article URL validation',
        object: 'POST /api/articles',
        constraints: [
          { type: 'validationField', value: 'url' },
          { type: 'format', value: 'url' },
        ],
        evidenceText: 'POST /api/articles must validate required URL.',
      }),
      req('req_patch_flags', {
        kind: 'api',
        subject: 'manual article review update',
        object: 'PATCH /api/articles',
        constraints: [{ type: 'mutationField', value: 'reviewed and published' }],
        evidenceText: 'PATCH /api/articles must update reviewed and published.',
      }),
      req('req_delete_action', {
        kind: 'ui',
        subject: 'delete article action',
        object: 'delete article',
        evidenceText: 'The admin UI must expose a delete action for articles.',
      }),
      req('req_article_review_delete_action', {
        kind: 'ui',
        subject: 'Article Review delete action',
        object: 'delete article',
        evidenceText: 'The Article Review UI must expose a delete action for articles.',
      }),
      req('req_close_guard', {
        kind: 'ui',
        subject: 'modal close guard',
        object: 'close',
        evidenceText: 'The modal close action must be guarded while save is in flight.',
      }),
      req('req_modal', {
        kind: 'ui',
        subject: 'article review modal',
        object: 'article review modal',
        evidenceText: 'The article review modal must exist.',
      }),
    ]
    const facts = [
      fact('fact_post_route', { kind: 'api.route', predicate: 'route.exists', value: { method: 'POST', path: '/api/articles', middlewares: [] } }),
      fact('fact_patch_route', { kind: 'api.route', predicate: 'route.exists', value: { method: 'PATCH', path: '/api/articles', middlewares: [] } }),
      fact('fact_title_validation', { kind: 'api.validation.field', predicate: 'field.validated', value: { method: 'POST', path: '/api/articles', name: 'title', required: true, failureStatus: 400 } }),
      fact('fact_reviewed', { kind: 'api.mutation.field', predicate: 'field.set', value: { method: 'PATCH', path: '/api/articles', operation: 'update', entity: 'articles', field: 'reviewed' } }),
      fact('fact_delete_action', { kind: 'ui.action', predicate: 'action.exists', sourceFile: 'apps/admin/components/PostEditor/ArticleBlock.tsx', value: { action: 'delete', label: 'Delete', handler: 'handleDelete' } }),
      fact('fact_guarded_close', { kind: 'ui.action', predicate: 'action.exists', value: { action: 'close', label: 'Cancel', handler: 'handleClose', guarded: true } }),
      fact('fact_unguarded_close', { kind: 'ui.action', predicate: 'action.exists', value: { action: 'close', handler: 'onClose', guarded: false } }),
      fact('fact_close_guard', { kind: 'ui.guard', predicate: 'guard.exists', value: { event: 'close', handler: 'handleClose', conditions: ['!isSaving'] } }),
      fact('fact_modal', { kind: 'ui.modal', predicate: 'modal.exists', value: { controlledBy: 'isOpen' } }),
    ]

    expect(Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.requirementId, [item.matcher.name, item.status]]))).toEqual({
      req_article_review_delete_action: ['ui.action.exists', 'missing'],
      req_close_guard: ['ui.close.guard_required', 'partial'],
      req_delete_action: ['ui.action.exists', 'satisfied'],
      req_modal: ['ui.modal.exists', 'satisfied'],
      req_patch_flags: ['api.mutation.field_set', 'partial'],
      req_title_validation: ['api.validation.field_required', 'satisfied'],
      req_url_validation: ['api.validation.field_required', 'missing'],
    })
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

  it('matches CLI binaries, commands, options, and arguments', () => {
    const requirements = [
      req('req_binary', { kind: 'cli', subject: 'truecourse binary', constraints: [{ type: 'cliBinary', value: 'truecourse' }] }),
      req('req_command', { kind: 'cli', subject: 'analyze command', constraints: [{ type: 'cliCommand', value: 'truecourse analyze' }] }),
      req('req_option', {
        kind: 'cli',
        subject: 'analyze spec option',
        constraints: [
          { type: 'cliCommand', value: 'truecourse analyze' },
          { type: 'cliOption', value: '--spec-compliance' },
        ],
      }),
      req('req_argument', {
        kind: 'cli',
        subject: 'rules enable argument',
        constraints: [
          { type: 'cliCommand', value: 'truecourse rules enable' },
          { type: 'cliArgument', value: 'ruleKey' },
        ],
      }),
    ]
    const facts = [
      fact('fact_bin', { kind: 'cli.binary', predicate: 'binary.defined', value: { name: 'truecourse' } }),
      fact('fact_analyze', { kind: 'cli.command', predicate: 'command.defined', value: { name: 'analyze', fullName: 'truecourse analyze', path: ['analyze'], parentPath: [], aliases: [], source: 'commander', hasAction: true } }),
      fact('fact_rules_enable', { kind: 'cli.command', predicate: 'command.defined', value: { name: 'enable', fullName: 'truecourse rules enable', path: ['rules', 'enable'], parentPath: ['rules'], aliases: [], source: 'commander', hasAction: true } }),
      fact('fact_option', { kind: 'cli.option', predicate: 'option.defined', value: { command: 'truecourse analyze', commandPath: ['analyze'], name: '--spec-compliance', required: false, negated: false } }),
      fact('fact_arg', { kind: 'cli.argument', predicate: 'argument.defined', value: { command: 'truecourse rules enable', commandPath: ['rules', 'enable'], name: 'ruleKey', required: true, variadic: false } }),
    ]

    expect(Object.fromEntries(evaluateSpecCompliance({ requirements, facts, includeSatisfiedResults: true }).results.map((item) => [item.matcher.name, item.status]))).toEqual({
      'cli.argument.exists': 'satisfied',
      'cli.binary.exists': 'satisfied',
      'cli.command.exists': 'satisfied',
      'cli.option.exists': 'satisfied',
    })
  })

  it('handles missing, partial, unverifiable, and prohibited CLI requirements', () => {
    const facts = [
      fact('fact_bin', { kind: 'cli.binary', predicate: 'binary.defined', value: { name: 'truecourse' } }),
      fact('fact_analyze', { kind: 'cli.command', predicate: 'command.defined', value: { name: 'analyze', fullName: 'truecourse analyze', path: ['analyze'], parentPath: [], aliases: [], source: 'commander', hasAction: true } }),
      fact('fact_option', { kind: 'cli.option', predicate: 'option.defined', value: { command: 'truecourse analyze', commandPath: ['analyze'], name: '--debug', required: false, negated: false } }),
    ]
    const requirements = [
      req('req_missing_command', { kind: 'cli', subject: 'deploy command', constraints: [{ type: 'cliCommand', value: 'truecourse deploy' }] }),
      req('req_partial_option', {
        kind: 'cli',
        subject: 'analyze required option',
        constraints: [
          { type: 'cliCommand', value: 'truecourse analyze' },
          { type: 'cliOption', value: '--spec-compliance' },
        ],
      }),
      req('req_partial_argument', {
        kind: 'cli',
        subject: 'analyze path argument',
        constraints: [
          { type: 'cliCommand', value: 'truecourse analyze' },
          { type: 'cliArgument', value: 'path' },
        ],
      }),
      req('req_forbidden_command', { kind: 'cli', modality: 'must_not', subject: 'analyze command', constraints: [{ type: 'cliCommand', value: 'truecourse analyze' }] }),
      req('req_forbidden_option', {
        kind: 'cli',
        modality: 'must_not',
        subject: 'debug option',
        constraints: [
          { type: 'cliCommand', value: 'truecourse analyze' },
          { type: 'cliOption', value: '--debug' },
        ],
      }),
      req('req_unverifiable', { kind: 'cli', subject: 'truecourse binary', constraints: [{ type: 'cliBinary', value: 'truecourse' }] }),
    ]

    const result = evaluateSpecCompliance({ requirements: requirements.slice(0, -1), facts, includeSatisfiedResults: true })
    expect(Object.fromEntries(result.results.map((item) => [item.requirementId, item.status]))).toEqual({
      req_forbidden_command: 'conflicting',
      req_forbidden_option: 'conflicting',
      req_missing_command: 'missing',
      req_partial_argument: 'partial',
      req_partial_option: 'partial',
    })
    expect(evaluateSpecCompliance({ requirements: [requirements[5]!], facts: [], includeSatisfiedResults: true }).results[0]?.status).toBe('unverifiable')
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

  it('emits unspecified implementation findings for unmatched API routes, UI routes, env vars, CLI binaries, and CLI commands', () => {
    const result = evaluateSpecCompliance({
      requirements: [req('req_route', { kind: 'api', subject: 'health route', object: 'GET /health' })],
      facts: [
        fact('fact_health', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/health', middlewares: [] } }),
        fact('fact_admin', { kind: 'api.route', predicate: 'route.exists', value: { method: 'GET', path: '/admin', middlewares: [] } }),
        fact('fact_ui', { kind: 'ui.route', predicate: 'route.exists', value: { path: '/settings' } }),
        fact('fact_env', { kind: 'config.env', predicate: 'env.read', value: { name: 'SECRET_KEY', access: 'dot' } }),
        fact('fact_env_duplicate', { kind: 'config.env', predicate: 'env.read', value: { name: 'SECRET_KEY', access: 'dot' } }),
        fact('fact_cli_bin', { kind: 'cli.binary', predicate: 'binary.defined', value: { name: 'truecourse' } }),
        fact('fact_cli_command', { kind: 'cli.command', predicate: 'command.defined', value: { name: 'rules', fullName: 'truecourse rules', path: ['rules'], parentPath: [], aliases: [], source: 'commander', hasAction: false } }),
        fact('fact_cli_option', { kind: 'cli.option', predicate: 'option.defined', value: { command: 'truecourse rules', commandPath: ['rules'], name: '--json', required: false, negated: false } }),
      ],
      includeSatisfiedResults: true,
      includeUnspecifiedFindings: true,
    })

    expect(result.findings.filter((item) => item.status === 'unspecified').map((item) => item.factId)).toEqual(['fact_admin', 'fact_cli_bin', 'fact_cli_command', 'fact_env', 'fact_ui'])
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
