/**
 * The durable across-run guard ledger — `guard/auto-resolutions.json`, two
 * records in one gitignored file, both keyed by the FLOW×SURFACE identity
 * ({@link autoResolutionKey}) because the flow is the generation unit:
 *
 *  - `entries` — the escalation guard's memory. `guard generate` auto-resolves a
 *    HIGH-confidence "the test is wrong" verdict without a human task (a
 *    generation-defect triage retires the failure; a fidelity flag discards and
 *    re-authors the scenario once); this counts how many times each flow's test
 *    has auto-resolved across generates. At the escalation threshold the flow
 *    RETIRES instead of auto-resolving again — no auto behavior can become an
 *    infinite silent loop. A flow that converges (commits a passing test) clears
 *    its count.
 *  - `retired` — the flows authoring has GIVEN UP on: the ledger count exhausted
 *    its budget, so the flow's surface settles as a quiet `retired` coverage gap
 *    ("no test — authoring retired after N defective attempts") and no later
 *    generate spends a call on it. Never a human-task state. Exactly three
 *    resets clear a retirement (and its ledger count): the flow's bound spec
 *    content moves (`sectionsKey`), the surface's authoring prompt moves
 *    (`promptFingerprint` — the engine improved), or the user re-enables it in
 *    `scenarios/decisions.json` (`reenabledFlows`). Deleting this file resets
 *    too, like every other ledger record.
 *  - `tainted` — the flow-taint set. A flow whose test ended a run rejected (a
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
import { GuardDriverIdSchema } from './drivers.js'

/** What drove an auto-resolution: a HIGH-confidence fidelity flag (the in-loop
 *  heal discard), an exhausted authoring worker session (`author` — the session
 *  ran out of turns/tokens or ended malformed without settling), or a legacy
 *  `triage` verdict from ledgers written by the pre-worker pipeline. */
export const GuardAutoResolutionSourceSchema = z.enum(['triage', 'fidelity', 'author'])
export type GuardAutoResolutionSource = z.infer<typeof GuardAutoResolutionSourceSchema>

/** One counted defective attempt — the verdict behind a ledger bump, kept so a
 *  retirement can show WHAT was judged wrong each time, not just how often. */
export const GuardAutoResolvedAttemptSchema = z
  .object({
    source: GuardAutoResolutionSourceSchema,
    /** The rejected scenario's title. */
    title: z.string(),
    /** The verdict text — the fidelity mismatch or the triage brief. */
    detail: z.string(),
    /** ISO timestamp of the attempt. */
    at: z.string(),
  })
  .strict()
export type GuardAutoResolvedAttempt = z.infer<typeof GuardAutoResolvedAttemptSchema>

/** One tracked flow — how many times its test has auto-resolved without
 *  converging, and what drove the most recent one (the escalation note). */
export const GuardAutoResolutionEntrySchema = z
  .object({
    /** How many generates have auto-resolved this flow's test without converging. */
    count: z.number().int().positive(),
    /** What drove the most recent auto-resolution. */
    source: GuardAutoResolutionSourceSchema,
    /** ISO timestamp of the most recent auto-resolution. */
    updatedAt: z.string(),
    /** The verdicts behind each count, oldest first. Optional so ledgers written
     *  before retirement existed keep parsing (their history starts empty). */
    attempts: z.array(GuardAutoResolvedAttemptSchema).optional(),
  })
  .strict()
export type GuardAutoResolutionEntry = z.infer<typeof GuardAutoResolutionEntrySchema>

/**
 * One RETIRED flow×surface — authoring gave up after the ledger budget exhausted.
 * The record is both the durable skip (no later generate authors, matches, or
 * spends against this surface) and the reset anchor: each reset condition
 * compares against what is stored here.
 */
export const GuardFlowRetirementSchema = z
  .object({
    flowId: z.string().min(1),
    surface: GuardDriverIdSchema,
    /** The last rejected scenario's title — display context. */
    title: z.string(),
    /** The flow's primary binding — where coverage surfaces attribute the gap. */
    doc: z.string(),
    anchor: z.string(),
    /** Total defective attempts, the retiring one included. */
    attempts: z.number().int().positive(),
    /** The retired attempts' verdicts, oldest first — what the flow detail shows. */
    history: z.array(GuardAutoResolvedAttemptSchema).default([]),
    /** ISO timestamp of the retirement. */
    retiredAt: z.string(),
    /** Hash of the flow's bound-section content keys at retirement — reset (a):
     *  the spec moved, so the flow earns a fresh attempt. */
    sectionsKey: z.string(),
    /** The surface's authoring-prompt fingerprint at retirement — reset (c):
     *  the authoring engine improved, so the flow earns a fresh attempt. */
    promptFingerprint: z.string(),
  })
  .strict()
export type GuardFlowRetirement = z.infer<typeof GuardFlowRetirementSchema>

/** One tainted flow: why its test was rejected last run, threaded into the next
 *  generate's fresh author call as correction evidence. The identity fields are
 *  stored too so the ledger is self-describing. */
export const GuardFlowTaintSchema = z
  .object({
    flowId: z.string().min(1),
    surface: GuardDriverIdSchema,
    /** The rejected scenario's title — context for the fresh re-author. */
    title: z.string(),
    /** Why it was rejected — the fidelity mismatch, the triage brief, or the
     *  setup-defect failure message. */
    mismatch: z.string(),
    /** ISO timestamp of the most recent taint. */
    updatedAt: z.string(),
  })
  .strict()
export type GuardFlowTaint = z.infer<typeof GuardFlowTaintSchema>

/** The whole ledger. Every record defaults to `{}` so a partial file parses. */
export const GuardAutoResolutionsSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(z.string(), GuardAutoResolutionEntrySchema).default({}),
    tainted: z.record(z.string(), GuardFlowTaintSchema).default({}),
    retired: z.record(z.string(), GuardFlowRetirementSchema).default({}),
  })
  .strict()
export type GuardAutoResolutions = z.infer<typeof GuardAutoResolutionsSchema>

/** An empty, valid ledger — the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_AUTO_RESOLUTIONS: GuardAutoResolutions = {
  version: 1,
  entries: {},
  tainted: {},
  retired: {},
}

/**
 * The ledger key — the flow×surface identity both records share. Deliberately the
 * same `\0`-joined shape the generator's per-(flow, surface) `ref` uses, so the
 * settle flow and the ledger can never disagree about what one unit is.
 */
export function autoResolutionKey(flowId: string, surface: string): string {
  return `${flowId}\0${surface}`
}

/** The default number of times a flow's test may auto-resolve before it escalates
 *  to a human task ("re-generation is not fixing this"). */
export const DEFAULT_AUTO_RESOLVE_ESCALATE_AFTER = 2
