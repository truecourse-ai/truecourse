/**
 * The persisted last-generate report — written to `.truecourse/guard/result.json`
 * at the end of every `guard generate` (the `contracts/result.json` convention).
 *
 * It is the generator's `GuardGenerateResult` plus a `generatedAt` timestamp and
 * the run's optional LLM `usage` totals, so `guard status` (CLI) and the dashboard
 * coverage view render the same summary from the same store file. Gitignored
 * (transient run output); the committed `scenarios/` tree it describes is durable.
 */

import { z } from 'zod'
import {
  GuardDriverIdSchema,
  awaitingDriverIds,
  isAwaitingDriver,
  type GuardAwaitingDriverId,
} from './drivers.js'
import { OutputExcerptsSchema } from './excerpts.js'
import { GuardTestStatusSchema } from './result.js'

/** One written scenario in the report (a generated `.yaml` and its binding). */
export const GuardWrittenScenarioSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** The scenario's PRIMARY binding — its flow's first milestone's section. */
    doc: z.string(),
    anchor: z.string(),
    /** Repo-relative path of the written `.yaml`. */
    file: z.string(),
    /** The flow this scenario realizes (absent on hand-written work). */
    flowId: z.string().optional(),
    /** The surface it runs on — one scenario per (flow, surface). */
    surface: GuardDriverIdSchema.optional(),
    /**
     * The test's status at birth: `passing` (it agrees with current code) or
     * `failing` (it does not — committed anyway, with its birth result recorded in
     * `birthFindings`). Optional so reports written before guard committed failing
     * tests parse; absent reads as `passing`.
     */
    status: GuardTestStatusSchema.optional(),
  })
  .strict()
export type GuardWrittenScenario = z.infer<typeof GuardWrittenScenarioSchema>

/**
 * Why a spec claim or a flow surface has no guard, UN-CONFLATED so a postponement
 * never reads as a verdict: `awaiting-driver` (the surface needs a driver that
 * isn't runnable yet — which one is the `driver` field, not the kind),
 * `untestable`/`no-claim` (nothing a runnable driver can assert), `blocked-on`
 * (needs world-state no `setup` block can express — a running service, database,
 * network, credentials), `dismissed` (the user judged the claim/flow
 * noise/won't-fix in `scenarios/decisions.json`, so generate settles it explicitly
 * instead of silently disappearing it), or the two REALIZATION kinds a flow's
 * surface can end in:
 *  - `no-journey` — the surface's journey catalog is EMPTY: nothing was mapped
 *    that could serve the flow. Usually "the mapper can't see your code" (an
 *    extraction gap), and must never read as "your product lacks the feature".
 *  - `unrealizable` — the catalog is healthy, matching examined it, and no journey
 *    path serves the flow's milestones: the real "the spec claims this; no code
 *    surface offers it" signal.
 * Both stay GAPS (never findings) while matcher precision is unmeasured — a bogus
 * finding is the worst failure mode. Every kind but `awaiting-driver` carries no
 * driver, so the refine below holds.
 *
 * A single `awaiting-driver` kind (+ a `driver` discriminator) replaces the old
 * flat `api`/`web`/`tui` kinds: one code path handles every future driver, and a
 * new driver never grows this enum.
 */
export const GuardCoverageGapKindSchema = z.enum([
  'awaiting-driver',
  'untestable',
  'no-claim',
  'blocked-on',
  'dismissed',
  'no-journey',
  'unrealizable',
])
export type GuardCoverageGapKind = z.infer<typeof GuardCoverageGapKindSchema>

/**
 * Migrate an OLD-shape gap row (`kind:'api'|'web'|'tui'`) to the un-conflated
 * shape (`kind:'awaiting-driver', driver:'api'`). Applied at the schema layer so
 * EVERY reader of a persisted report — the store `readGuardResult`, the routes,
 * the CLI — tolerates the historical `guard/result.json` files (which cost real
 * money to produce) without a per-reader shim. New-shape rows pass through.
 */
export const GuardCoverageGapSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    kind: GuardCoverageGapKindSchema,
    reason: z.string(),
    /** Present iff `kind === 'awaiting-driver'` — the non-runnable driver awaited. */
    driver: GuardDriverIdSchema.optional(),
    /**
     * The FLOW the gap belongs to, when it is a flow-level gap (`no-journey`,
     * `unrealizable`, `awaiting-driver` on a mapped-but-unrunnable surface, a
     * dismissed flow). `doc`/`anchor` then name the flow's PRIMARY binding (its
     * first milestone's section) so every gap still pivots on a section. Absent
     * for claim-level gaps (untestable / no-claim / dismissed claim / blocked-on).
     */
    flowId: z.string().optional(),
    /** The surface a flow-level gap happened on — the driver a scenario would run on. */
    surface: GuardDriverIdSchema.optional(),
  })
  .strict()
  .refine((g) => (g.kind === 'awaiting-driver') === (g.driver !== undefined), {
    message: 'awaiting-driver gaps carry a driver; other kinds carry none',
  })

