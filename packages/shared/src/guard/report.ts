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
import { DetectedExternalServiceSchema } from '../external-services.js'
import { OutputExcerptsSchema } from './excerpts.js'
import type { GuardManifest } from './manifest.js'
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

/** The CLAIM half of a `blocked-on` reason (what the flow was trying to do) —
 *  the other inverse of {@link composeBlockedOnReason}; `''` when it does not parse. */
export function parseBlockedOnClaim(reason: string): string {
  const m = /^blocked on .+?: (.+)$/s.exec(reason)
  return m ? m[1].trim() : ''
}

/**
 * The THREE triage verdicts (item 81) — a standalone schema so the auto-resolution
 * ledger and the escalation record key on the same closed set. There is
 * deliberately NO `environment` verdict: a failure whose evidence says
 * missing-setup is routed to the needs-setup/blocked machinery BEFORE triage is
 * ever called — that is a state the runner detects, not an opinion a model holds.
 */
export const GuardTriageVerdictSchema = z.enum(['doc-drift', 'code-drift', 'generation-defect'])
export type GuardTriageVerdict = z.infer<typeof GuardTriageVerdictSchema>

/** The three confidence levels (shared with the fidelity reviewer). */
export const GuardTriageConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type GuardTriageConfidence = z.infer<typeof GuardTriageConfidenceSchema>

/**
 * A triage verdict on ONE failing test — the post-birth judgment call over the
 * test's own evidence (the journey transcript: steps, expected vs actual, raw
 * output; the flow's spec text; and the request-surface grounding). It attaches to
 * the TEST — two tests of one flow may carry different verdicts, and a flow-level
 * verdict would lie about one of them; flow surfaces show the rollup.
 *  - `doc-drift` — the doc is wrong; the `recommendation` quotes the exact doc
 *    line to change and its replacement.
 *  - `code-drift` — the code is wrong; the `recommendation` names the observed
 *    behavior vs the doc's promise (a real bug the test caught).
 *  - `generation-defect` — the scenario itself is faulty (a mis-authored
 *    assertion); the doc and the code do not actually disagree.
 * Object schema is NOT strict: an extra key from the model is dropped, never a
 * validation failure.
 */
export const GuardTriageSchema = z.object({
  verdict: GuardTriageVerdictSchema,
  confidence: GuardTriageConfidenceSchema,
  /** One-paragraph plain-words assessment of what the failure shows. */
  brief: z.string().min(1),
  /** The concrete next action (see the verdict cases above). */
  recommendation: z.string().min(1),
})
export type GuardTriage = z.infer<typeof GuardTriageSchema>

/**
 * A test's BIRTH-stage failure result — what the scenario asserted, what the code
 * actually did, and the evidence. This is either the recorded result of a
 * COMMITTED failing test (`committed: true`, `scenarioId` + `file` naming it —
 * triage blamed the repo, or produced no verdict), or WITHHELD work: a
 * `generation-defect` verdict (the scenario is faulty — a re-author path) or a
 * `fidelity` rejection, neither of which is ever written to the corpus.
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
    /**
     * The triage verdict + recommendation for this failing test (see
     * {@link GuardTriageSchema}), attached AT GENERATE by the post-birth triage
     * stage and persisted with the result (triage is expensive; it never
     * re-derives on read). Optional so older `result.json` files — and any run
     * with no triage runner — keep parsing; the test then commits untriaged.
     * A `fidelity` rejection carries none (the reviewer's verdict is its own).
     */
    triage: GuardTriageSchema.optional(),
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
     * WHAT KIND of failure this is — the discriminator every surface triages on,
     * because the three want opposite words:
     *  - `authoring` — the model produced nothing usable (invalid YAML, a refused
     *    plan). Self-healing: the next generate re-authors and may well succeed.
     *  - `birth` — a scenario WAS authored and its execution errored. Scenario-level,
     *    so it carries {@link flowId}.
     *  - `refusal` — the RUN was declined before anything was validated (a broken
     *    recipe, a half-configured external account, a dead entry). Nothing was
     *    authored, nothing executed, and re-running changes NOTHING until the
     *    config does — so a surface must never offer "will retry next generate".
     * Optional: reports written before the discriminator existed carry no kind, and
     * are read as `authoring` (the retry wording those surfaces already used). NO
     * format-version bump.
     */
    kind: z.enum(['authoring', 'birth', 'refusal']).optional(),
    /**
     * The flow the errored work belonged to, when the error HAS one. Errors are
     * otherwise attributed by section, which is lossy (many flows bind one section).
     * A run-level `refusal` carries none by nature — see {@link GuardRunRefusalSchema},
     * which names the flows it blocked. Optional for older reports.
     */
    flowId: z.string().optional(),
    /**
     * The surface the errored work was for — authoring is one call per (flow,
     * surface), so a flow can fail on one surface and succeed on another, and a
     * reader that cannot tell them apart attributes the failure to both. Optional:
     * a run-level refusal has none, and older reports carry none. NO format bump.
     */
    surface: GuardDriverIdSchema.optional(),
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
 * The built entry did not clear pre-flight — it either failed to START (a
 * stale/orphaned dist, a missing interpreter, a module-resolution crash) or
 * started and said NOTHING on any probe (a `true`-like no-op). Recorded ONCE
 * (never per section) so a bad binary reads as one loud entry-level failure; the
 * birth validation never ran, so no scenario settled. The `stderr` is the full,
 * untruncated diagnostic.
 */
