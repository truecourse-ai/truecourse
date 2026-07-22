/**
 * The durable across-run guard ledger — two records in one gitignored file:
 *
 *  - `entries` (item 14) — the escalation guard's memory. `guard generate` auto-resolves
 *    a high-confidence generation-defect / environment finding without a human task;
 *    this records, keyed by finding IDENTITY (the same `triageCacheKey` hash — doc,
 *    anchor, claim, expected, actual), how many times that identical finding has
 *    auto-resolved across generates. When the count reaches the escalation threshold the
 *    finding surfaces to the human with a "re-generation is not fixing this" note instead
 *    of being auto-resolved again — so auto-resolution can never become an infinite
 *    silent loop.
 *  - `tainted` (item 2) — the claim-taint set. A claim whose scenario ends a run flagged
 *    (a fidelity finding, a generation-defect triage, or an auto-resolution of either) is
 *    recorded here, keyed by CLAIM identity. On the next generate a tainted claim bypasses
 *    the author cache (which still holds the rejected scenario) and re-authors fresh,
 *    carrying the prior mismatch as correction evidence; a faithful pass clears it. This
 *    ends the treadmill where the cache re-served the byte-identical bad scenario every
 *    run until the escalation guard fired.
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

/** One tainted claim (item 2): why its scenario was rejected last run, threaded into
 *  the next generate's fresh author call as correction evidence. Keyed by claim
 *  identity; the identity fields are stored too so the ledger is self-describing. */
export const GuardClaimTaintSchema = z
  .object({
    /** Repo-relative doc the claim comes from. */
    doc: z.string(),
    /** The bound section anchor. */
    anchor: z.string(),
    /** The extracted claim's stable text — the claim identity (with doc + anchor). */
    claim: z.string(),
    /** The rejected scenario's title — context for the fresh re-author. */
    title: z.string(),
    /** Why it was rejected — the fidelity mismatch or the triage brief. */
    mismatch: z.string(),
    /** ISO timestamp of the most recent taint. */
    updatedAt: z.string(),
  })
  .strict()
export type GuardClaimTaint = z.infer<typeof GuardClaimTaintSchema>

/** The whole ledger: the escalation counts keyed by finding identity, plus the
 *  claim-taint set keyed by claim identity. Both records default to `{}` so a file
 *  written before either existed still parses (an old `{version, entries}` file reads
 *  with an empty `tainted`). */
export const GuardAutoResolutionsSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string(), GuardAutoResolutionEntrySchema).default({}),
    tainted: z.record(z.string(), GuardClaimTaintSchema).default({}),
  })
  .strict()
export type GuardAutoResolutions = z.infer<typeof GuardAutoResolutionsSchema>

/** An empty, valid ledger — the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_AUTO_RESOLUTIONS: GuardAutoResolutions = { version: 1, entries: {}, tainted: {} }

/** The default number of times a finding may auto-resolve before it escalates to a
 *  human task ("re-generation is not fixing this"). */
export const DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER = 2