export type GuardCoverageGap = z.infer<typeof GuardCoverageGapSchema>

/**
 * The flat rendering key a gap paints under: a per-driver id for an
 * `awaiting-driver` gap (so "Needs API driver" and "Needs web driver" stay
 * separate chips/counts), else the gap kind itself. This is the domain the
 * coverage strip, the CLI `guard status` gap line, and the summary tallies key by
 * — the OLD flat kind set, re-derived from the driver registry so it tracks new
 * drivers automatically.
 */
export type GuardGapDisplayKind = GuardAwaitingDriverId | Exclude<GuardCoverageGapKind, 'awaiting-driver'>

/**
 * The gap's display key, or `null` for a malformed `awaiting-driver` gap missing a
 * valid awaiting driver (never produced by the emitter or the legacy migration;
 * the schema refine guarantees a driver — callers skip a `null`).
 */
export function gapDisplayKind(gap: GuardCoverageGap): GuardGapDisplayKind | null {
  if (gap.kind === 'awaiting-driver') {
    return gap.driver && isAwaitingDriver(gap.driver) ? gap.driver : null
  }
  return gap.kind
}

/** The display keys with a zeroed count, in the canonical order the CLI renders
 *  them (awaiting drivers first, then the residual kinds). */
export function emptyGapDisplayTotals(): Record<GuardGapDisplayKind, number> {
  const out = {} as Record<GuardGapDisplayKind, number>
  for (const id of awaitingDriverIds) out[id] = 0
  for (const k of GuardCoverageGapKindSchema.options) {
    if (k !== 'awaiting-driver') out[k] = 0
  }
  return out
}

/**
 * The `blocked-on` gap reason format — the normalized capability nouns the claim
 * needs, then the claim one-liner. The single source of the format so producers
 * (generate) and readers (status aggregation) never drift.
 */
export function composeBlockedOnReason(capabilities: string[], claim: string): string {
  return `blocked on ${capabilities.join(', ')}: ${claim}`
}

/** Recover the capability nouns a `blocked-on` reason named — inverse of {@link composeBlockedOnReason}. */
export function parseBlockedOnCapabilities(reason: string): string[] {
  const m = /^blocked on (.+?): /.exec(reason)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * A test's BIRTH-stage failure result — what the scenario asserted, what the code
 * actually did, and the evidence. Guard commits every authored test, so this is
 * normally the recorded result of a COMMITTED failing test (`committed: true`,
 * `scenarioId` + `file` naming it), not withheld work; only a `fidelity` rejection
 * describes a scenario that was never written.
 */
export const GuardBirthFindingSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    /**
     * What kind of result this is:
     *  - `birth` (default when absent) — the test failed its birth execution: the
     *    doc and the code disagree (or the authoring is defective). The test is
     *    committed with `status: 'failing'`.
     *  - `fidelity` — a scenario that PASSED birth but the fidelity reviewer judged
     *    it weak/vacuous/miscast: it does not truly verify what its section claims
     *    (item 33). Never committed — "the test is wrong" is a re-author path, not
     *    a code disagreement. `actual` carries the reviewer's one-sentence stated
     *    mismatch; `step`/`expected` are placeholders (no birth step ran).
     * Optional so older `result.json` files (and internal birth findings, which
     * leave it unset) keep parsing.
     */
    kind: z.enum(['birth', 'fidelity']).optional(),
    /**
     * The id of the scenario this result belongs to. Written for EVERY failure now
     * that a birth failure is a committed test; optional so older `result.json`
     * files (whose findings carried no scenario identity) keep parsing.
     */
    scenarioId: z.string().optional(),
    /**
     * True when the failing test was PERSISTED to the corpus — the normal birth
     * outcome. Absent/false on a `fidelity` rejection (never committed) and on
     * older reports written when a birth failure withheld the scenario.
     */
    committed: z.boolean().optional(),
    /** Repo-relative path of the committed `.yaml`; present iff `committed`. */
    file: z.string().optional(),
    /** The scenario title — the claim it was asserting. */
    title: z.string(),
    step: z.number().int().positive(),
    expected: z.string(),
    actual: z.string(),
    /** Repo-relative pointer into `guard/evidence/`, when a transcript was written. */
    evidencePath: z.string().optional(),
    /**
     * The failing step's RAW program output (see `OutputExcerptsSchema`), copied
     * off the birth-run mismatch (`GuardFailureDetailSchema`). The retry prompt
     * renders them so the model sees the usage error the program printed. A
     * `fidelity` finding has no program run, so these stay absent. Optional so
     * older reports parse.
     */
    ...OutputExcerptsSchema.shape,
    /**
     * The failed candidate's authored YAML, serialized inline AT FINDING CREATION
     * (same serialize-at-creation as heldSections' readyScenarios). The finding
     * detail renders it in the scenario-source code block so the user can judge
     * "defect or drift" with the exact commands the scenario ran on-screen.
     * Optional so older `result.json` files keep parsing.
     */
    yaml: z.string().optional(),
    /**
     * The EXTRACTED CLAIM's stable text — the claim identity a dismissal keys on
     * (anchor + this). The finding detail's Dismiss action writes it into
     * `scenarios/decisions.json`; generate then skips a matching claim before
     * authoring. Distinct from `title` (the scenario title). Optional so older
     * reports (and the internal retry-evidence findings) parse.
     */
    claim: z.string().optional(),
    /**
     * The bound section's human heading, joined SERVER-SIDE at report read time
     * (never written to `result.json` — the enrichment is read-side). A finding's
     * section is unsettled by definition, so it never has a committed scenario to
     * donate the heading client-side; slugs are engine ids, not UI copy.
     */
    headingText: z.string().optional(),
    /** The flow the failing scenario realizes (absent on hand-written work). */
    flowId: z.string().optional(),
    /** The surface the failing scenario runs on — the flow×surface identity. */
    surface: GuardDriverIdSchema.optional(),
    /**
     * The flow milestone the FAILING step realizes (its 1-based `order`), when the
     * step carried a milestone annotation. With {@link priorMilestonesPassed} this
     * is the COMPOSITION-TRIAGE pair — see {@link isCompositionFinding}.
     */
    failedMilestone: z.number().int().positive().optional(),
    /**
     * True when every milestone BEFORE {@link failedMilestone} was realized by
     * steps that passed — i.e. the chain broke mid-path rather than at its head.
     */
    priorMilestonesPassed: z.boolean().optional(),
  })
  .strict()
