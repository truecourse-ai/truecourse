/**
 * The durable across-run guard ledger, `guard/auto-resolutions.json`, two
 * records in one gitignored file, both keyed by the FLOW×SURFACE identity
 * ({@link autoResolutionKey}) because the flow is the generation unit:
 *
 *  - `entries`, the escalation guard's memory. `guard generate` auto-resolves a
 *    HIGH-confidence "the test is wrong" verdict without a human task (a
 *    generation-defect triage retires the failure; a fidelity flag discards and
 *    re-authors the scenario once); this counts how many times each flow's test
 *    has auto-resolved across generates. At the escalation threshold the flow
 *    surfaces to the human with a "re-generation is not fixing this" note instead
 *    of auto-resolving again, no auto behavior can become an infinite silent
 *    loop. A flow that converges (commits a passing test) clears its count.
 *  - `tainted`, the flow-taint set. A flow whose test ended a run rejected (a
 *    fidelity rejection, a generation-defect verdict, an auto-resolution of
 *    either, or a persistent setup-declaration defect) is recorded here. On the
 *    next generate a tainted flow BYPASSES the author cache (which still holds
 *    the rejected scenario) and re-authors fresh, carrying the prior mismatch as
 *    correction evidence; a faithful pass clears it, an authoring error keeps it
 *    (the cache is still poisoned).
 *
 * The ledger is the safety valve: none of the auto-resolve behaviors run without
 * it. Gitignored (transient run memory, like `guard/result.json`); it lives in
 * the `guard/` run store, not the committable `scenarios/` tree. A missing or
 * corrupt file reads as empty so it never blocks a run.
 */

import { z } from 'zod'
import { GuardDriverIdSchema } from './drivers'

/** What drove an auto-resolution: a HIGH-confidence `generation-defect` triage
 *  verdict, a HIGH-confidence fidelity flag (the self-heal discard),, on the
 *  session path, a flow-worker session ending `retired` (the
 *  worker itself judged its attempts defective and gave the flow up this run),
 *  or an `authoring-defect` verdict from `guard adjudicate` (a post-run
 *  adjudication blamed the scenario, so the flow taints and the
 *  same escalate-after-{@link DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER} budget
 *  applies before it becomes a human task). */
export const GuardAutoResolutionSourceSchema = z.enum(['triage', 'fidelity', 'worker', 'adjudicate'])
export type GuardAutoResolutionSource = z.infer<typeof GuardAutoResolutionSourceSchema>

/** One tracked flow, how many times its test has auto-resolved without
 *  converging, and what drove the most recent one (the escalation note). */
export const GuardAutoResolutionEntrySchema = z
  .object({
    /** How many generates have auto-resolved this flow's test without converging. */
    count: z.number().int().positive(),
    /** What drove the most recent auto-resolution. */
    source: GuardAutoResolutionSourceSchema,
    /** ISO timestamp of the most recent auto-resolution. */
    updatedAt: z.string(),
  })
  .strict()
export type GuardAutoResolutionEntry = z.infer<typeof GuardAutoResolutionEntrySchema>

/** One tainted flow: why its test was rejected last run, threaded into the next
 *  generate's fresh author call as correction evidence. The identity fields are
 *  stored too so the ledger is self-describing. */
export const GuardFlowTaintSchema = z
  .object({
    flowId: z.string().min(1),
    surface: GuardDriverIdSchema,
    /** The rejected scenario's title, context for the fresh re-author. */
    title: z.string(),
    /** Why it was rejected, the fidelity mismatch, the triage brief, or the
     *  setup-defect failure message. */
    mismatch: z.string(),
    /** ISO timestamp of the most recent taint. */
    updatedAt: z.string(),
  })
  .strict()
export type GuardFlowTaint = z.infer<typeof GuardFlowTaintSchema>

/** The whole ledger. Both records default to `{}` so a partial file parses. */
export const GuardAutoResolutionsSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string(), GuardAutoResolutionEntrySchema).default({}),
    tainted: z.record(z.string(), GuardFlowTaintSchema).default({}),
  })
  .strict()
export type GuardAutoResolutions = z.infer<typeof GuardAutoResolutionsSchema>

/** An empty, valid ledger, a module-level SHARED constant, deep-frozen so a
 *  caller that mutates it throws instead of silently leaking state across
 *  repos. Readers that hand a ledger to mutating callers must build a fresh
 *  object instead (see `readGuardAutoResolutions`). */
export const EMPTY_GUARD_AUTO_RESOLUTIONS: GuardAutoResolutions = Object.freeze({
  version: 1,
  entries: Object.freeze({}),
  tainted: Object.freeze({}),
})

/**
 * The ledger key, the flow×surface identity both records share. Deliberately the
 * same `\0`-joined shape the generator's per-(flow, surface) `ref` uses, so the
 * settle flow and the ledger can never disagree about what one unit is.
 */
export function autoResolutionKey(flowId: string, surface: string): string {
  return `${flowId}\0${surface}`
}

/** The default number of times a flow's test may auto-resolve before it escalates
 *  to a human task ("re-generation is not fixing this"). */
export const DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER = 2
