/**
 * Guard run result types, the materialized current state a `guard run` writes to
 * `.truecourse/guard/LATEST.json` and the dashboard / `guard status` read back.
 *
 * LATEST is committable (LATEST.json convention) and travels via git, so a clone
 * renders section coverage without a local run. Because `evidence/` is gitignored,
 * failure detail is kept **inline-compact** here (`{ step, expected, actual }`) with
 * only a pointer into `evidence/`; the full transcript lives where the run happened.
 */

import { z } from 'zod'
import { GuardScenarioAdjudicationSchema } from './adjudication'
import { OutputExcerptsSchema } from './excerpts'
import { GuardVisualAnnotationSchema } from './visual'
import { GuardDependencyNeedSchema } from './dependencies'
import { GuardBindsSchema } from './scenario'
import { hasMilestone, type GuardStepMilestone } from './step-parts'

/**
 * Per-scenario run outcome. `pass` | `fail` | `error` come from executing the
 * scenario; `stale` (the bound section's text was edited since the scenario was
 * written) and `orphaned` (the bound section no longer exists) come from the
 * binding check the runner performs against the live section index before it
 * executes anything, a stale/orphaned scenario is never run.
 *
 * `blocked` is the sixth and likewise NON-EXECUTED state: the scenario binds a
 * SUPPLIED dependency (the dependency catalog) for which no instance is
 * registered on this machine. Nothing about the repo is in dispute, so it must
 * never read as `fail`, the run makes no network call, spawns no child, and
 * settles with the dependency and its rolled-up requirement named, which is the
 * one action that clears it (see {@link GuardScenarioResultSchema.blockedOn}).
 */
export const GuardOutcomeSchema = z.enum([
  'pass',
  'fail',
  'stale',
  'orphaned',
  'error',
  'blocked',
])
export type GuardOutcome = z.infer<typeof GuardOutcomeSchema>

/**
 * WHERE a scenario's recorded outcome came from. Guard commits every authored
 * test, so a test can carry a result from either stage:
 *  - `birth`, the execution `guard generate` ran the moment it authored the
 *    scenario. A `fail` here means the committed test and the code already
 *    disagree; the test is a decision surface, not withheld work.
 *  - `run`, an ordinary `guard run` over the committed corpus.
 * Absent on a persisted result reads as `run` (see {@link guardResultStage}) -
 * every result written before birth results existed came from a run.
 */
export const GuardResultStageSchema = z.enum(['birth', 'run'])
export type GuardResultStage = z.infer<typeof GuardResultStageSchema>

/**
 * A committed test's last known status, the manifest's inventory field, and what
 * a read falls back to when the current run has no outcome for the scenario.
 *
 * `never-run` is the third, honest state: the test was COMMITTED WITHOUT AN
 * EXECUTION. `guard generate` never writes it (it executes every scenario it
 * authors, so its tests are `passing` or `failing`), but a hand-authored corpus
 * has no birth execution behind it, and calling that green would be a green
 * nothing ever earned. It paints as "never run", never as passing.
 */
export const GuardTestStatusSchema = z.enum(['passing', 'failing', 'never-run'])
export type GuardTestStatus = z.infer<typeof GuardTestStatusSchema>

/** Drop the retired `scenarioFormat` marker (pre-2026-08-13 writers stamp it)
 *  before the strict body sees it, so mixed-version stores keep loading. */
function dropLegacyScenarioFormat(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!('scenarioFormat' in value)) return value
  const { scenarioFormat: _legacy, ...rest } = value as Record<string, unknown>
  return rest
}