export type GuardBirthFinding = z.infer<typeof GuardBirthFindingSchema>

/**
 * The "milestones don't chain" triage category: a birth failure whose failing step
 * sits MID-CHAIN — earlier milestones passed, this one broke. Flow synthesis
 * composes claims code-blind, so whether milestones actually chain (shared state,
 * ordering, auth continuity) is an implementation fact the spec rarely states; an
 * incoherent composition fails birth looking exactly like doc-vs-code drift. The
 * category is DERIVED from the pair the generator annotates, so producers and
 * renderers can never disagree about what counts as one.
 */
export function isCompositionFinding(finding: GuardBirthFinding): boolean {
  return (
    finding.kind !== 'fidelity' &&
    finding.priorMilestonesPassed === true &&
    (finding.failedMilestone ?? 0) > 1
  )
}

export const GuardGenerateErrorSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    message: z.string(),
    /**
     * Output excerpts coherent with the error (see {@link OutputExcerptsSchema}), already
     * redacted + head-truncated by the runner: a BOOT failure carries the failed server's
     * own stdout/stderr (so `result.json` shows WHY it didn't come up — the diagnosed
     * cal.com health-timeouts left zero server-side evidence); a step-level INFRA error
     * carries the response-body/server-stderr excerpts. Absent for authoring errors (no
     * process ran). Optional so those and pre-change snapshots keep parsing. NO
     * format-version bump.
     */
    ...OutputExcerptsSchema.shape,
  })
  .strict()
export type GuardGenerateError = z.infer<typeof GuardGenerateErrorSchema>

/**
 * One birth-passed-but-withheld candidate under a held section — validated work
 * the all-or-nothing persist held back. The authored `yaml` rides inline (the
 * exact bytes the section would have committed): `result.json` is gitignored and
 * a few KB per scenario is trivial, so the inline copy beats a server-side
 * authoring-cache lookup for robustness (a cleared cache never blanks the UI).
 */
export const GuardReadyScenarioSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    /** The committed YAML the scenario would have been written as. */
    yaml: z.string(),
  })
  .strict()
export type GuardReadyScenario = z.infer<typeof GuardReadyScenarioSchema>

/**
 * A section whose birth-passed candidates were WITHHELD by the all-or-nothing
 * per-section persist. Flow-keyed generation persists every green scenario
 * independently — a failing sibling becomes a finding and holds nothing back — so
 * generate no longer produces this; the schema stays for the `result.json` files
 * that already carry it (they cost real money to produce) and the surfaces that
 * render them.
 */
