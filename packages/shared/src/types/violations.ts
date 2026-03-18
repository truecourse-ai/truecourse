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
// Violation
// ---------------------------------------------------------------------------

export const ViolationSchema = z.object({
  id: z.string(),
  type: ViolationTypeSchema,
  title: z.string(),
  content: z.string(),
  severity: ViolationSeveritySchema,
  targetServiceId: z.string().optional(),
  targetDatabaseId: z.string().optional(),
  targetModuleId: z.string().optional(),
  targetMethodId: z.string().optional(),
  targetTable: z.string().optional(),
  fixPrompt: z.string().optional(),
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