/** Run envelope, provenance for the whole run. */
export const GuardRunEnvelopeSchema = z.preprocess(
  dropLegacyScenarioFormat,
  z
    .object({
    runId: z.string(),
    ranAt: z.string(),
    branch: z.string().nullable(),
    commit: z.string().nullable(),
    /** Recipe inputs fingerprint (`sha256:…`) at run time. */
    recipeFingerprint: z.string(),
    /**
     * Identity of the scenario corpus this run executed (`sha256:…` over the
     * scenario ids + bindings, see the hosted gate's `guardCorpusFingerprint`).
     * Stamped by the gate when it persists a PR-head run so a stored run only
     * decides a later delivery when the corpus the gate would run still matches
     * (a force spec-regen run executes the PR's OWN regenerated corpus, whose
     * ids don't align with the committed set). Optional so CLI runs and
     * pre-change snapshots keep parsing.
     */
      corpusFingerprint: z.string().optional(),
      /** The pull request this run gated, absent for a run on the default branch. */
      pullRequest: z.number().int().positive().optional(),
      /** Where the run executed: the hosted runner, or a developer's machine through the CLI. */
      origin: z.enum(['hosted', 'local']).optional(),
      /** The coverage version (corpus + scenarios) the run executed, the Coverage tab's picker id. */
      coverageVersion: z.string().optional(),
    })
    .strict(),
)
export type GuardRunEnvelope = z.infer<typeof GuardRunEnvelopeSchema>

export const GuardSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    orphaned: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    /**
     * Scenarios held back on an unregistered supplied dependency. Defaulted rather
     * than required so every snapshot written before the dependency catalog existed
     * still parses (it had none by construction).
     */
    blocked: z.number().int().nonnegative().default(0),
  })
  .strict()
export type GuardSummary = z.infer<typeof GuardSummarySchema>

/** Inline-compact failure detail, enough to render a red section from a clone. */
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
     * and infra failures (spawn/timeout, no real capture) simply carry neither.
     *.
     */
    ...OutputExcerptsSchema.shape,
    /**
     * The VISUAL JUDGE's annotation, present only on a failing WEB step whose
     * screenshot a vision model was asked to read (see {@link
     * GuardVisualAnnotationSchema}). Advisory: it never moved this outcome, the
     * deterministic expectation in `expected`/`actual` did. Kept to a verdict plus
     * a capped one-liner because LATEST is inline-compact; the full rationale is
     * in the evidence transcript. Optional so pre-change snapshots keep parsing.
     *.
     */
    visual: GuardVisualAnnotationSchema.optional(),
  })
  .strict()
export type GuardFailureDetail = z.infer<typeof GuardFailureDetailSchema>

/**
 * The unregistered supplied dependency that held a scenario back, with the
 * requirement an instance must satisfy, rolled up from the flows that contributed
 * it, each need attributed to its flow so a reader sees WHY every expectation is
 * there and a dismissed flow's expectation visibly disappears.
 */
export const GuardBlockedDependencySchema = z
  .object({
    /** Catalog entry name (`analysis-target`). */
    dependency: z.string().min(1),
    /** The rolled-up requirement, one line. */
    requirement: z.string().min(1),
    /** The surviving per-flow needs behind that line. */
    needs: z.array(GuardDependencyNeedSchema).default([]),
    /** Where an instance is registered, the one action that clears this. */
    registerIn: z.string().min(1),
  })
  .strict()
export type GuardBlockedDependency = z.infer<typeof GuardBlockedDependencySchema>

