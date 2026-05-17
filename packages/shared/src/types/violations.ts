import { z } from 'zod'
import { ArchitectureSchema, ServiceTypeSchema } from './entity.js'

// ---------------------------------------------------------------------------
// Violation Type
// ---------------------------------------------------------------------------

export const ViolationTypeSchema = z.enum([
  'architecture',
  'dependency',
  'violation',
  'suggestion',
  'warning',
  'database',
  'module',
  'service',
  'function',
])
export type ViolationType = z.infer<typeof ViolationTypeSchema>

// ---------------------------------------------------------------------------
// Violation Severity
// ---------------------------------------------------------------------------

export const ViolationSeveritySchema = z.enum([
  'info',
  'low',
  'medium',
  'high',
  'critical',
])
export type ViolationSeverity = z.infer<typeof ViolationSeveritySchema>

// ---------------------------------------------------------------------------
// Violation Status
// ---------------------------------------------------------------------------

export const ViolationStatusSchema = z.enum(['new', 'unchanged', 'resolved'])
export type ViolationStatus = z.infer<typeof ViolationStatusSchema>

// ---------------------------------------------------------------------------
// Violation Category — the source the violation came from. `rule` is the
// existing deterministic + LLM rule engine. `contract-drift` is produced by
// the contract verifier (spec → .tc → comparator). One concept, two sources.
// ---------------------------------------------------------------------------

export const ViolationCategorySchema = z.enum(['rule', 'contract-drift'])
export type ViolationCategory = z.infer<typeof ViolationCategorySchema>

// ---------------------------------------------------------------------------
// Violation
// ---------------------------------------------------------------------------

export const ViolationSchema = z.object({
  id: z.string(),
  type: ViolationTypeSchema,
  /** Source of the violation. Defaults to 'rule' for back-compat with
   *  pre-Phase-6 snapshots that don't carry the field. */
  category: ViolationCategorySchema.default('rule'),
  /** Optional finer classifier — for contract drifts this is the artifact
   *  kind (`Operation`, `Entity`, …); for rule violations it's left null. */
  subcategory: z.string().nullable().optional(),
  title: z.string(),
  content: z.string(),
  severity: ViolationSeveritySchema,
  status: ViolationStatusSchema.optional(),
  targetServiceId: z.string().optional(),
  targetDatabaseId: z.string().optional(),
  targetModuleId: z.string().optional(),
  targetMethodId: z.string().optional(),
  targetTable: z.string().optional(),
  fixPrompt: z.string().optional(),
  ruleKey: z.string().optional(),
  deterministicViolationId: z.string().optional(),
  firstSeenAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  createdAt: z.string(),
})

export type Violation = z.infer<typeof ViolationSchema>

// ---------------------------------------------------------------------------
// Architecture Summary
// ---------------------------------------------------------------------------

export const ArchitectureSummaryServiceSchema = z.object({
  name: z.string(),
  type: ServiceTypeSchema,
  framework: z.string().optional(),
  fileCount: z.number(),
  layers: z.array(z.string()),
})

export type ArchitectureSummaryService = z.infer<typeof ArchitectureSummaryServiceSchema>

export const ArchitectureSummarySchema = z.object({
  architecture: ArchitectureSchema,
  totalServices: z.number(),
  totalFiles: z.number(),
  violations: z.array(ViolationSchema),
  services: z.array(ArchitectureSummaryServiceSchema),
})

export type ArchitectureSummary = z.infer<typeof ArchitectureSummarySchema>
