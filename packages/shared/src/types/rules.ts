import { z } from 'zod'

export const RuleCategorySchema = z.enum(['service', 'database', 'module', 'code'])
export type RuleCategory = z.infer<typeof RuleCategorySchema>

export const RuleSeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical'])
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>

export const RuleTypeSchema = z.enum(['deterministic', 'llm'])
export type RuleType = z.infer<typeof RuleTypeSchema>

export const AnalysisRuleSchema = z.object({
  key: z.string(),
  category: RuleCategorySchema,
  name: z.string(),
  description: z.string(),
  prompt: z.string().optional(),
  enabled: z.boolean(),
  severity: RuleSeveritySchema,
  type: RuleTypeSchema,
})

export type AnalysisRule = z.infer<typeof AnalysisRuleSchema>
