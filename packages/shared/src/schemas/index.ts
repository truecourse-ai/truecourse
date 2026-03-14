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
})

export type AnalyzeRepoInput = z.infer<typeof AnalyzeRepoSchema>

export const GenerateInsightsSchema = z.object({
  analysisId: z.string().uuid().optional(),
})

export type GenerateInsightsInput = z.infer<typeof GenerateInsightsSchema>

export const ChatMessageSchema = z.object({
  message: z.string().min(1),
  nodeContext: z.any().optional(),
  conversationId: z.string().uuid().optional(),
})

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>