export const GuardEntryPreflightSchema = z
  .object({
    /** Display form of the entry argv, e.g. `node tools/cli/dist/index.js`. */
    entry: z.string(),
    /** The recipe build command, for the rebuild hint. */
    buildCommand: z.string(),
    /** The full, UNTRUNCATED diagnostic the failed entry produced. */
    stderr: z.string(),
    /**
     * Which gate failed — `crash` (never started) or `silent` (started, produced no
     * output on any probe). Optional so reports written before the silent gate
     * existed keep parsing; absent reads as `crash`.
     */
    kind: z.enum(['crash', 'silent']).optional(),
  })
  .strict()
export type GuardEntryPreflight = z.infer<typeof GuardEntryPreflightSchema>

/**
 * The runner DECLINED the run — before building, booting, or executing anything.
 * A broken `recipe.json`, a credential env var that is not set, an external account
 * described only half-way: all are read off one JSON file in milliseconds, and all
 * of them mean the same thing — no scenario was validated, and none will be until
 * the configuration changes.
 *
 * Recorded ONCE, at the RUN level, in the runner's own grammar. It must never be
 * fanned out per candidate: a refusal that arrives as N per-scenario "validation
 * failures" reads as N broken tests and sends its reader to the application, which
 * was never even started. The flows it blocked are named so a flow surface can say
 * what stopped IT without the error list being duplicated across the corpus.
 */
export const GuardRunRefusalSchema = z
  .object({
    /** The runner's own status id — `missing-external-env`, `invalid-recipe`, … */
    status: z.string(),
    /** The runner's canonical human-readable reason (`runFailureMessage`). */
    message: z.string(),
    /** The flows whose validation this refusal cancelled. Empty is legal (none had reached birth). */
    flowIds: z.array(z.string()).default([]),
  })
  .strict()
export type GuardRunRefusal = z.infer<typeof GuardRunRefusalSchema>

/** The `doc` a run-level refusal is filed under — it belongs to no document. */
export const RUN_REFUSAL_DOC = '(guard run)'
/** The `anchor` a run-level refusal is filed under — it belongs to no section. */
export const RUN_REFUSAL_ANCHOR = '(refused)'

/**
 * The ONE error entry a refusal contributes to a report. Built here rather than at
 * the producer so the generator that records it and the readers that re-attribute
 * it to a flow can never disagree about its shape or its wording.
 */
export function runRefusalError(refusal: GuardRunRefusal): GuardGenerateError {
  return {
    doc: RUN_REFUSAL_DOC,
    anchor: RUN_REFUSAL_ANCHOR,
    kind: 'refusal',
    message: refusal.message,
  }
}

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
    /** The datastore compose file discovery GENERATED beside the recipe (item 68),
     *  repo-root-relative. Present only when a repo needed a database, shipped no
     *  compose file, and the generated one verified — both files are then artifacts
     *  the user reviews and commits. Optional so older reports keep parsing. */
    composePath: z.string().optional(),
    /** Which proposer produced a freshly discovered recipe: the deterministic
     *  per-ecosystem detectors, or the LLM fallback. Absent for `exists`. */
    source: z.enum(['deterministic', 'llm']).optional(),
    /** Fill-ins the proposer could not decide — credential env vars to set,
     *  security schemes with no request-header form. Printed, never a secret. */
    todos: z.array(z.string()).optional(),
    /** Advisory recipe diagnostics that did not stop the run (item 56) — e.g. a
     *  credential declaring a `satisfies` in a corpus with no OpenAPI document.
     *  Optional so reports written before this field existed keep parsing. */
    warnings: z.array(z.string()).optional(),
  })
  .strict()
export type GuardRecipeReport = z.infer<typeof GuardRecipeReportSchema>

/**
 * The seed-drafting stage's verdict (Stage 1 of item 66). It runs at the END of a
 * generate, when flows settled `blocked-on` missing data, a database was detected,
 * and the recipe has an `api` block but NO `api.seed` — and it is honest about the
 * other outcomes: `skipped` carries the condition that did not hold, `failed`
 * carries the engine's own verification diagnostic. A drafted seed names BOTH
 * artifacts the user reviews (the script file and the recipe block).
 */