export const GuardScenarioResultSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /**
     * The scenario's PRIMARY binding (`binds[0]` of the scenario file). A scenario
     * may bind several sections, one per flow milestone, but the run result keys
     * on the primary one; the full set is the flow's, and the per-section rollup
     * credits every bound section (see `sections`).
     */
    binds: GuardBindsSchema,
    outcome: GuardOutcomeSchema,
    /**
     * The stage that produced `outcome` (see {@link GuardResultStageSchema}).
     * Optional so every pre-existing snapshot parses; absent reads as `run`
     * through {@link guardResultStage}.
     */
    stage: GuardResultStageSchema.optional(),
    /**
     * WHICH RUN produced this row, the merged board's carrier of per-scenario run
     * identity. A board (`LATEST.json`) is assembled from whatever mix of full and
     * scoped runs happened, so the `run` envelope names only the run that touched it
     * LAST; a row carried over from an earlier run records that run's id and
     * timestamp here, and its `evidencePath` points into that run's evidence dir.
     *
     * Written ONLY on a carried row: a row the envelope's own run produced leaves
     * both absent, which reads as the envelope through {@link guardResultRunId} /
     * {@link guardResultRanAt}. Every result written before boards merged is
     * therefore already correct (its run IS the envelope's). Optional, additive -
     *.
     */
    runId: z.string().optional(),
    ranAt: z.string().optional(),
    durationMs: z.number().nonnegative(),
    /** Present on `fail` / `error`. */
    failure: GuardFailureDetailSchema.optional(),
    /**
     * Repo-relative pointer into `evidence/`; present on every EXECUTED outcome -
     * `pass` (the run transcript proving what ran) as well as `fail` / `error`.
     * Absent on non-executed `stale` / `orphaned`, and on pre-2026-07-08 runs whose
     * passes were never given a bundle (optional keeps those parsing + rendering).
     */
    evidencePath: z.string().optional(),
    /**
     * Number of boot attempts the api driver made for this scenario, present (=2)
     * only when a transient first boot failed and was retried once (see the api-boot
     * resilience item). Omitted for the common single-boot case and for cli scenarios,
     * so a retry is never silent yet the field adds no noise to normal results.
     * Optional so pre-change snapshots keep parsing.
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
     * bound section carries none, there is no current text to fingerprint.
     */
    currentFingerprint: z.string().optional(),
    /**
     * The flow this scenario realizes (`flow.id` in the scenario file), the key
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
     * Interface-drift ANNOTATION (always `true` when present): the live interface
     * catalog no longer matches the fingerprints this scenario was grounded on -
     * the code surface it was derived from moved. Never an outcome and never a
     * pass/fail input: the steps are frozen and remain a valid probe of the spec
     * claims; it only suggests re-generating. Absent when the scenario carries no
     * interface refs, when no catalog snapshot exists, or when nothing drifted.
     */
    interfaceDrifted: z.boolean().optional(),
    /**
     * Blocked-precondition ANNOTATION (always `true` when present): the step that
     * failed carries NO milestone, it only prepared the world (a seeding POST, a
     * login), while the scenario DOES realize milestones elsewhere. The specified
     * behavior was therefore never reached: this is not doc-vs-code drift, it is a
     * prerequisite the spec does not assert. Never an outcome and never a pass/fail
     * input (the scenario still `fail`s, exactly as before); it only tells a reader
     * where to look. Absent when the failing step
     * realizes a milestone, when the scenario declares no milestones at all (a
     * hand-written test asserts through plumbing steps, an unmilestoned failure
     * there IS its verdict), and on every non-`fail` outcome.
     */
    blockedPrecondition: z.boolean().optional(),
    /**
     * Unserved-route ANNOTATION (always `true` when present): the step's
     * request 404ed on a path the route manifest attributes to a DIFFERENT workspace
     * app than the one this scenario's server serves, and the step did not itself
     * expect a 404. Nothing about the spec or the code is in dispute: the recipe
     * declares no server for the service that owns the path, so the outcome is
     * `error` (infrastructure), never `fail`. Generate reads it back and settles the
     * flow as the same `blocked-on` gap its own route gate emits, so the fix stays
     * one recipe edit instead of a scenario that re-authors forever.
     */
    unservedRoute: z.boolean().optional(),
    /**
     * Why a `blocked` scenario never ran: the supplied dependency it binds that has
     * no registered instance, and that dependency's requirement rolled up from the
     * flows that contributed it. Present on `blocked` and only there, it is the
     * actionable half of the outcome, so a surface renders it instead of a step
     * failure (nothing executed, so there is no failing step to point at).
     */
    blockedOn: GuardBlockedDependencySchema.optional(),
    /**
     * The ADJUDICATION VERDICT this failure carries (`truecourse guard
     * adjudicate`), written AFTER the run by the adjudication
     * fold, never by the runner. The board merge carries it with an untouched
     * row and DROPS it from a re-run one (a new actual needs a new verdict -
     * see `mergeGuardBoard`). Present only on `fail` / `error` rows that were
     * adjudicated; optional so every pre-existing snapshot parses.
     */
    adjudication: GuardScenarioAdjudicationSchema.optional(),
    /**
     * Teardown-incomplete ANNOTATION (always `true` when present): after this
     * scenario settled, one of its BEST-EFFORT teardown steps (run because an
     * earlier step had already failed or errored) did not meet its expectation or
     * could not run, host state the scenario promised to restore may remain (a
     * user-level service still installed, a supervisor entry left behind). Never an
     * outcome and never a pass/fail input: the settled verdict stands, and the
     * evidence transcript carries each teardown step's own record. Absent on every
     * green run (there a teardown step is an ordinary, verdict-affecting step) and
     * whenever every best-effort teardown step succeeded.
     */
    teardownIncomplete: z.boolean().optional(),
  })
  .strict()
