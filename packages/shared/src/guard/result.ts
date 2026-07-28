/**
 * Guard run result types — the materialized current state a `guard run` writes to
 * `.truecourse/guard/LATEST.json` and the dashboard / `guard status` read back.
 *
 * LATEST is committable (LATEST.json convention) and travels via git, so a clone
 * renders section coverage without a local run. Because `evidence/` is gitignored,
 * failure detail is kept **inline-compact** here (`{ step, expected, actual }`) with
 * only a pointer into `evidence/`; the full transcript lives where the run happened.
 */

import { z } from 'zod'
import { OutputExcerptsSchema } from './excerpts.js'
import { GUARD_FORMAT_VERSION, GuardBindsSchema } from './scenario.js'

/**
 * Per-scenario run outcome. `pass` | `fail` | `error` come from executing the
 * scenario; `stale` (the bound section's text was edited since the scenario was
 * written) and `orphaned` (the bound section no longer exists) come from the
 * binding check the runner performs against the live section index before it
 * executes anything — a stale/orphaned scenario is never run.
 */
export const GuardOutcomeSchema = z.enum(['pass', 'fail', 'stale', 'orphaned', 'error'])
export type GuardOutcome = z.infer<typeof GuardOutcomeSchema>

/**
 * WHERE a scenario's recorded outcome came from. Guard commits every authored
 * test, so a test can carry a result from either stage:
 *  - `birth` — the execution `guard generate` ran the moment it authored the
 *    scenario. A `fail` here means the committed test and the code already
 *    disagree; the test is a decision surface, not withheld work.
 *  - `run` — an ordinary `guard run` over the committed corpus.
 * Absent on a persisted result reads as `run` (see {@link guardResultStage}) —
 * every result written before birth results existed came from a run.
 */
export const GuardResultStageSchema = z.enum(['birth', 'run'])
export type GuardResultStage = z.infer<typeof GuardResultStageSchema>

/** A committed test's last known status — the manifest's inventory field, and what
 *  a read falls back to when the current run has no outcome for the scenario. */
export const GuardTestStatusSchema = z.enum(['passing', 'failing'])
export type GuardTestStatus = z.infer<typeof GuardTestStatusSchema>

/** Run envelope — provenance for the whole run. */
export const GuardRunEnvelopeSchema = z
  .object({
    runId: z.string(),
    ranAt: z.string(),
    branch: z.string().nullable(),
    commit: z.string().nullable(),
    /** Recipe inputs fingerprint (`sha256:…`) at run time. */
    recipeFingerprint: z.string(),
    /**
     * Identity of the scenario corpus this run executed (`sha256:…` over the
     * scenario ids + bindings — see the hosted gate's `guardCorpusFingerprint`).
     * Stamped by the gate when it persists a PR-head run so a stored run only
     * decides a later delivery when the corpus the gate would run still matches
     * (a force spec-regen run executes the PR's OWN regenerated corpus, whose
     * ids don't align with the committed set). Optional so CLI runs and
     * pre-change snapshots keep parsing. NO format-version bump.
     */
    corpusFingerprint: z.string().optional(),
    scenarioFormat: z.literal(GUARD_FORMAT_VERSION),
  })
  .strict()
export type GuardRunEnvelope = z.infer<typeof GuardRunEnvelopeSchema>

export const GuardSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    orphaned: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  })
  .strict()
export type GuardSummary = z.infer<typeof GuardSummarySchema>

/** Inline-compact failure detail — enough to render a red section from a clone. */
export const GuardFailureDetailSchema = z
  .object({
    /** 1-based index of the first failing step. */
    step: z.number().int().positive(),
    expected: z.string(),
    actual: z.string(),
    /**
     * The failing step's RAW program output (see {@link OutputExcerptsSchema}),
     * attached on EVERY expect-mismatch so the retry/finding sees the usage error
     * the program actually printed. Optional so pre-change snapshots keep parsing,
     * and infra failures (spawn/timeout — no real capture) simply carry neither.
     * NO format-version bump.
     */
    ...OutputExcerptsSchema.shape,
  })
  .strict()
export type GuardFailureDetail = z.infer<typeof GuardFailureDetailSchema>