export const GuardSeedDraftSchema = z
  .object({
    status: z.enum(['drafted', 'skipped', 'failed']),
    /** Why the stage skipped, or how verification rejected the draft. */
    reason: z.string().optional(),
    /** Repo-relative path of the written seed script (drafted only). */
    scriptPath: z.string().optional(),
    /** The `api.seed.command` patched into recipe.json (drafted only). */
    command: z.string().optional(),
    /** Fixture names the drafted seed provides (drafted only). */
    fixtures: z.array(z.string()).optional(),
    /** Credential names the drafted seed mints (drafted only). */
    credentials: z.array(z.string()).optional(),
    /** Flows this generate left blocked on missing data — the stage's trigger. */
    blockedFlows: z.number().int().nonnegative(),
  })
  .strict()
export type GuardSeedDraft = z.infer<typeof GuardSeedDraftSchema>

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
    /**
     * The recipe-inputs fingerprint (`sha256:…`, which folds the seed script's
     * content) this generate authored against. Lets a read tell a gap the CURRENT
     * recipe + seed already produced from one that predates an edit. Optional so
     * older reports parse; absent reads as "unknown".
     */
    recipeFingerprint: z.string().optional(),
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
    /**
     * The third parties the repo imports (item 57) — detected from the same working-tree
     * analysis the journeys came from, so it costs nothing extra. Independent of the
     * gaps: it answers "what does this app talk to" even when no flow was blocked.
     * Optional so reports written before detection existed keep parsing.
     */
    externalServices: z.array(DetectedExternalServiceSchema).optional(),
    manifestPath: z.string().optional(),
    usage: GuardGenerateUsageSchema.optional(),
    /**
     * Present ONLY when the built entry failed to start — the whole birth phase was
     * short-circuited, so every changed section stayed unsettled. Optional so older
     * reports (written before this field existed) keep parsing.
     */
    entryPreflight: GuardEntryPreflightSchema.optional(),
    /**
     * Present ONLY when the runner REFUSED the run outright (a broken recipe, a
     * half-configured external account). Nothing was authored into a test and
     * nothing executed, so the run's other tallies read as zero — this field is the
     * only thing that says WHY. Optional so older reports keep parsing.
     */
    refusal: GuardRunRefusalSchema.optional(),
    /**
     * The seed-drafting stage's verdict, when the stage ran at all. Absent means
     * it never fired (no api driver, no missing-data gap, nothing changed) — which
     * is also how every report written before the stage existed reads.
     */
    seedDraft: GuardSeedDraftSchema.optional(),
  })
  .strict()
export type GuardGenerateReport = z.infer<typeof GuardGenerateReportSchema>

/**
 * Carry the still-true birth findings of a PRIOR report into a fresh one. The
 * report is overwritten wholesale per generate, but its `birthFindings` contract
 * is "one per COMMITTED failing test" — and a generate that skipped a section as
 * unchanged did not re-execute that section's committed failing test, so wiping
 * its finding loses the only record of WHAT failed (expected/actual/evidence)
 * while the manifest still says `failing`. A prior finding survives iff:
 *  - the manifest still lists its scenario with status `failing` (deleted,
 *    dismissed-away, or now-passing scenarios drop out), and
 *  - this generate produced no fresh finding for that scenario, and
 *  - this generate did not re-write the scenario (a re-authored test's truth is
 *    its own fresh birth, whatever it was).
 * `fidelity` rejections are per-generate advisories about NEVER-committed
 * candidates — they are not carried. Pure; callers merge before persisting.
 */
export function carryForwardBirthFindings(
  report: GuardGenerateReport,
  prior: GuardGenerateReport | null,
  manifest: GuardManifest | null,
): GuardGenerateReport {
  if (!prior || prior.birthFindings.length === 0 || !manifest) return report
  const failing = new Set<string>()
  for (const flow of manifest.flows) {
    for (const s of flow.scenarios) if (s.status === 'failing') failing.add(s.id)
  }
  const fresh = new Set(report.birthFindings.map((f) => f.scenarioId).filter(Boolean))
  const rewritten = new Set(report.written.map((w) => w.id))
  const carried = prior.birthFindings.filter(
    (f) =>
      f.kind !== 'fidelity' &&
      f.scenarioId !== undefined &&
      failing.has(f.scenarioId) &&
      !fresh.has(f.scenarioId) &&
      !rewritten.has(f.scenarioId),
  )
  if (carried.length === 0) return report
  return { ...report, birthFindings: [...report.birthFindings, ...carried] }
}
