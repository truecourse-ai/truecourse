import { createHash } from 'node:crypto'
import { z } from 'zod'

export const SPEC_COMPLIANCE_REQUIREMENT_SCHEMA_VERSION = 'spec-requirement.v1'
export const SPEC_COMPLIANCE_CODE_FACT_SCHEMA_VERSION = 'spec-code-fact.v1'
export const SPEC_COMPLIANCE_RESULT_SCHEMA_VERSION = 'spec-compliance-result.v1'
export const SPEC_COMPLIANCE_MATCHER_VERSION = 'spec-compliance-matcher.v1'
export const SPEC_COMPLIANCE_PROMPT_VERSION = 'spec-compliance-prompt.v1'

export const SpecComplianceFindingCategory = 'spec-compliance' as const

export const SourceRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
}).refine((range) => range.endLine >= range.startLine, {
  message: 'endLine must be greater than or equal to startLine',
  path: ['endLine'],
})

export type SourceRange = z.infer<typeof SourceRangeSchema>

export const ExtractorMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
})

export type ExtractorMetadata = z.infer<typeof ExtractorMetadataSchema>

export const RequirementKindSchema = z.enum([
  'api',
  'ui',
  'ux',
  'auth',
  'data',
  'infra',
  'config',
  'workflow',
  'test',
  'quality',
  'unknown',
])

export type RequirementKind = z.infer<typeof RequirementKindSchema>

export const RequirementModalitySchema = z.enum(['must', 'should', 'may', 'must_not'])
export type RequirementModality = z.infer<typeof RequirementModalitySchema>

export const ComplianceStatusSchema = z.enum([
  'satisfied',
  'missing',
  'conflicting',
  'partial',
  'unverifiable',
  'ambiguous',
])

export type ComplianceStatus = z.infer<typeof ComplianceStatusSchema>

export const ComplianceSeveritySchema = z.enum(['info', 'warning', 'error'])
export type ComplianceSeverity = z.infer<typeof ComplianceSeveritySchema>

export const RequirementConstraintSchema = z.object({
  type: z.string().min(1),
  value: z.unknown(),
})

export type RequirementConstraint = z.infer<typeof RequirementConstraintSchema>

export const RequirementSchema = z.object({
  id: z.string().min(1),
  sourceFile: z.string().min(1),
  sourceRange: SourceRangeSchema,
  kind: RequirementKindSchema,
  modality: RequirementModalitySchema,
  subject: z.string().min(1),
  action: z.string().min(1),
  object: z.string().min(1).optional(),
  constraints: z.array(RequirementConstraintSchema),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
  evidenceText: z.string().min(1),
  confidence: z.number().min(0).max(1),
  extractor: ExtractorMetadataSchema,
})

export type Requirement = z.infer<typeof RequirementSchema>

export const CodeFactSchema = z.object({
  id: z.string().min(1),
  sourceFile: z.string().min(1),
  sourceRange: SourceRangeSchema.optional(),
  kind: z.string().min(1),
  predicate: z.string().min(1),
  value: z.unknown(),
  confidence: z.literal(1),
  extractor: ExtractorMetadataSchema,
})

export type CodeFact = z.infer<typeof CodeFactSchema>

export const MatcherMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
})

export type MatcherMetadata = z.infer<typeof MatcherMetadataSchema>

export const ComplianceResultSchema = z.object({
  requirementId: z.string().min(1),
  status: ComplianceStatusSchema,
  severity: ComplianceSeveritySchema,
  message: z.string().min(1),
  evidence: z.object({
    requirement: RequirementSchema,
    matchingFacts: z.array(CodeFactSchema),
    conflictingFacts: z.array(CodeFactSchema),
  }),
  matcher: MatcherMetadataSchema,
})

export type ComplianceResult = z.infer<typeof ComplianceResultSchema>

export const ComplianceFindingMetadataSchema = z.object({
  category: z.literal(SpecComplianceFindingCategory),
  requirementId: z.string().min(1),
  status: ComplianceStatusSchema,
  matcher: MatcherMetadataSchema,
  specSource: z.object({
    filePath: z.string().min(1),
    range: SourceRangeSchema,
  }),
  implementationSources: z.array(z.object({
    filePath: z.string().min(1),
    range: SourceRangeSchema.optional(),
    factId: z.string().min(1).optional(),
  })),
  confidence: z.number().min(0).max(1),
})

export type ComplianceFindingMetadata = z.infer<typeof ComplianceFindingMetadataSchema>

export const SpecComplianceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  specGlobs: z.array(z.string().min(1)).default([
    'docs/**',
    'specs/**',
    'requirements/**',
    'rfcs/**',
    'adr/**',
    '*.spec.md',
    '*.prd.md',
    '*.requirements.md',
  ]),
  excludeGlobs: z.array(z.string().min(1)).default([
    '**/node_modules/**',
    '**/.git/**',
    '**/.truecourse/**',
  ]),
  useLlm: z.boolean().default(true),
  includeSatisfiedResults: z.boolean().default(false),
  failOnMalformedOutput: z.boolean().default(true),
})

export type SpecComplianceConfig = z.infer<typeof SpecComplianceConfigSchema>

type CanonicalJsonValue =
  | null
  | string
  | number
  | boolean
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

function toCanonicalValue(value: unknown): CanonicalJsonValue {
  if (value === null) return null

  if (Array.isArray(value)) {
    return value.map(toCanonicalValue)
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const sorted: Record<string, CanonicalJsonValue> = {}
    for (const key of Object.keys(object).sort()) {
      const child = object[key]
      if (child !== undefined) {
        sorted[key] = toCanonicalValue(child)
      }
    }
    return sorted
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  return null
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value))
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function stableHash(prefix: string, value: unknown): string {
  const hash = createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 12)
  return `${prefix}_${hash}`
}

export interface RequirementIdInput {
  sourceFile: string
  sourceRange: SourceRange
  evidenceText: string
  extractorVersion: string
}

export function createRequirementId(input: RequirementIdInput): string {
  return stableHash('req', {
    sourceFile: normalizePath(input.sourceFile),
    sourceRange: input.sourceRange,
    evidenceText: normalizeText(input.evidenceText),
    extractorVersion: input.extractorVersion,
  })
}

export interface CodeFactIdInput {
  sourceFile: string
  sourceRange?: SourceRange
  kind: string
  predicate: string
  value: unknown
  extractorVersion: string
}

export function createCodeFactId(input: CodeFactIdInput): string {
  return stableHash('fact', {
    sourceFile: normalizePath(input.sourceFile),
    sourceRange: input.sourceRange,
    kind: input.kind,
    predicate: input.predicate,
    value: input.value,
    extractorVersion: input.extractorVersion,
  })
}