export const GuardScenarioResultSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /**
     * The scenario's PRIMARY binding (`binds[0]` of the scenario file). A scenario
     * may bind several sections — one per flow milestone — but the run result keys
     * on the primary one; the full set is the flow's, and the per-section rollup
     * credits every bound section (see `sections`).
     */
    binds: GuardBindsSchema,
    outcome: GuardOutcomeSchema,
    /**
     * The stage that produced `outcome` (see {@link GuardResultStageSchema}).
     * Optional so every pre-existing snapshot parses; absent reads as `run`
     * through {@link guardResultStage}. NO format-version bump.
     */
    stage: GuardResultStageSchema.optional(),
    durationMs: z.number().nonnegative(),
    /** Present on `fail` / `error`. */
    failure: GuardFailureDetailSchema.optional(),
    /**
     * Repo-relative pointer into `evidence/`; present on every EXECUTED outcome —
     * `pass` (the run transcript proving what ran) as well as `fail` / `error`.
     * Absent on non-executed `stale` / `orphaned`, and on pre-2026-07-08 runs whose
     * passes were never given a bundle (optional keeps those parsing + rendering).
     */
    evidencePath: z.string().optional(),
    /**
     * Number of boot attempts the api driver made for this scenario — present (=2)
     * only when a transient first boot failed and was retried once (see the api-boot
     * resilience item). Omitted for the common single-boot case and for cli scenarios,
     * so a retry is never silent yet the field adds no noise to normal results.
     * Optional so pre-change snapshots keep parsing. NO format-version bump.
     */
    bootAttempts: z.number().int().positive().optional(),
    /**
     * Present when the PRIMARY bound section moved: the section kept its text but
     * now lives under a different anchor. The scenario still executed; this records
     * where its section was found so the binding can be re-anchored.
     */
    remappedTo: z.string().optional(),
    /**
     * Present on `stale` when a bound section was EDITED: that section's current
     * fingerprint (the first stale bind's), so the UI and regeneration can see what
     * the binding drifted to without a re-scan. A `stale` caused only by a REMOVED
     * bound section carries none — there is no current text to fingerprint.
     */
    currentFingerprint: z.string().optional(),
    /**
     * The flow this scenario realizes (`flow.id` in the scenario file) — the key
     * the flow-first rollups group by. Absent on a hand-written scenario, which
     * belongs to no flow, and on runs recorded before flows existed.
     */
    flowId: z.string().optional(),
    /**
     * The flow milestone the FAILING step was annotated with (`milestone` on the
     * step). Present only on a `fail`/`error` whose failing step carries one, so a
     * run renders as a flow instance: milestones before it passed, this one broke,
     * later ones were never reached. Absent when the failure happened before any
     * step ran (setup, boot) or the step is plumbing with no milestone.
     */
    failedMilestone: z.number().int().positive().optional(),
    /**
     * Journey-drift ANNOTATION (always `true` when present): the live journey
     * catalog no longer matches the fingerprints this scenario was grounded on —
     * the code surface it was derived from moved. Never an outcome and never a
     * pass/fail input: the steps are frozen and remain a valid probe of the spec
     * claims; it only suggests re-generating. Absent when the scenario carries no
     * journey refs, when no catalog snapshot exists, or when nothing drifted.
     */
    journeyDrifted: z.boolean().optional(),
    /**
     * Blocked-precondition ANNOTATION (always `true` when present): the step that
     * failed carries NO milestone — it only prepared the world (a seeding POST, a
     * login) — while the scenario DOES realize milestones elsewhere. The specified
     * behavior was therefore never reached: this is not doc-vs-code drift, it is a
     * prerequisite the spec does not assert. Never an outcome and never a pass/fail
     * input (the scenario still `fail`s, exactly as before — see item 54's locked
     * decision); it only tells a reader where to look. Absent when the failing step
     * realizes a milestone, when the scenario declares no milestones at all (a
     * hand-written test asserts through plumbing steps — an unmilestoned failure
     * there IS its verdict), and on every non-`fail` outcome.
     */
    blockedPrecondition: z.boolean().optional(),
  })
  .strict()
export type GuardScenarioResult = z.infer<typeof GuardScenarioResultSchema>

/**
 * The blocked-precondition annotation for a settled FAILURE — see
 * {@link GuardScenarioResultSchema}'s `blockedPrecondition`. Spread into the result
 * by both drivers so the rule lives in ONE place: the failing step (1-based, the
 * only one that matters — execution stops there) carries no `milestone`, and some
 * other step of the scenario does.
 */
export function blockedPreconditionAnnotation(
  steps: readonly { milestone?: number }[],
  failingStep: number,
): { blockedPrecondition?: true } {
  const step = steps[failingStep - 1]
  if (!step || step.milestone) return {}
  return steps.some((s) => s.milestone) ? { blockedPrecondition: true } : {}
}

/** Per-section rollup — the unit the coverage UI highlights. */
export const GuardSectionRollupSchema = z
  .object({
    doc: z.string(),
    section: z.string(),
    /** Worst outcome across the section's scenarios. */
    status: GuardOutcomeSchema,
    scenarioIds: z.array(z.string()),
  })
  .strict()
export type GuardSectionRollup = z.infer<typeof GuardSectionRollupSchema>

export const GuardLatestSchema = z
  .object({
    run: GuardRunEnvelopeSchema,
    summary: GuardSummarySchema,
    scenarios: z.array(GuardScenarioResultSchema),
    sections: z.array(GuardSectionRollupSchema),
  })
  .strict()
export type GuardLatest = z.infer<typeof GuardLatestSchema>

/** One summary row in the append-only run history (`guard/history.json`). */
export const GuardHistoryEntrySchema = z
  .object({
    runId: z.string(),
    ranAt: z.string(),
    branch: z.string().nullable(),
    commit: z.string().nullable(),
    summary: GuardSummarySchema,
  })
  .strict()
export type GuardHistoryEntry = z.infer<typeof GuardHistoryEntrySchema>

export const GuardHistorySchema = z
  .object({ runs: z.array(GuardHistoryEntrySchema) })
  .strict()
export type GuardHistory = z.infer<typeof GuardHistorySchema>

/**
 * Section status precedence — the worst scenario outcome wins. A section is green
 * only when every scenario passed; a single failure paints it red.
 */
const OUTCOME_PRECEDENCE: readonly GuardOutcome[] = [
  'fail',
  'error',
  'stale',
  'orphaned',
  'pass',
]

/** The stage a recorded result came from — absent reads as `run` (every result
 *  written before birth results existed was one). */
export function guardResultStage(result: { stage?: GuardResultStage }): GuardResultStage {
  return result.stage ?? 'run'
}

export function worstOutcome(outcomes: readonly GuardOutcome[]): GuardOutcome {
  for (const candidate of OUTCOME_PRECEDENCE) {
    if (outcomes.includes(candidate)) return candidate
  }
  return 'pass'
}
