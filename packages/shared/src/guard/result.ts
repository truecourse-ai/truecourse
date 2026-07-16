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
    binds: GuardBindsSchema,
    /**
     * The scenario's extracted claim (the doc's promise it defends), carried from
     * the committed YAML so `guard drifts` can frame a failure as doc-vs-code.
     * Optional: pre-claim scenarios and pre-change run snapshots keep parsing.
     */
    claim: z.string().optional(),
    outcome: GuardOutcomeSchema,
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
     * Present when the bound section moved: the section kept its text but now
     * lives under a different anchor. The scenario still executed; this records
     * where its section was found so the binding can be re-anchored.
     */
    remappedTo: z.string().optional(),
    /**
     * Present on `stale`: the section's current (edited) fingerprint, so the UI
     * and regeneration can see what the binding drifted to without a re-scan.
     */
    currentFingerprint: z.string().optional(),
  })
  .strict()
export type GuardScenarioResult = z.infer<typeof GuardScenarioResultSchema>

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

export function worstOutcome(outcomes: readonly GuardOutcome[]): GuardOutcome {
  for (const candidate of OUTCOME_PRECEDENCE) {
    if (outcomes.includes(candidate)) return candidate
  }
  return 'pass'
}