export const GuardHeldSectionSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    headingText: z.string().optional(),
    readyScenarios: z.array(GuardReadyScenarioSchema),
  })
  .strict()
export type GuardHeldSection = z.infer<typeof GuardHeldSectionSchema>

/**
 * The built entry failed to START — a stale/orphaned dist, a missing interpreter, a
 * module-resolution crash. Recorded ONCE (never per section) so a dead binary reads
 * as one loud entry-level failure; the birth validation never ran, so no scenario
 * settled. The `stderr` is the full, untruncated startup output.
 */
export const GuardEntryPreflightSchema = z
  .object({
    /** Display form of the entry argv, e.g. `node tools/cli/dist/index.js`. */
    entry: z.string(),
    /** The recipe build command, for the rebuild hint. */
    buildCommand: z.string(),
    /** The full, UNTRUNCATED startup output the dead entry produced. */
    stderr: z.string(),
  })
  .strict()
export type GuardEntryPreflight = z.infer<typeof GuardEntryPreflightSchema>

/** A document whose claim extraction could not complete — its sections re-attempt next run. */
export const GuardExtractionFailureSchema = z
  .object({
    doc: z.string(),
    reason: z.string(),
  })
  .strict()
export type GuardExtractionFailure = z.infer<typeof GuardExtractionFailureSchema>

/**
 * A dismissal in `scenarios/decisions.json` that matched NO live claim in a doc
 * generate actually re-extracted this run — the claim's section content changed
 * (or the doc was edited) so the dismissed text no longer exists. Surfaced so a
 * stale dismissal is never silently honored forever; the user re-dismisses the new
 * claim text or drops the entry.
 */
export const GuardOrphanedDismissalSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    title: z.string(),
  })
  .strict()
export type GuardOrphanedDismissal = z.infer<typeof GuardOrphanedDismissalSchema>

/**
 * A `dismissedFlows` entry in `scenarios/decisions.json` that matched NO live flow
 * after synthesis — the flow it named was re-composed away (or renamed past its
 * identity overlap). Surfaced so a stale flow dismissal is never silently honored,
 * mirroring {@link GuardOrphanedDismissalSchema} for claims.
 */
export const GuardOrphanedFlowDismissalSchema = z
  .object({
    flowId: z.string(),
    title: z.string(),
  })
  .strict()
export type GuardOrphanedFlowDismissal = z.infer<typeof GuardOrphanedFlowDismissalSchema>

/** An area (or the epic pass, as `(epic)`) whose flow synthesis did not settle. */
export const GuardUnsettledFlowAreaSchema = z
  .object({
    areaId: z.string(),
    reason: z.string(),
  })
  .strict()
export type GuardUnsettledFlowArea = z.infer<typeof GuardUnsettledFlowAreaSchema>

/**
 * The flow-led counts of a generate run — the report's headline, since the FLOW is
 * the generation unit. `settled` + `unsettled` = `total`:
 *  - `settled` — every target surface ended in a persisted scenario or an explained
 *    gap. This INCLUDES `skipped`, the flows whose `generationInputsHash` still
 *    matched the manifest: no matching or authoring call fired and their committed
 *    scenarios stand, which is the healthiest outcome there is;
 *  - `unsettled` — some surface ended in a fidelity rejection or an error, so the
 *    flow re-runs next generate. A birth FAILURE never unsettles a flow: the test
 *    is committed with its failing status, which is a decision surface, not
 *    pending work.
 */
export const GuardFlowsReportSchema = z
  .object({
    /** Live flows after synthesis, dismissals excluded. */
    total: z.number().int().nonnegative(),
    settled: z.number().int().nonnegative(),
    unsettled: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    /** Flows dropped by a `dismissedFlows` entry. */
    dismissed: z.number().int().nonnegative(),
    /** Committed flows no re-synthesized flow claimed — their scenarios were dropped. */
    orphaned: z.number().int().nonnegative(),
    /** Near-duplicates the deterministic subsumption pass dropped. */
    subsumed: z.number().int().nonnegative(),
    /** Runnable claims synthesis deliberately placed in no flow, with a reason. */
    noFlowClaims: z.number().int().nonnegative(),
    /** Areas whose synthesis failed — their claims produced no flow this run. */
    unsettledAreas: z.array(GuardUnsettledFlowAreaSchema).default([]),
  })
  .strict()
export type GuardFlowsReport = z.infer<typeof GuardFlowsReportSchema>

