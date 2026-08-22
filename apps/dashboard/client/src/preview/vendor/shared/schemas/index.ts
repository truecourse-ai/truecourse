// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/schemas/index.ts; delete with the preview.
import { z } from 'zod'

// ---------------------------------------------------------------------------
// API Request/Response Validation Schemas
// ---------------------------------------------------------------------------

export const CreateRepoSchema = z.object({
  path: z.string().min(1),
})

export type CreateRepoInput = z.infer<typeof CreateRepoSchema>

export const AnalyzeRepoSchema = z.object({
  /** Which mode to run, full analyze (HEAD committed state) or diff (working tree
   *  vs LATEST). Required; no silent default. */
  mode: z.enum(['full', 'diff']),
  /** Skip git ops (branch detection, commit hash read, pre-parse stash). Useful
   *  for non-git dirs or test environments. No per-repo-config equivalent -
   *  only way to opt out for a single run. */
  skipGit: z.boolean().optional().default(false),
})

export type AnalyzeRepoInput = z.infer<typeof AnalyzeRepoSchema>

export const GenerateViolationsSchema = z.object({
  analysisId: z.string().uuid().optional(),
})

export type GenerateViolationsInput = z.infer<typeof GenerateViolationsSchema>

// ---------------------------------------------------------------------------
// Directory browse (local-filesystem picker), issue #41
// ---------------------------------------------------------------------------

/** Query for GET /api/repos/browse. `path` optional; server defaults to os.homedir(). */
export const BrowseDirQuerySchema = z.object({
  path: z.string().optional(),
})
export type BrowseDirQuery = z.infer<typeof BrowseDirQuerySchema>

/** One non-hidden subdirectory of the browsed path. */
export const BrowseEntrySchema = z.object({
  /** Basename, e.g. "my-service". */
  name: z.string(),
  /** Absolute path to this subdirectory. */
  path: z.string(),
  /** True when the subdirectory contains a `.git` directory (a git repo). */
  isRepo: z.boolean(),
})
export type BrowseEntry = z.infer<typeof BrowseEntrySchema>

export const BrowseDirResponseSchema = z.object({
  /** The (realpath-resolved) absolute directory being listed. */
  path: z.string(),
  /** Absolute parent path, or null when `path` is the filesystem root. */
  parent: z.string().nullable(),
  /** Non-hidden subdirectories, sorted alphabetically by name. */
  entries: z.array(BrowseEntrySchema),
})
export type BrowseDirResponse = z.infer<typeof BrowseDirResponseSchema>
