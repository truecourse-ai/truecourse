import { describe, expect, it } from 'vitest'
import {
  CodeFactSchema,
  ComplianceResultSchema,
  RequirementSchema,
  SpecComplianceConfigSchema,
  canonicalJson,
  createCodeFactId,
  createRequirementId,
  createSpecChunkId,
} from '../../packages/shared/src/types/spec-compliance'

const requirement = {
  id: 'req_123',
  sourceFile: 'docs/billing.md',
  sourceRange: { startLine: 18, endLine: 22 },
  kind: 'api',
  modality: 'must',
  subject: 'billing service',
  action: 'expose',
  object: 'POST /api/billing/checkout',
  constraints: [
    {
      type: 'auth',
      value: 'requires authenticated user',
    },
  ],
  evidenceText: 'The billing service must expose POST /api/billing/checkout for authenticated users.',
  confidence: 0.94,
  extractor: {
    name: 'markdown-llm-requirement-extractor',
    version: '1.0.0',
  },
} as const

const codeFact = {
  id: 'fact_123',
  sourceFile: 'apps/dashboard/server/routes/billing.ts',
  sourceRange: { startLine: 42, endLine: 58 },
  kind: 'api.route',
  predicate: 'route.exists',
  value: {
    method: 'POST',
    path: '/api/billing/checkout',
  },
  confidence: 1,
  extractor: {
    name: 'express-route-extractor',
    version: '1.0.0',
  },
} as const

describe('spec compliance schemas', () => {
  it('accepts valid requirement examples', () => {
    expect(RequirementSchema.parse(requirement)).toEqual(requirement)
  })

  it('accepts valid code fact examples', () => {
    expect(CodeFactSchema.parse(codeFact)).toEqual(codeFact)
  })

  it('accepts valid compliance result examples', () => {
    const result = {
      requirementId: requirement.id,
      status: 'satisfied',
      severity: 'info',
      message: 'Checkout route exists.',
      evidence: {
        requirement,
        matchingFacts: [codeFact],
        conflictingFacts: [],
      },
      matcher: {
        name: 'api.route.exists',
        version: '1.0.0',
      },
    }

    expect(ComplianceResultSchema.parse(result)).toEqual(result)
  })

  it('rejects malformed LLM-shaped requirement output', () => {
    const result = RequirementSchema.safeParse({
      ...requirement,
      modality: 'required',
      confidence: 1.4,
      extractor: { name: '', version: '1.0.0' },
    })

    expect(result.success).toBe(false)
  })

  it('rejects inverted source ranges', () => {
    const result = RequirementSchema.safeParse({
      ...requirement,
      sourceRange: { startLine: 22, endLine: 18 },
    })

    expect(result.success).toBe(false)
  })
})

describe('spec compliance config', () => {
  it('enables checks by default with conservative output settings', () => {
    const config = SpecComplianceConfigSchema.parse({})

    expect(config.enabled).toBe(true)
    expect(config.useLlm).toBe(true)
    expect(config.includeSatisfiedResults).toBe(false)
    expect(config.includeUnspecifiedFindings).toBe(false)
    expect(config.failOnMalformedOutput).toBe(true)
    expect(config.specGlobs).toContain('docs/**')
    expect(config.excludeGlobs).toContain('**/.truecourse/**')
  })
})

describe('canonicalJson', () => {
  it('sorts nested object keys recursively', () => {
    const first = {
      b: 2,
      a: {
        d: 4,
        c: [{ y: 'yes', x: 'ex' }],
      },
    }
    const second = {
      a: {
        c: [{ x: 'ex', y: 'yes' }],
        d: 4,
      },
      b: 2,
    }

    expect(canonicalJson(first)).toBe(canonicalJson(second))
    expect(canonicalJson(first)).toBe('{"a":{"c":[{"x":"ex","y":"yes"}],"d":4},"b":2}')
  })
})

describe('stable spec compliance IDs', () => {
  it('creates stable requirement IDs from normalized inputs', () => {
    const first = createRequirementId({
      sourceFile: './docs/billing.md',
      sourceRange: { startLine: 18, endLine: 22 },
      evidenceText: 'The billing service must expose POST /api/billing/checkout.',
      extractorVersion: '1.0.0',
    })
    const second = createRequirementId({
      sourceFile: 'docs/billing.md',
      sourceRange: { startLine: 18, endLine: 22 },
      evidenceText: '  The billing service must expose   POST /api/billing/checkout. ',
      extractorVersion: '1.0.0',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^req_[a-f0-9]{12}$/)
  })

  it('distinguishes requirements split from the same evidence text', () => {
    const title = createRequirementId({
      sourceFile: 'docs/editor.md',
      sourceRange: { startLine: 10, endLine: 10 },
      evidenceText: 'Required fields in the UI: title and URL.',
      kind: 'ui',
      modality: 'must',
      subject: 'create mode UI',
      action: 'require',
      object: 'title field',
      extractorVersion: '1.0.0',
    })
    const url = createRequirementId({
      sourceFile: 'docs/editor.md',
      sourceRange: { startLine: 10, endLine: 10 },
      evidenceText: 'Required fields in the UI: title and URL.',
      kind: 'ui',
      modality: 'must',
      subject: 'create mode UI',
      action: 'require',
      object: 'URL field',
      extractorVersion: '1.0.0',
    })

    expect(title).not.toBe(url)
  })

  it('creates stable code fact IDs from canonical values', () => {
    const first = createCodeFactId({
      sourceFile: './src/routes/billing.ts',
      sourceRange: { startLine: 42, endLine: 58 },
      kind: 'api.route',
      predicate: 'route.exists',
      value: { method: 'POST', path: '/api/billing/checkout' },
      extractorVersion: '1.0.0',
    })
    const second = createCodeFactId({
      sourceFile: 'src/routes/billing.ts',
      sourceRange: { startLine: 42, endLine: 58 },
      kind: 'api.route',
      predicate: 'route.exists',
      value: { path: '/api/billing/checkout', method: 'POST' },
      extractorVersion: '1.0.0',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^fact_[a-f0-9]{12}$/)
  })

  it('creates stable chunk IDs from normalized source text', () => {
    const first = createSpecChunkId({
      sourceFile: './docs/billing.md',
      sourceRange: { startLine: 4, endLine: 8 },
      text: 'The service must expose the checkout route.',
      extractorVersion: '1.0.0',
    })
    const second = createSpecChunkId({
      sourceFile: 'docs/billing.md',
      sourceRange: { startLine: 4, endLine: 8 },
      text: '  The service must expose   the checkout route. ',
      extractorVersion: '1.0.0',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^chunk_[a-f0-9]{12}$/)
  })
})