/**
 * The journey catalog the run grounded on — deterministic, free, and re-derived
 * every generate. An empty surface is exactly what a `no-journey` gap reports, so
 * the counts are the first thing to read when flows settle unrealized.
 */
export const GuardJourneysReportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    /** Journey type (a driver id) → how many journeys were mapped for it. */
    bySurface: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict()
export type GuardJourneysReport = z.infer<typeof GuardJourneysReportSchema>

/** A bound section whose scenarios remain but the section itself is gone. */
export const GuardOrphanedSectionSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    scenarioIds: z.array(z.string()),
  })
  .strict()
export type GuardOrphanedSection = z.infer<typeof GuardOrphanedSectionSchema>

/** The recipe outcome for the run — loaded as-is or freshly discovered. `entry`
 *  is the cli preparation (absent on an api-only recipe); `serve` the api one. */
export const GuardRecipeReportSchema = z
  .object({
    status: z.enum(['exists', 'discovered']),
    entry: z.array(z.string()).optional(),
    serve: z.array(z.string()).optional(),
    wrotePath: z.string().optional(),
  })
  .strict()
export type GuardRecipeReport = z.infer<typeof GuardRecipeReportSchema>

/** LLM call/token/cost totals for the generate run — omitted when unmeasured. */
export const GuardGenerateUsageSchema = z
  .object({
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strict()
export type GuardGenerateUsage = z.infer<typeof GuardGenerateUsageSchema>

export const GuardGenerateReportSchema = z
  .object({
    generatedAt: z.string(),
    status: z.enum(['ok', 'no-docs', 'recipe-failed', 'open-conflicts']),
    /**
     * For `no-docs` / `recipe-failed` / `open-conflicts`: the user-facing reason.
     * For `open-conflicts` it carries the full formatted conflict message (the
     * conflict list itself is not snapshotted — surfaces render it live from the
     * corpus).
     */
    reason: z.string().optional(),
    recipe: GuardRecipeReportSchema.optional(),
    sectionsTotal: z.number().int().nonnegative(),
    sectionsChanged: z.number().int().nonnegative(),
    skippedUnchanged: z.number().int().nonnegative(),
    /** True when nothing changed — the confirm/run was a no-op. */
    noChanges: z.boolean(),
    written: z.array(GuardWrittenScenarioSchema),
    coverageGaps: z.array(GuardCoverageGapSchema),
    /**
     * The birth-stage failure results: one per COMMITTED failing test, plus the
     * `fidelity` rejections (the only candidates still refused a commit).
     */
    birthFindings: z.array(GuardBirthFindingSchema),
    errors: z.array(GuardGenerateErrorSchema),
    extractionFailures: z.array(GuardExtractionFailureSchema),
    orphaned: z.array(GuardOrphanedSectionSchema),
    /**
     * Birth outcomes that passed across both validation rounds. Optional so the
     * report stays a superset of the result AND tolerant reads of older files
     * (written before this field existed) keep parsing. May exceed
     * `written.length` when a passing scenario's section didn't settle.
     */
    birthPassed: z.number().int().nonnegative().optional(),
    /**
     * Ready-but-held scenarios from a pre-flow (per-section, all-or-nothing)
     * generate. Never written any more — persist is per scenario and independent —
     * and optional, so both the older reports carrying it and every new one parse.
     */
    heldSections: z.array(GuardHeldSectionSchema).optional(),
    /**
     * Dismissals whose claim text matched nothing in a doc this run re-extracted —
     * stale entries in `scenarios/decisions.json`, surfaced (never silently
     * honored). Optional so older reports parse; absent reads as "none".
     */
    orphanedDismissals: z.array(GuardOrphanedDismissalSchema).optional(),
    /**
     * `dismissedFlows` entries that matched no live flow after synthesis. Optional
     * so older reports parse; absent reads as "none".
     */
    orphanedFlowDismissals: z.array(GuardOrphanedFlowDismissalSchema).optional(),
    /**
     * The flow-led counts — the run's headline under flow-keyed generation.
     * Optional so reports written before flows existed keep parsing.
     */
    flows: GuardFlowsReportSchema.optional(),
    /** The journey catalog the run matched against. Optional, same reason. */
    journeys: GuardJourneysReportSchema.optional(),
    manifestPath: z.string().optional(),
    usage: GuardGenerateUsageSchema.optional(),
    /**
     * Present ONLY when the built entry failed to start — the whole birth phase was
     * short-circuited, so every changed section stayed unsettled. Optional so older
     * reports (written before this field existed) keep parsing.
     */
    entryPreflight: GuardEntryPreflightSchema.optional(),
  })
  .strict()
export type GuardGenerateReport = z.infer<typeof GuardGenerateReportSchema>
