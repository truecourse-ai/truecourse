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

// ---------------------------------------------------------------------------
// ADR API request schemas — used by the HTTP routes (web UI) only.
// The CLI imports `suggestAdrsInProcess` etc. directly; these don't apply there.
// ---------------------------------------------------------------------------

export const SuggestAdrsRequestSchema = z.object({
  threshold: z.number().min(0).max(1).optional(),
  max: z.number().int().positive().optional(),
  topicHint: z.string().optional(),
})
export type SuggestAdrsRequest = z.infer<typeof SuggestAdrsRequestSchema>

/** Raw-MADR save payload. Single body for both drafts and accepted ADRs —
 *  the user edits the full `.md` document (frontmatter + body) in the
 *  Raw mode textarea, sends it back whole, and the server reparses. */
export const SaveRawMadrRequestSchema = z.object({
  source: z.string().min(1),
})
export type SaveRawMadrRequest = z.infer<typeof SaveRawMadrRequestSchema>

export const LinkAdrRequestSchema = z.object({
  nodeId: z.string().min(1),
})
export type LinkAdrRequest = z.infer<typeof LinkAdrRequestSchema>
