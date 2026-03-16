import { z } from 'zod'
import { ArchitectureSchema, ServiceTypeSchema } from './entity.js'

// ---------------------------------------------------------------------------
// Insight Type
// ---------------------------------------------------------------------------

export const InsightTypeSchema = z.enum([
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
export type InsightType = z.infer<typeof InsightTypeSchema>

// ---------------------------------------------------------------------------
// Insight Severity
// ---------------------------------------------------------------------------

export const InsightSeveritySchema = z.enum([
  'info',
  'low',
  'medium',
  'high',
  'critical',
])
export type InsightSeverity = z.infer<typeof InsightSeveritySchema>

// ---------------------------------------------------------------------------
// Insight
// ---------------------------------------------------------------------------

export const InsightSchema = z.object({
  id: z.string(),
  type: InsightTypeSchema,
  title: z.string(),
  content: z.string(),
  severity: InsightSeveritySchema,
  targetServiceId: z.string().optional(),
  targetDatabaseId: z.string().optional(),
  targetModuleId: z.string().optional(),
  targetMethodId: z.string().optional(),
  targetTable: z.string().optional(),
  fixPrompt: z.string().optional(),
  createdAt: z.string(),
})

export type Insight = z.infer<typeof InsightSchema>

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
  insights: z.array(InsightSchema),
  services: z.array(ArchitectureSummaryServiceSchema),
})

export type ArchitectureSummary = z.infer<typeof ArchitectureSummarySchema>
