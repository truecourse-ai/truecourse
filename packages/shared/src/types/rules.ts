import { z } from 'zod'

export const RuleDomainSchema = z.enum(['architecture', 'security', 'bugs', 'code-quality', 'style', 'database', 'performance', 'reliability'])
export type RuleDomain = z.infer<typeof RuleDomainSchema>

export const RuleCategorySchema = z.enum(['service', 'database', 'module', 'method', 'code'])
export type RuleCategory = z.infer<typeof RuleCategorySchema>

export const RuleSeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical'])
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>

export const RuleTypeSchema = z.enum(['deterministic', 'llm'])
export type RuleType = z.infer<typeof RuleTypeSchema>

// ---------------------------------------------------------------------------
// Context Requirement — controls what context the LLM receives per rule
// ---------------------------------------------------------------------------

export const ContextTierSchema = z.enum(['metadata', 'targeted', 'full-file'])
export type ContextTier = z.infer<typeof ContextTierSchema>

export const FileFilterSchema = z.object({
  hasAsyncFunctions: z.boolean().optional(),
  hasRouteHandlers: z.boolean().optional(),
  hasDbCalls: z.boolean().optional(),
  hasCatchBlocks: z.boolean().optional(),
  hasImportsFrom: z.array(z.string()).optional(),
  hasCallsTo: z.array(z.string()).optional(),
  isTestFile: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
})

export type FileFilter = z.infer<typeof FileFilterSchema>

export const FunctionFilterSchema = z.object({
  isAsync: z.boolean().optional(),
  isRouteHandler: z.boolean().optional(),
  containsCatchBlock: z.boolean().optional(),
  callsAny: z.array(z.string()).optional(),
})

export type FunctionFilter = z.infer<typeof FunctionFilterSchema>

export const ContextRequirementSchema = z.object({
  tier: ContextTierSchema,
  fileFilter: FileFilterSchema.optional(),
  functionFilter: FunctionFilterSchema.optional(),
  metadataFields: z.array(z.enum([
    'functions', 'classes', 'imports', 'exports', 'calls', 'httpCalls', 'routeRegistrations',
  ])).optional(),
})

export type ContextRequirement = z.infer<typeof ContextRequirementSchema>

// ---------------------------------------------------------------------------
// Analysis Rule
// ---------------------------------------------------------------------------

export const AnalysisRuleSchema = z.object({
  key: z.string(),
  category: RuleCategorySchema,
  domain: RuleDomainSchema.optional(),
  name: z.string(),
  description: z.string(),
  prompt: z.string().optional(),
  enabled: z.boolean(),
  severity: RuleSeveritySchema,
  type: RuleTypeSchema,
  contextRequirement: ContextRequirementSchema.optional(),
})

export type AnalysisRule = z.infer<typeof AnalysisRuleSchema>
