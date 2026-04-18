import { z } from 'zod'

// ---------------------------------------------------------------------------
// API Request/Response Validation Schemas
// ---------------------------------------------------------------------------

export const CreateRepoSchema = z.object({
  path: z.string().min(1),
})

export type CreateRepoInput = z.infer<typeof CreateRepoSchema>

export const AnalyzeRepoSchema = z.object({
  /** Which mode to run — full analyze (HEAD committed state) or diff (working tree
   *  vs LATEST). Required; no silent default. */
  mode: z.enum(['full', 'diff']),
  /** Skip git ops (branch detection, commit hash read, pre-parse stash). Useful
   *  for non-git dirs or test environments. No per-repo-config equivalent —
   *  only way to opt out for a single run. */
  skipGit: z.boolean().optional().default(false),
})

export type AnalyzeRepoInput = z.infer<typeof AnalyzeRepoSchema>

export const GenerateViolationsSchema = z.object({
  analysisId: z.string().uuid().optional(),
})

export type GenerateViolationsInput = z.infer<typeof GenerateViolationsSchema>
