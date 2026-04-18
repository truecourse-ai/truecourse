import { z } from 'zod'

// ---------------------------------------------------------------------------
// API Request/Response Validation Schemas
// ---------------------------------------------------------------------------

export const CreateRepoSchema = z.object({
  path: z.string().min(1),
})

export type CreateRepoInput = z.infer<typeof CreateRepoSchema>

export const AnalyzeRepoSchema = z.object({
  branch: z.string().optional(),
  enabledCategories: z.array(z.string()).optional().default([]),
  enableLlmRules: z.boolean().optional().default(true),
  skipGit: z.boolean().optional().default(false),
})

export type AnalyzeRepoInput = z.infer<typeof AnalyzeRepoSchema>

export const GenerateViolationsSchema = z.object({
  analysisId: z.string().uuid().optional(),
})

export type GenerateViolationsInput = z.infer<typeof GenerateViolationsSchema>
