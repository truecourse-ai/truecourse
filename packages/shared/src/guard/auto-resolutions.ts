/**
 * The durable across-run auto-resolution ledger — the escalation guard's memory
 * (item 14). `guard generate` auto-resolves a high-confidence generation-defect /
 * environment finding without a human task; this file records, keyed by finding
 * IDENTITY (the same `triageCacheKey` hash — doc, anchor, claim, expected, actual),
 * how many times that identical finding has been auto-resolved across generates.
 * When the count reaches the escalation threshold the finding surfaces to the human
 * with a "re-generation is not fixing this" note instead of being auto-resolved
 * again — so auto-resolution can never become an infinite silent loop.
 *
 * Gitignored (transient run memory, like `guard/result.json`); it lives in the
 * `guard/` run store, not the committable `scenarios/` tree. A missing or corrupt
 * file reads as empty so it never blocks a run.
 */

import { z } from 'zod'
import { GuardTriageVerdictSchema } from './report.js'

/** One tracked finding identity — how many times it has auto-resolved, and the last
 *  verdict that drove it (for the escalation note). */
export const GuardAutoResolutionEntrySchema = z
  .object({
    /** How many generates have auto-resolved this identical finding without converging. */
    count: z.number().int().positive(),
    /** The verdict of the most recent auto-resolution (drives the escalation note). */
    verdict: GuardTriageVerdictSchema,
    /** ISO timestamp of the most recent auto-resolution. */
    updatedAt: z.string(),
  })
  .strict()
export type GuardAutoResolutionEntry = z.infer<typeof GuardAutoResolutionEntrySchema>

/** The whole ledger: finding-identity hash → its auto-resolution record. */
export const GuardAutoResolutionsSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string(), GuardAutoResolutionEntrySchema).default({}),
  })
  .strict()
export type GuardAutoResolutions = z.infer<typeof GuardAutoResolutionsSchema>

/** An empty, valid ledger — the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_AUTO_RESOLUTIONS: GuardAutoResolutions = { version: 1, entries: {} }

/** The default number of times a finding may auto-resolve before it escalates to a
 *  human task ("re-generation is not fixing this"). */
export const DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER = 2
