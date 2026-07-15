/**
 * The RAW program-output excerpt pair that rides on a guard failure, a birth
 * finding, and the birth-retry prompt (Fix 1): head-truncated stdout/stderr of the
 * failing step, exactly as the child printed it (NOT the normalized text the
 * matchers compared against). Each stream is omitted when it was empty — no
 * empty-string noise — and both are optional so pre-change snapshots keep parsing.
 * One schema, spread into every shape that carries the pair, so they can't drift.
 */

import { z } from 'zod'

export const OutputExcerptsSchema = z.object({
  /** Head-truncated RAW stdout of the failing step; absent when the stream was empty. */
  stdout: z.string().optional(),
  /** Head-truncated RAW stderr of the failing step; absent when the stream was empty. */
  stderr: z.string().optional(),
})
export type OutputExcerpts = z.infer<typeof OutputExcerptsSchema>