export type GuardScenarioResult = z.infer<typeof GuardScenarioResultSchema>

/**
 * The blocked-precondition annotation for a settled FAILURE, see
 * {@link GuardScenarioResultSchema}'s `blockedPrecondition`. Spread into the result
 * by both drivers so the rule lives in ONE place: the failing step (1-based, the
 * only one that matters, execution stops there) carries no `milestone`, and some
 * other step of the scenario does.
 */
export function blockedPreconditionAnnotation(
  steps: readonly { milestone?: GuardStepMilestone }[],
  failingStep: number,
): { blockedPrecondition?: true } {
  const step = steps[failingStep - 1]
  if (!step || hasMilestone(step.milestone)) return {}
  return steps.some((s) => hasMilestone(s.milestone)) ? { blockedPrecondition: true } : {}
}

/** Per-section rollup, the unit the coverage UI highlights. */
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
    pullRequest: z.number().int().positive().optional(),
    origin: z.enum(['hosted', 'local']).optional(),
    coverageVersion: z.string().optional(),
  })
  .strict()
export type GuardHistoryEntry = z.infer<typeof GuardHistoryEntrySchema>

export const GuardHistorySchema = z
  .object({ runs: z.array(GuardHistoryEntrySchema) })
  .strict()
export type GuardHistory = z.infer<typeof GuardHistorySchema>

/**
 * Section status precedence, the worst scenario outcome wins. A section is green
 * only when every scenario passed; a single failure paints it red.
 */
const OUTCOME_PRECEDENCE: readonly GuardOutcome[] = [
  'fail',
  'error',
  'stale',
  'orphaned',
  // Blocked outranks pass for the same reason stale does: a section whose other
  // scenario never ran is not proven, and hiding that behind a green sibling would
  // report coverage nobody earned.
  'blocked',
  'pass',
]

/** The stage a recorded result came from, absent reads as `run` (every result
 *  written before birth results existed was one). */
export function guardResultStage(result: { stage?: GuardResultStage }): GuardResultStage {
  return result.stage ?? 'run'
}

/**
 * The run that produced a recorded result: the row's own `runId` when it was carried
 * into the board from an earlier run, else the envelope's, which is what every row
 * the envelope's run produced (and every result written before boards merged) leaves
 * absent. Address a row's evidence through THIS, never through the envelope alone.
 */
export function guardResultRunId(
  result: { runId?: string },
  envelope: { runId: string },
): string {
  return result.runId ?? envelope.runId
}

/** When a recorded result last ran, the row's own timestamp, else the envelope's.
 *  Same rule as {@link guardResultRunId}. */
export function guardResultRanAt(
  result: { ranAt?: string },
  envelope: { ranAt: string },
): string {
  return result.ranAt ?? envelope.ranAt
}

export function worstOutcome(outcomes: readonly GuardOutcome[]): GuardOutcome {
  for (const candidate of OUTCOME_PRECEDENCE) {
    if (outcomes.includes(candidate)) return candidate
  }
  return 'pass'
}
