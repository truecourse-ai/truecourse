/**
 * Derived guard read-surface DTOs the dashboard renders — the per-section
 * coverage join, the flow inventory and its detail, the interface catalog, the
 * staleness probe, and a scenario's YAML source. These are *computed* on read
 * (never persisted, never validated back); the persisted, validated stores are
 * `result.ts` (run), `report.ts` (generate report), `manifest.ts`, `flows.ts`
 * (the flow corpus) and `../interfaces.ts` (the interface catalog).
 *
 * The read surfaces added with the flow model carry Zod schemas so the client can
 * validate a response it did not compose; the older coverage/staleness shapes stay
 * plain TypeScript interfaces (unchanged wire contract).
 *
 * The server composes these from the store files (`scenarios/flows.json`,
 * `scenarios/manifest.json`, `guard/LATEST.json`, `guard/result.json`,
 * `guard/interfaces.json`) plus the live spec doc; the client consumes them as the
 * wire types for the Guard tabs (Coverage, Flows, Interfaces, Runs).
 */

import { z } from 'zod'
import { GuardDriverIdSchema, awaitingDriverIds, type GuardDriverId } from './drivers.js'
import { GuardOutcomeSchema, GuardFailureDetailSchema, GuardResultStageSchema } from './result.js'
import type { GuardOutcome, GuardFailureDetail, GuardLatest, GuardTestStatus } from './result.js'
import {
  GuardBirthFindingSchema,
  GuardCoverageGapKindSchema,
  GuardGenerateErrorSchema,
  GuardTriageSchema,
} from './report.js'
import type { GuardCoverageGapKind, GuardGapDisplayKind } from './report.js'
import type { GuardScenarioSetupView, GuardScenarioStepView } from './scenario.js'
import { GuardNeedsSetupSchema } from './needs-setup.js'
import type { GuardNeedsSetup } from './needs-setup.js'
import {
  InterfaceCatalogSourceSchema,
  InterfaceContractSchema,
  InterfaceEntrySchema,
  InterfaceStepSchema,
} from '../interfaces.js'

/**
 * A live doc section's coverage status — the single value the coverage view
 * paints over each heading. A closed union of:
 *
 *  - run outcomes ({@link GuardOutcome}: `pass` | `fail` | `error` | `stale` |
 *    `orphaned`) — from the last run's per-scenario results bound to the section;
 *  - gap display kinds ({@link GuardGapDisplayKind}: a per-driver id `api` | `web`
 *    | `tui` for a section awaiting that driver, plus `untestable` | `no-claim` |
 *    `blocked-on`) — from the last generate's gaps or the manifest classification,
 *    always paired with a `reason`. An `awaiting-driver` gap paints under its
 *    driver id so the drivers stay separate chips (the flat set is registry-derived);
 *  - `guarded` — scenarios are bound but the current run has no outcome for them
 *    (the run is stale, or the section was never run);
 *  - `never-run` — a bound scenario that has NEVER EXECUTED AT ALL, not even at
 *    birth (a hand-authored corpus). `guarded` still means "it ran when it was
 *    written, just not in this run"; this one means nothing has ever proved it, so
 *    it must not borrow a passing word;
 *  - `needs-setup` — a `blocked-on` gap whose missing capability is an external
 *    service the user can PROVIDE. Derived on read from the externals
 *    view, never persisted and never a gap kind of its own: the stored gap stays
 *    `blocked-on`, so no outcome, gap kind, or pass/fail count moves;
 *  - `authoring-error` — generate TRIED to author a test here and failed, so the
 *    flow has no test and no gap. Without it that reads as bare `unguarded`
 *    ("nothing ever tried") when the truth is "we tried and could not". Derived on
 *    read from the last report's authoring errors, never persisted, and a distinct
 *    id from the RUN outcome `error` — nothing ran here, so the two must never
 *    conflate in totals or meta;
 *  - `unguarded` — nothing binds the section (no scenario, no gap, no verdict).
 */
export type GuardSectionCoverageStatus =
  | GuardOutcome
  | GuardGapDisplayKind
  | 'guarded'
  | 'never-run'
  | 'needs-setup'
  | 'authoring-error'
  | 'unguarded'

/**
 * Every coverage status in WORST-FIRST precedence — the ONE order every rollup
 * uses (surface → flow → section).
 *
 * The ORDER OF TIERS is {@link GUARD_COVERAGE_PLAIN_ORDER}, the five-word coverage
 * vocabulary: Failed → Blocked → Never run → Succeeded → Not testable. A rollup
 * therefore never hides a blocker behind a sibling that passed — a section with a
 * green scenario and a blocked claim reads Blocked, and the mix stays visible in
 * its detail. Within a tier the order is most-informative first:
 *
 *   1. **Failed** — `fail` before `error` (a verdict about the repo before a
 *      verdict about the run);
 *   2. **Blocked** — the two re-anchor states (`stale`, `orphaned`) lead because
 *      they are about a bind that USED to hold; then the run outcome `blocked` (a
 *      scenario exists and was held back on an unregistered supplied dependency —
 *      one registration away from a verdict); then `authoring-error` (generate
 *      tried and could not — an unanswered question, not a settled answer); then
 *      the gaps a user can clear, most actionable first: `needs-setup` (provide
 *      the account) → `blocked-on` → `no-interface` → the awaiting-driver ids
 *      (registry order); `unguarded` last, the only one that names nothing at all;
 *   3. **Never run** — a test exists and has never executed;
 *   4. **Succeeded** — `pass` (this run proved it) before `guarded` (an earlier
 *      execution did);
 *   5. **Not testable** — `unrealizable` (the spec promises what no code surface
 *      offers) → `untestable` → `no-claim` → `dismissed`.
 */
export const GUARD_COVERAGE_STATUS_PRECEDENCE = [
  // Failed
  'fail',
  'error',
  // Blocked
  'stale',
  'orphaned',
  'blocked',
  'authoring-error',
  'needs-setup',
  'blocked-on',
  'no-interface',
  ...awaitingDriverIds,
  'unguarded',
  // Never run
  'never-run',
  // Succeeded
  'pass',
  'guarded',
  // Not testable
  'unrealizable',
  'untestable',
  'no-claim',
  'dismissed',
] as const satisfies readonly GuardSectionCoverageStatus[]

// Compile-time backstop: a new status (a new outcome, driver, or gap kind) that
// nobody ranked would make `_UnrankedStatus` non-`never` and fail the build — a
// rollup can never silently mis-order an unknown status.
type _UnrankedStatus = Exclude<
  GuardSectionCoverageStatus,
  (typeof GUARD_COVERAGE_STATUS_PRECEDENCE)[number]
>
const _allStatusesRanked: _UnrankedStatus extends never ? true : never = true
void _allStatusesRanked

/** The coverage-status union as a Zod enum (the precedence list is the domain). */
export const GuardSectionCoverageStatusSchema = z.enum(
  GUARD_COVERAGE_STATUS_PRECEDENCE as unknown as [
    GuardSectionCoverageStatus,
    ...GuardSectionCoverageStatus[],
  ],
)

/**
 * The worst status of a set, by {@link GUARD_COVERAGE_STATUS_PRECEDENCE} — the
 * single rollup used for a flow (over its surfaces) and a section (over its
 * flows). An empty set is `unguarded`; an unknown value ranks last.
 */
export function worstCoverageStatus(
  statuses: readonly GuardSectionCoverageStatus[],
): GuardSectionCoverageStatus {
  let best: GuardSectionCoverageStatus = 'unguarded'
  let bestRank = GUARD_COVERAGE_STATUS_PRECEDENCE.length
  for (const status of statuses) {
    const rank = GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(status)
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank
      best = status
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// THE COVERAGE VOCABULARY — five words, and only these five.
// ---------------------------------------------------------------------------

/**
 * What a reader is told about coverage: a doc section, a flow, an overview
 * counter, a filter and a chip each wear exactly ONE of these five, everywhere,
 * on the CLI and in the dashboard alike.
 *
 *  - `succeeded` — the claims' scenarios passed;
 *  - `failed` — a scenario contradicted the spec (drift), or could not complete;
 *  - `blocked` — something NAMED stands between the claim and its proof: no
 *    interface to step through, a supplied dependency nobody registered, an
 *    external account to provide, a bind that no longer holds (a stale or
 *    orphaned anchor is Blocked — it is actionable, not a status of its own);
 *  - `not-testable` — a settled answer: nothing here can be proven (unrealizable,
 *    untestable, no testable claim, or the user ruled it out);
 *  - `never-run` — scenarios exist and have never executed. A first-class status:
 *    "committed but unproven" is neither a pass nor a gap.
 *
 * The wire keeps its richer status ids ({@link GuardSectionCoverageStatus}); they
 * decide COLOUR, ordering, and the sentence a detail row shows. They are never
 * the word. Scenario-level RUN verdicts keep their own pass/fail wording — these
 * five are the coverage vocabulary, not the verdict vocabulary.
 */
export type GuardCoveragePlainStatus =
  | 'failed'
  | 'blocked'
  | 'never-run'
  | 'succeeded'
  | 'not-testable'

/**
 * The five in SEVERITY order — worst first, and the order every counter, filter
 * and legend lists them in. `not-testable` is last on purpose: it is the one
 * status that is nobody's to-do, so it surfaces only when nothing else applies.
 */
export const GUARD_COVERAGE_PLAIN_ORDER = [
  'failed',
  'blocked',
  'never-run',
  'succeeded',
  'not-testable',
] as const satisfies readonly GuardCoveragePlainStatus[]

/** The ONE word per status. Nothing else may name a coverage state to a reader. */
export const GUARD_COVERAGE_STATUS_WORD: Record<GuardCoveragePlainStatus, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  blocked: 'Blocked',
  'not-testable': 'Not testable',
  'never-run': 'Never run',
}

/**
 * Every wire status folded onto its word. Derived from the precedence tiers above
 * so the two can never disagree: re-ranking a status into another tier changes
 * its word with it.
 */
const COVERAGE_PLAIN: Record<GuardSectionCoverageStatus, GuardCoveragePlainStatus> = {
  fail: 'failed',
  // Nothing about the repo is proven wrong, but the scenario reached no verdict —
  // and a run that could not finish is a failure of the run, never a pass.
  error: 'failed',
  stale: 'blocked',
  orphaned: 'blocked',
  // A scenario held back on an unregistered supplied dependency — the outcome the
  // word was coined for: named, actionable, and nothing about the repo disproven.
  blocked: 'blocked',
  'authoring-error': 'blocked',
  'needs-setup': 'blocked',
  'blocked-on': 'blocked',
  'no-interface': 'blocked',
  ...(Object.fromEntries(awaitingDriverIds.map((id) => [id, 'blocked'])) as Record<
    (typeof awaitingDriverIds)[number],
    GuardCoveragePlainStatus
  >),
  // Nothing accounts for this section — no flow, no gap, no claim. It is a HOLE in
  // the coverage record, which the next generate closes: attention-needing, and
  // never a quiet bucket that reads as "fine".
  unguarded: 'blocked',
  'never-run': 'never-run',
  pass: 'succeeded',
  guarded: 'succeeded',
  unrealizable: 'not-testable',
  untestable: 'not-testable',
  'no-claim': 'not-testable',
  dismissed: 'not-testable',
}

/**
 * A wire status's word-bearing status. An id this build never learned (a payload
 * from a newer server) reads `blocked` — attention-needing, never blank.
 */
export function guardCoveragePlainStatus(
  status: GuardSectionCoverageStatus,
): GuardCoveragePlainStatus {
  return COVERAGE_PLAIN[status] ?? 'blocked'
}

/** The one WORD a wire status wears on a coverage surface. */
export function guardCoverageWord(status: GuardSectionCoverageStatus): string {
  return GUARD_COVERAGE_STATUS_WORD[guardCoveragePlainStatus(status)]
}

/**
 * The worst of several coverage statuses, as its word-bearing status —
 * {@link worstCoverageStatus} read through the five. The empty set is `blocked`
 * (nothing accounts for it), matching `unguarded`'s own word.
 */
export function worstCoveragePlainStatus(
  statuses: readonly GuardSectionCoverageStatus[],
): GuardCoveragePlainStatus {
  return guardCoveragePlainStatus(worstCoverageStatus(statuses))
}

/**
 * The Manual pseudo-flow id of a hand-written scenario. Hand-written scenarios
 * belong to no synthesized flow, and the flow drill-down is TOTAL (nothing in the
 * corpus is reachable only through a list that no longer exists), so each one
 * groups under its own pseudo-flow titled from the scenario.
 */
export function manualFlowId(scenarioId: string): string {
  return `${MANUAL_FLOW_PREFIX}${scenarioId}`
}

const MANUAL_FLOW_PREFIX = 'manual:'

/** True for a {@link manualFlowId} — the client marks these "Manual". */
export function isManualFlowId(flowId: string): boolean {
  return flowId.startsWith(MANUAL_FLOW_PREFIX)
}

/** The scenario id behind a Manual pseudo-flow id, or `null` for a real flow. */
export function manualFlowScenarioId(flowId: string): string | null {
  return isManualFlowId(flowId) ? flowId.slice(MANUAL_FLOW_PREFIX.length) : null
}

/** One scenario's run result, projected onto a section for the coverage detail. */
export interface GuardSectionScenario {
  id: string
  title: string
  outcome: GuardOutcome
  durationMs: number
  /** Present on `fail` / `error`. */
  failure?: GuardFailureDetail
  /** Repo-relative pointer into `guard/evidence/`; present on `fail` / `error`. */
  evidencePath?: string
  /** Live anchor the section was found under when it moved (a silent remap). */
  remappedTo?: string
  /** The section's current (edited) fingerprint; present on `stale`. */
  currentFingerprint?: string
}

/**
 * Why a flow has no scenario on one surface — the manifest/report gap, with the
 * label both the CLI and the dashboard render (see `guardGapLabel`).
 */
export const GuardFlowGapSchema = z
  .object({
    kind: GuardCoverageGapKindSchema,
    /** The generator's one-line explanation. */
    reason: z.string(),
    /** Present iff `kind === 'awaiting-driver'` — the non-runnable driver awaited. */
    driver: GuardDriverIdSchema.optional(),
    /** One-line display label (`awaiting web driver`, `no interface`). */
    label: z.string(),
    /**
     * Present iff `kind === 'blocked-on'` AND the gap names an external service
     * the user can provide — the read-model promotion to `needs-setup`. Additive
     * and optional: a payload written before the promotion existed, or one composed
     * without externals data, simply carries no field and reads as plain blocked.
     */
    needsSetup: GuardNeedsSetupSchema.optional(),
  })
  .strict()
export type GuardFlowGap = z.infer<typeof GuardFlowGapSchema>

/**
 * One surface of a flow — the scenario that realizes it there, or the gap that
 * explains why none exists. `status` is the surface's coverage status: its run
 * outcome, else the committed test's birth status (`fail` for a test that failed
 * at birth, else `guarded`), else the gap's display kind.
 */
export const GuardFlowSurfaceSchema = z
  .object({
    /**
     * The driver the surface runs on. Absent ONLY when a run result is all that is
     * known about the scenario (a hand-written scenario with no manifest row — the
     * run store records no driver), so the client renders the row without a chip.
     */
    surface: GuardDriverIdSchema.optional(),
    /** The scenario realizing the flow here; absent when the surface ended in a gap. */
    scenarioId: z.string().optional(),
    status: GuardSectionCoverageStatusSchema,
    /** The last run's outcome for `scenarioId`; absent when this run has none. */
    outcome: GuardOutcomeSchema.optional(),
    /**
     * Which stage decided `status`: `run` when the current run has an outcome for
     * the scenario, `birth` when the status is the committed test's birth result.
     * Absent on a gap row (no test to have a status).
     */
    stage: GuardResultStageSchema.optional(),
    /** True when the run flagged interface drift on this scenario (never an outcome). */
    interfaceDrifted: z.boolean().optional(),
    gap: GuardFlowGapSchema.optional(),
  })
  .strict()
export type GuardFlowSurface = z.infer<typeof GuardFlowSurfaceSchema>

/**
 * A flow as a SECTION lists it — the user-directed inversion: clicking a spec
 * section shows the FLOWS that traverse it, never scenarios (those are reached
 * through the flow detail, one further click).
 */
export const GuardSectionFlowSchema = z
  .object({
    flowId: z.string(),
    title: z.string(),
    /** Worst status over the flow's surfaces (`unguarded` when never generated). */
    status: GuardSectionCoverageStatusSchema,
    /** The gap text behind `status`, when a gap decided it. */
    reason: z.string().optional(),
    /** The providable services behind a `needs-setup` status. */
    needsSetup: GuardNeedsSetupSchema.optional(),
    /** True for an epic flow (it chains other flows through `composedOf`). */
    epic: z.boolean(),
    /** True for the Manual pseudo-flow of a hand-written scenario. */
    manual: z.boolean(),
    /** 1-based orders of the milestones whose claim sits in THIS section. */
    milestonesInSection: z.array(z.number().int().positive()),
    /** Milestones in the whole flow — the chain the flow detail paints. */
    milestoneCount: z.number().int().nonnegative(),
    surfaces: z.array(GuardFlowSurfaceSchema),
  })
  .strict()
export type GuardSectionFlow = z.infer<typeof GuardSectionFlowSchema>

/**
 * One claim a section states that no flow carries — the gap that must stay
 * visible next to the section's scenarios. Sourced from the flow corpus's
 * `noFlowClaims` (which names the claim) and from the last generate's
 * claim-level coverage gaps (which may only carry the reason).
 */
export interface GuardSectionClaimGap {
  /** The claim's store id, when the claims store resolves the identity. */
  claimId?: string
  /** The claim's title; absent for a generate gap that named no claim. */
  title?: string
  /** Why it reached no flow. */
  reason: string
  /** The gap's kind, when the generate report classified it. */
  kind?: GuardCoverageGapKind
}

/** A live doc section joined to its guard coverage. */
export interface GuardSectionCoverage {
  /** Slugified heading path (the section anchor) in the live doc. */
  anchor: string
  /** Raw heading text, for display. */
  headingText: string
  /** Heading level 1–6; `0` for a whole-document (non-markdown) section. */
  level: number
  /** `sha256:…` over the live section text. */
  fingerprint: string
  status: GuardSectionCoverageStatus
  /** The gap / untestable one-liner; present for gap statuses. */
  reason?: string
  /** Capability nouns a `blocked-on` status names (parsed from `reason`). */
  blockedOnCapabilities?: string[]
  /**
   * The providable external services behind a `needs-setup` status — present iff
   * `status === 'needs-setup'`. The CTA the coverage view renders
   * ("Provide open-meteo → External APIs") is built from this.
   */
  needsSetup?: GuardNeedsSetup
  /**
   * The FLOWS that traverse this section, worst-first — what a section click
   * shows. The section's `status` is the worst status over them.
   */
  flows: GuardSectionFlow[]
  /**
   * The section's CLAIM-LEVEL gaps — claims stated here that no flow carries,
   * each with its reason. Independent of `status`: `guarded` outranks every gap
   * status, so a section with both scenarios and gapped claims would otherwise
   * report only its rank and lose the gaps entirely. A reader must see both.
   */
  claimGaps: GuardSectionClaimGap[]
  /** Scenario ids the section's flows are realized by (flat, for counts/links). */
  scenarioIds: string[]
  /**
   * Per-scenario run results for this section from the last run (empty until run).
   *
   * @deprecated Section-level scenarios are not a rendering surface any more —
   * render `flows` (a section shows flows; a flow shows its scenarios). Kept only
   * while `GuardSectionDetail` still reads it; drop the field with that component's
   * flow rewrite.
   */
  scenarios: GuardSectionScenario[]
}

/** Coverage bound to this doc whose anchor is gone from the live doc. */
export interface GuardOrphanedCoverage {
  /** The authored anchor that no longer resolves in the live doc. */
  anchor: string
  scenarioIds: string[]
  scenarios: GuardSectionScenario[]
}

/** The per-doc coverage payload — the coverage view renders it over the spec doc. */
export interface GuardDocCoverage {
  /** Repo-relative doc path. */
  doc: string
  /** Whether the doc parsed as markdown (vs the whole-doc fallback). */
  markdown: boolean
  /** Live doc sections in document order, each joined to its coverage. */
  sections: GuardSectionCoverage[]
  /** Guards bound to this doc whose section was removed (still worth surfacing). */
  orphanedSections: GuardOrphanedCoverage[]
  /** Live-section counts by status (every status key present, zero when none). */
  totals: Record<GuardSectionCoverageStatus, number>
  /** The run the outcomes were drawn from; null when never run. */
  runId: string | null
  ranAt: string | null
  /** The generate the gaps/classification were drawn from; null when never generated. */
  generatedAt: string | null
}

/**
 * The two amber-dot signals for the Guard tab, mtime-based (the guard analogue of
 * the spec/verify staleness probe):
 *  - `generateStale` — the spec corpus is newer than the last `guard generate`
 *    (generate would author new scenarios), or the corpus exists and nothing was
 *    ever generated.
 *  - `runStale` — the scenarios are newer than the last `guard run` (a re-run would
 *    re-test), or scenarios exist and nothing was ever run.
 */
export interface GuardStaleness {
  generateStale: boolean
  runStale: boolean
  hasCorpus: boolean
  hasScenarios: boolean
  hasGenerated: boolean
  hasRun: boolean
}

/**
 * An in-flight hosted guard gate for a PR head — surfaced by the PR-scoped
 * `/guard/latest?ref=` when no run is stored at that commit yet, so the view can
 * say "queued/running" instead of showing baseline data under a PR header. EE-only
 * (an active `guard.gate` job); OSS always resolves this to null.
 */
export interface GuardGatePending {
  /** The job's lifecycle: enqueued (`queued`) or executing (`running`). */
  status: 'queued' | 'running'
  /** The background job id, so the view can subscribe to its progress popup. */
  jobId: string
}

/**
 * The PR-scoped `/guard/latest?ref=<headSha>` response. `latest` is the run stored
 * at that exact commit (never the baseline — a PR must not show baseline data);
 * `null` with `pending` set means the gate is still running for this head, `null`
 * with `pending` null means no run and no in-flight gate (a plain empty state).
 */
export interface GuardLatestResponse {
  /** The run, with its flow join ({@link GuardLatestWithRunFlows}) when served. */
  latest: GuardLatestWithRunFlows | null
  pending: GuardGatePending | null
}

/**
 * One flow's milestone chain, joined onto a RUN payload so the Runs tab paints a
 * result as a flow INSTANCE (green up to the failure, red at `failedMilestone`,
 * grey after) without a second fetch. Only the flows the run's results actually
 * reference are joined — the smallest possible join, never the whole corpus.
 * Hand-written scenarios reference no flow and simply carry none.
 */
export const GuardRunFlowSchema = z
  .object({
    flowId: z.string(),
    title: z.string(),
    goal: z.string(),
    /** True for an epic flow (it chains other flows). */
    epic: z.boolean(),
    milestones: z
      .array(
        z
          .object({
            order: z.number().int().positive(),
            doc: z.string(),
            anchor: z.string(),
            claimTitle: z.string(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export type GuardRunFlow = z.infer<typeof GuardRunFlowSchema>

/**
 * A run as the RUN READS serve it: the stored `GuardLatest` shape plus the flow
 * join. `runFlows` is computed at read time (never persisted) and rides INSIDE the
 * run object on every run payload — `/guard/latest` (raw or PR envelope) and
 * `/guard/runs/:runId` alike — so the client reaches it one way. Optional because
 * the store shape itself carries none (a run parsed straight off disk).
 */
export interface GuardLatestWithRunFlows extends GuardLatest {
  runFlows?: GuardRunFlow[]
}

/**
 * A committed test's source, for the detail view: its STEPS as the reader sees
 * them (the View mode's primary rendering) and the raw YAML behind them (the YAML
 * mode). `steps` is empty when the file doesn't parse as a known driver — the
 * detail then shows the source alone rather than a half-rendered guess. The step
 * list is derived SERVER-SIDE from the parsed file, so the dashboard and the CLI
 * read one source.
 */
export interface GuardScenarioSource {
  id: string
  /** Repo-relative path of the YAML file. */
  file: string
  /** Raw YAML text. */
  content: string
  /** The driver the file declares, when it parsed. */
  driver?: GuardDriverId
  /** The step list, rendered structurally by the test detail. */
  steps?: GuardScenarioStepView[]
  /**
   * The world the test starts in — the `setup:` block, derived from the same
   * parse as the steps. Absent when the file declares none.
   */
  setup?: GuardScenarioSetupView
}

/**
 * ONE entity's own slice of the JSON store file that holds it — the RAW half of
 * the two readings every artifact-backed entity offers (View + the artifact).
 * Pretty-printed server-side from the real file, so the pane shows what is
 * actually stored rather than a re-serialization of the view model.
 *
 * The scenario detail has no `GuardArtifactSource`: its artifact is the whole
 * YAML file, which {@link GuardScenarioSource.content} already carries.
 */
export interface GuardArtifactSource {
  /** The entity's id, echoed back — what the slice was selected by. */
  id: string
  /** Repo-relative path of the store file the slice came out of. */
  file: string
  /** The entity's entry, pretty-printed JSON. */
  content: string
}

/**
 * One row in the Scenarios-tab inventory — every committed scenario, generated
 * OR hand-written, joined from the loaded corpus and the manifest. The last-run
 * outcome and any orphaned flag are joined client-side from the run store, so
 * they are NOT part of this row (which stays run-independent — a fresh clone
 * lists its committed guards before any local run).
 */
export interface GuardScenarioListItem {
  id: string
  title: string
  /** Repo-relative spec doc the scenario binds to. */
  doc: string
  /** Slugified heading path the scenario binds to (`binds.section`). */
  anchor: string
  /**
   * The bound section's human heading text ("10.7 The Local Developer Loop"),
   * joined from the live doc's section index — the anchor slug is an engine
   * identifier, never UI copy. Absent when the doc or section no longer exists.
   */
  headingText?: string
  /** Repo-relative path of the YAML file. */
  file: string
  /** True when no manifest flow lists this id (authored by hand, not generated). */
  handWritten: boolean
  /**
   * The flow the scenario realizes — the Manual pseudo-flow id
   * ({@link manualFlowId}) for a hand-written one, so every row groups under a
   * flow and the drill-down stays total.
   */
  flowId: string
  /** The surface (driver) it runs on. */
  surface?: GuardDriverId
  /**
   * The status the last generate COMMITTED the test with — `failing` for a test
   * that failed its birth execution (committed anyway: the doc and the code
   * disagree), else `passing`. It makes the inventory renderable without a run:
   * a fresh clone lists its red tests as red. A `guard run` outcome, joined
   * client-side, always wins over it. Absent for hand-written work (no manifest
   * row names it) and for manifests written before failing tests were committed.
   */
  status?: GuardTestStatus
}

/**
 * ONE SURFACE'S preparation, in the SAME fields whatever surface it is: the
 * commands that make the surface runnable, the argv that starts it, how its
 * readiness is observed, and the env its processes get. Every scope of the card
 * reads through this one shape, so cli, api and web can never grow three
 * different renderings — or three different vocabularies — for the same idea.
 *
 * A field the recipe does not declare for the surface is ABSENT: never null,
 * never a default the file itself never stated (the defaults the runner applies
 * are the runner's).
 */
export interface GuardRecipeSurface {
  /** Shell command run once before the build to fetch dependencies. */
  install?: string
  /** Shell command that produces what this surface runs. */
  build?: string
  /** Entrypoint argv this surface invokes (cli driver). */
  entry?: string[]
  /**
   * Argv that starts this surface's server — the DEFAULT server's, when the
   * surface declares several (the full inventory is {@link servers}).
   */
  serve?: string[]
  /**
   * Every HTTP service the surface declares, in name order. Present only when
   * there is more than one story to tell; a single server is `serve` alone.
   */
  servers?: { name: string; serve: string[]; app?: string }[]
  /**
   * One-shot datastore orchestration (`api.services`): `up` runs in the repo root
   * once per run before any api scenario (e.g. `docker compose up -d --wait`),
   * `down` after the last one.
   */
  services?: { up: string; down?: string }
  /** Path polled until it answers 2xx before this surface's first step. */
  healthPath?: string
  /** Where the process runs — `sandbox` (the default) or `repo`. */
  cwd?: 'sandbox' | 'repo'
  /** Budget for the surface to become ready, in ms. */
  readyTimeoutMs?: number
  /** Env this surface's processes get. */
  env?: Record<string, string>
  /**
   * THE API SURFACE'S SHARED SERVER. The runner serves ONE surface for both web
   * steps and `request` steps (`guard-runner`'s `drivers/surface.ts`: one world
   * has one address), so a recipe with a `web` block and no `api` block still has
   * an api server — the web block's. When that is what this block is, it carries
   * the web block's own fields and says so here, which is why the api scope reads
   * a real server instead of "nothing declared" and the reader is told whose it
   * is. Absent on a surface that declares its own preparation.
   */
  sharedWithWeb?: true
}

/**
 * The preparation-recipe card — the committed `recipe.json` resolved to ONE
 * per-surface shape, plus its current working-tree inputs fingerprint and a
 * staleness signal. `stale` compares the current fingerprint to the last run's
 * recorded `recipeFingerprint` (the only stored baseline); it is `null` when
 * there is no run to compare against.
 */
export interface GuardRecipeCard {
  /**
   * Preparation per surface, keyed by driver id — the one shape every scope of
   * the card reads. A surface the recipe says nothing about has NO entry at all,
   * which is how a reader is told there is no preparation for it.
   */
  surfaces: Partial<Record<GuardDriverId, GuardRecipeSurface>>
  /** `sha256:…` over the current discovery-input files (package.json, lockfile, …). */
  fingerprint: string
  /**
   * True when the recipe-discovery inputs changed since the last run recorded
   * its fingerprint (the recipe may need re-discovery); null when no run exists
   * to compare against.
   */
  stale: boolean | null
}

/**
 * The Scenarios-tab payload — the recipe card plus the committed-scenario
 * inventory. One envelope so the tab has a single read (the recipe rides the
 * scenarios response rather than a separate endpoint).
 */
export interface GuardScenarioInventory {
  recipe: GuardRecipeCard | null
  scenarios: GuardScenarioListItem[]
  /**
   * The commit the inventory was read at (hosted only; absent on the OSS live
   * store and on an empty hosted scope). Under a PR ref this can be the BASELINE
   * commit — a PR-gate run executes the baseline set against the head without
   * re-persisting it, so a head miss falls back (the `corpusCommit` convention);
   * the client compares it to the viewed ref to label the fallback.
   */
  scenariosCommit?: string
}

// ---------------------------------------------------------------------------
// Flows tab — the inventory drill-down (replaces the flat Scenarios list).
// ---------------------------------------------------------------------------

/** A flow's coverage bucket, the same one `guard status` counts by. */
export const GuardFlowBucketSchema = z.enum(['guarded', 'partial', 'blocked', 'ungenerated'])
export type GuardFlowBucket = z.infer<typeof GuardFlowBucketSchema>

/** One row of the Flows-tab list — a flow joined to the manifest, run, and report. */
export const GuardFlowListItemSchema = z
  .object({
    flowId: z.string(),
    title: z.string(),
    /** One-line user goal; empty for a Manual pseudo-flow (a scenario has no goal). */
    goal: z.string(),
    /** Worst status over the flow's surfaces (`unguarded` when never generated). */
    status: GuardSectionCoverageStatusSchema,
    /** Coverage bucket — the filter/tally key (`guarded | partial | blocked | ungenerated`). */
    bucket: GuardFlowBucketSchema,
    /** True for an epic flow (it chains other flows through `composedOf`). */
    epic: z.boolean(),
    /** Ids of the flows an epic flow chains. */
    composedOf: z.array(z.string()).default([]),
    /** True for the Manual pseudo-flow of a hand-written scenario. */
    manual: z.boolean(),
    milestoneCount: z.number().int().nonnegative(),
    /** Sections the flow binds. */
    sectionCount: z.number().int().nonnegative(),
    /** Repo-relative docs the flow binds — the area/doc filter key. */
    docs: z.array(z.string()),
    surfaces: z.array(GuardFlowSurfaceSchema),
    /**
     * The drivers this flow's TESTS actually exercise — the union of the step
     * kinds their scenarios use, not the scenario-level `driver` field. A cli
     * scenario carrying web steps reports BOTH (`['cli','web']`), which is the
     * whole point: the scenario-level driver names the sandbox world, and a
     * reader filtering for "web" means the steps. A flow with no test yet falls
     * back to its surfaces' declared drivers, so a blocked flow still answers
     * "which surface was this for". Optional so a payload written before the
     * field still parses (the `orphaned` precedent).
     */
    drivers: z.array(GuardDriverIdSchema).optional(),
    /**
     * DRIFT-class findings the last generate attributed to this flow — the ones
     * that mean the flow is failing: a committed red test the repo and the doc
     * disagree about, or an escalation re-generation stopped fixing. A withheld
     * `generation-defect` / fidelity rejection is OURS and never counted here;
     * it rides in {@link toolDefects}, because a flow whose only finding is our
     * own defect is not failing (see `guardFindingClass`).
     */
    findings: z.number().int().nonnegative(),
    /**
     * The WITHHELD findings — our own generation defects and fidelity rejections.
     * Never a status input, never red: the flow re-authors on the next generate.
     * Optional/defaulted so a payload written before the split still parses.
     */
    toolDefects: z.number().int().nonnegative().default(0),
    /** Generate errors on the flow's bound sections (best-effort attribution). */
    errors: z.number().int().nonnegative(),
    /** True when the last run flagged interface drift on any of the flow's scenarios. */
    interfaceDrifted: z.boolean(),
    /**
     * True when no synthesized flow claims this one any more (`orphaned` on its
     * manifest entry): it is kept only because its committed tests still run. Such
     * a flow has no title, goal or milestones by nature — nothing derives it — so
     * the flag is what lets a reader be told why instead of shown a hollow row.
     */
    orphaned: z.boolean().optional(),
  })
  .strict()
export type GuardFlowListItem = z.infer<typeof GuardFlowListItemSchema>

/**
 * A flow's coverage status in the five words — the ONE derivation the CLI list and
 * the dashboard list both read, so `guard flows` and the Flows tab can never
 * disagree about a flow.
 *
 * FAILED means a test ran and was contradicted (at birth or in a run): guard
 * commits failing tests, so a birth failure reaches the list as a `fail` surface
 * and the flow's own status carries it; a recorded finding the surface join lost
 * still decides, so a red flow can never read blank.
 *
 * An UNGENERATED flow (no manifest entry at all) is deliberately NOT failed —
 * nothing ran, so there is no result to report. It is Blocked, and the next
 * generate is what clears it.
 */
export function guardFlowPlainStatus(
  flow: Pick<GuardFlowListItem, 'status' | 'bucket' | 'findings'>,
): GuardCoveragePlainStatus {
  if (flow.findings > 0) return 'failed'
  if (flow.bucket === 'ungenerated') return 'blocked'
  return guardCoveragePlainStatus(flow.status)
}

/** Flow-tally for the list header — the buckets plus the corpus totals. */
export const GuardFlowTotalsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    guarded: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    /** Synthesized but never generated (no manifest entry yet). */
    ungenerated: z.number().int().nonnegative(),
    /** Manual pseudo-flows (hand-written scenarios) inside `total`. */
    manual: z.number().int().nonnegative(),
  })
  .strict()
export type GuardFlowTotals = z.infer<typeof GuardFlowTotalsSchema>

/** The Zod-validated core of the Flows-tab payload (everything but the recipe card). */
export const GuardFlowsViewCoreSchema = z
  .object({
    flows: z.array(GuardFlowListItemSchema),
    totals: GuardFlowTotalsSchema,
    /**
     * Runnable claims synthesis deliberately placed in NO flow (the honesty rule);
     * the reasons live in `scenarios/flows.json`.
     */
    noFlowClaims: z.number().int().nonnegative(),
    /** True when a `scenarios/flows.json` corpus exists (else: never synthesized). */
    synthesized: z.boolean(),
    /** Provenance — nulls until the matching command ran. */
    generatedAt: z.string().nullable(),
    runId: z.string().nullable(),
    ranAt: z.string().nullable(),
    /** The commit the corpus was read at (hosted only). */
    flowsCommit: z.string().optional(),
  })
  .strict()

/**
 * The Flows-tab payload — the flow inventory plus the preparation-recipe card the
 * tab inherited from the Scenarios tab. ONE read per tab (the recipe rides along,
 * the same convention `GuardScenarioInventory` follows). The findings block and
 * dismissed chips come from `/guard/report` and `/guard/decisions` as before.
 */
export interface GuardFlowsView extends z.infer<typeof GuardFlowsViewCoreSchema> {
  recipe: GuardRecipeCard | null
}

/** One milestone of a flow, joined to the LIVE section it was extracted under. */
export const GuardFlowMilestoneViewSchema = z
  .object({
    order: z.number().int().positive(),
    doc: z.string(),
    anchor: z.string(),
    claimTitle: z.string(),
    /** Synthesis' note on why this step sits here. */
    note: z.string().optional(),
    /** The live section's heading text; absent when the doc or section is gone. */
    headingText: z.string().optional(),
    /** True when the anchor still resolves in the live doc (else: orphaned). */
    live: z.boolean(),
    /** The section fingerprint the flow bound at synthesis. */
    boundFingerprint: z.string().optional(),
    /** The live section's fingerprint — differs ⇒ the section was edited. */
    currentFingerprint: z.string().optional(),
    /** True when bound and live fingerprints disagree (the section drifted). */
    drifted: z.boolean(),
  })
  .strict()
export type GuardFlowMilestoneView = z.infer<typeof GuardFlowMilestoneViewSchema>

/** A flow's per-surface scenario row in the flow detail. */
export const GuardFlowScenarioRowSchema = z
  .object({
    surface: GuardDriverIdSchema.optional(),
    scenarioId: z.string().optional(),
    title: z.string().optional(),
    /** Repo-relative path of the committed YAML — the source pointer. */
    file: z.string().optional(),
    status: GuardSectionCoverageStatusSchema,
    /**
     * True when the committed test PASSED its birth execution. Guard commits
     * failing tests too, so this is a real per-test fact (not "it exists"): a
     * committed test whose manifest status is `failing` reads `false`.
     */
    birthPassed: z.boolean(),
    /** Which stage produced `status` / `failure` — `birth` until a run covers it. */
    stage: GuardResultStageSchema.optional(),
    outcome: GuardOutcomeSchema.optional(),
    durationMs: z.number().nonnegative().optional(),
    /**
     * The failure detail behind `status`: the run's when the run failed, else the
     * committed test's BIRTH failure (`stage: 'birth'`).
     */
    failure: GuardFailureDetailSchema.optional(),
    /** The milestone the failing step realized — paints the flow instance red there. */
    failedMilestone: z.number().int().positive().optional(),
    interfaceDrifted: z.boolean().optional(),
    /**
     * True when the failure behind this row landed on an UNMILESTONED setup step —
     * a prerequisite the spec never asserts (see `blockedPrecondition` on
     * `GuardScenarioResultSchema`). Never a status input; it only tells the reader
     * the specified behavior was never reached.
     */
    blockedPrecondition: z.boolean().optional(),
    /** Repo-relative evidence dir the run recorded. */
    evidencePath: z.string().optional(),
    /**
     * The run that produced this row's outcome. The board is merged across runs, so
     * the detail's own `runId` (the board envelope's) is only the run that wrote it
     * LAST — a row carried from an earlier run keeps that run's evidence, and this is
     * the id its transcript is filed under. Present on every run-stage row; absent on
     * a birth-stage or never-run row, which no run produced.
     */
    runId: z.string().optional(),
    /**
     * The TRIAGE verdict that committed this test red — what the failure
     * actually is, in one word plus a plain-words brief and the concrete unblock.
     * Birth stage only: the verdict was reached about that birth failure, and a
     * later run's failure is a different event with no verdict of its own. Read
     * from the last generate's finding, else from the diagnosis the manifest
     * committed with the test (which survives a fresh clone, where `result.json`
     * — gitignored — does not).
     */
    triage: GuardTriageSchema.optional(),
    /**
     * True when the run recorded an evidence bundle for this row (so the detail can
     * render the transcript open). `guard/evidence/` is gitignored, so a fresh clone
     * can still 404 the fetch — the flag says "the run wrote one", not "it is here".
     */
    hasEvidence: z.boolean(),
    /** Interface ids this scenario grounds on (its realization path, in order). */
    interfacePath: z.array(z.string()).default([]),
    gap: GuardFlowGapSchema.optional(),
  })
  .strict()
export type GuardFlowScenarioRow = z.infer<typeof GuardFlowScenarioRowSchema>

/** A flow gap with the surface it happened on (the flat gaps block). */
export const GuardFlowSurfaceGapSchema = GuardFlowGapSchema.extend({
  surface: GuardDriverIdSchema,
}).strict()
export type GuardFlowSurfaceGap = z.infer<typeof GuardFlowSurfaceGapSchema>

/**
 * The flow detail — goal, milestone chain (each bound to its live spec section),
 * the per-surface scenario rows, the realization interfaces, the gaps, and the
 * findings the last generate attributed to the flow.
 */
export const GuardFlowDetailSchema = z
  .object({
    flowId: z.string(),
    title: z.string(),
    goal: z.string(),
    status: GuardSectionCoverageStatusSchema,
    bucket: GuardFlowBucketSchema,
    epic: z.boolean(),
    manual: z.boolean(),
    composedOf: z.array(z.string()).default([]),
    /** `sha256:…` over the milestone composition; absent for a Manual pseudo-flow. */
    fingerprint: z.string().optional(),
    milestones: z.array(GuardFlowMilestoneViewSchema),
    surfaces: z.array(GuardFlowScenarioRowSchema),
    /** The same gaps the surface rows carry, flattened for the gaps block. */
    gaps: z.array(GuardFlowSurfaceGapSchema),
    /** Interface ids the flow's scenarios ground on, first-seen order. */
    interfaceIds: z.array(z.string()),
    /**
     * The birth-stage failure results the last generate attributed to this flow —
     * its committed failing tests plus any fidelity rejection. Transitional: a
     * committed failing test is already a `surfaces` row carrying its failure.
     */
    findings: z.array(GuardBirthFindingSchema),
    /** Generate errors on the flow's bound sections (best-effort attribution). */
    errors: z.array(GuardGenerateErrorSchema),
    /**
     * True when no synthesized flow claims this one any more — it survives only
     * because its committed tests do. `goal` and `milestones` are empty BY NATURE
     * here (they live in the flow corpus this flow left), so this flag is the
     * payload's answer to "why is this detail hollow".
     */
    orphaned: z.boolean().optional(),
    generatedAt: z.string().nullable(),
    runId: z.string().nullable(),
    ranAt: z.string().nullable(),
  })
  .strict()
export type GuardFlowDetail = z.infer<typeof GuardFlowDetailSchema>

// ---------------------------------------------------------------------------
// Interfaces tab — the code-side catalog (the free Map action's read surface).
// ---------------------------------------------------------------------------

/**
 * One flow that USES an interface — the reverse-index entry.
 *
 * `realized: false` is the case a plain scenario-derived index cannot see: the
 * flow's realization plan walked this interface, but no scenario was written for
 * that surface (authoring was blocked on setup the repo hasn't declared). The
 * spec DOES reach the code path; it just cannot be exercised yet, and `gap` says
 * what it is waiting on.
 */
export const GuardInterfaceFlowRefSchema = z
  .object({
    flowId: z.string(),
    /** The flow's title; its id when no flows corpus names it (hand-written work). */
    title: z.string(),
    /** True when a committed scenario of this flow grounds on the interface. */
    realized: z.boolean(),
    /** Why an unrealized usage produced no scenario. Absent when realized. */
    gap: GuardFlowGapSchema.optional(),
  })
  .strict()
export type GuardInterfaceFlowRef = z.infer<typeof GuardInterfaceFlowRefSchema>

/** One interface row: the catalog entry plus the reverse index onto the flows. */
export const GuardInterfaceRowSchema = z
  .object({
    id: z.string(),
    /** The surface — a driver-registry id. */
    type: GuardDriverIdSchema,
    title: z.string(),
    /**
     * The FAMILY this entry belongs to (the `rules` command tree, the `analyses`
     * route family) — passed through from the catalog verbatim and scoped to
     * `type`, so the panel can show the tree the per-entry granularity dissolved.
     * Absent where the derivation established no family.
     */
    group: z.string().optional(),
    entry: InterfaceEntrySchema,
    steps: z.array(InterfaceStepSchema),
    /** The state the task starts from, as its area's state ID — passed through
     *  from the catalog verbatim (the registry that describes it lives there). */
    startingState: z.string().optional(),
    /** The observable state the task leaves behind, as a state id — verbatim. */
    endState: z.string().optional(),
    fingerprint: z.string(),
    /**
     * Flows that use this interface — realized (a scenario grounds on it) or merely
     * planned (matched, then blocked). EMPTY is the only honest "the spec never
     * mentions this code path", and the single source for the row's flow count.
     */
    flows: z.array(GuardInterfaceFlowRefSchema),
    /** The scenarios that ground on it. */
    scenarioIds: z.array(z.string()),
    /** How this surface's catalog was derived (`tree` | `probes`). */
    source: InterfaceCatalogSourceSchema.optional(),
    /** Declared in an OpenAPI doc, but no route registration serves it. */
    specOnly: z.literal(true).optional(),
    /**
     * The full public contract — the command tree with its grammar and each
     * command's input/output. Passed through from the catalog verbatim; absent
     * where the derivation established the command tree only, which is exactly
     * what the view renders as "no contract derived yet".
     */
    contract: InterfaceContractSchema.optional(),
  })
  .strict()
export type GuardInterfaceRow = z.infer<typeof GuardInterfaceRowSchema>

/**
 * One chip of the detected-surface banner: a driver-registry row with what the
 * mapping found for it. `detected` answers "does TrueCourse think my app has this
 * surface"; `runnable` answers "can we run scenarios on it today".
 */
export const GuardInterfaceSurfaceSchema = z
  .object({
    surface: GuardDriverIdSchema,
    label: z.string(),
    runnable: z.boolean(),
    /** UI copy for a non-runnable surface ("Needs web driver"). */
    waitingLabel: z.string().optional(),
    /** Interfaces mapped for this surface. */
    interfaces: z.number().int().nonnegative(),
    detected: z.boolean(),
    source: InterfaceCatalogSourceSchema.optional(),
  })
  .strict()
export type GuardInterfaceSurface = z.infer<typeof GuardInterfaceSurfaceSchema>

/**
 * The Interfaces-tab payload. `mapped: false` is the clean empty state (no
 * `guard/interfaces.json` yet) — every list is empty and the banner still carries a
 * row per registry driver, so the tab renders its Map CTA without a null check.
 */
export const GuardInterfacesViewSchema = z
  .object({
    /** False when no catalog snapshot exists — the client renders the Map CTA. */
    mapped: z.boolean(),
    generatedAt: z.string().nullable(),
    /** The recipe fingerprint the mapping ran against. */
    recipeFingerprint: z.string().nullable(),
    interfaces: z.array(GuardInterfaceRowSchema),
    /** One row per driver-registry surface (the banner), registry order. */
    surfaces: z.array(GuardInterfaceSurfaceSchema),
    totals: z
      .object({
        interfaces: z.number().int().nonnegative(),
        detectedSurfaces: z.number().int().nonnegative(),
        /** Interfaces at least one flow uses (realized or planned-but-blocked). */
        grounded: z.number().int().nonnegative(),
        /** Interfaces NO flow references at all — the future infer signal. */
        ungrounded: z.number().int().nonnegative(),
      })
      .strict(),
    /**
     * Why the catalog is unavailable, when it is: `no-working-tree` (a hosted repo
     * has no tree to map). Absent when the read succeeded (mapped or simply empty).
     */
    unavailable: z.enum(['no-working-tree']).optional(),
  })
  .strict()
export type GuardInterfacesView = z.infer<typeof GuardInterfacesViewSchema>

// --- Claims tab ---------------------------------------------------------------

/**
 * One flow that carries a claim — the trace's middle link. `milestoneOrder` is
 * where the claim sits in the flow's path, so a reader can jump straight at it.
 */
export const GuardClaimFlowRefSchema = z
  .object({
    flowId: z.string(),
    /** The flow's title; its id when the corpus no longer names it. */
    title: z.string(),
    /** 1-based position of the milestone that proves this claim in that flow. */
    milestoneOrder: z.number().int().positive(),
    /** The synthesis note on that milestone, when it wrote one. */
    note: z.string().optional(),
  })
  .strict()
export type GuardClaimFlowRef = z.infer<typeof GuardClaimFlowRefSchema>

/**
 * One scenario that proves a claim, reached through a step tagged with the
 * claim's ID. `steps` are the 1-based step numbers carrying the tag — the exact
 * observations that stand behind the claim.
 */
export const GuardClaimScenarioRefSchema = z
  .object({
    scenarioId: z.string(),
    title: z.string(),
    /** 1-based step numbers whose `milestone` names this claim. */
    steps: z.array(z.number().int().positive()),
  })
  .strict()
export type GuardClaimScenarioRef = z.infer<typeof GuardClaimScenarioRefSchema>

/**
 * Where a claim stands in coverage accounting. Claim-keyed, so it always exists:
 * `proven` (a scenario step proves it), `planned` (a flow carries it, no scenario
 * step names it yet), `gapped` (accounted for as a `noFlowClaim`, with a reason),
 * `unplanned` (no flow, no gap record — the honest hole synthesis owes an answer
 * for).
 */
export const GuardClaimCoverageSchema = z.enum(['proven', 'planned', 'gapped', 'unplanned'])
export type GuardClaimCoverage = z.infer<typeof GuardClaimCoverageSchema>

/** One claim as the Claims tab lists it: the store row plus its two traces. */
export const GuardClaimRowSchema = z
  .object({
    id: z.string(),
    doc: z.string(),
    anchor: z.string(),
    title: z.string(),
    claim: z.string(),
    contentHash: z.string(),
    verifyVia: z.string().optional(),
    /** The live section's heading text, when the anchor still resolves in the doc. */
    headingText: z.string().optional(),
    /** False when the claim's anchor no longer exists in the live doc. */
    anchorLive: z.boolean(),
    coverage: GuardClaimCoverageSchema,
    /** Why the claim reached no flow — present exactly for `gapped`. */
    gapReason: z.string().optional(),
    /** True when a `decisions.json` dismissal names this claim. */
    dismissed: z.boolean(),
    flows: z.array(GuardClaimFlowRefSchema),
    scenarios: z.array(GuardClaimScenarioRefSchema),
  })
  .strict()
export type GuardClaimRow = z.infer<typeof GuardClaimRowSchema>

/** One refused statement, as the Claims tab lists it under its doc. */
export const GuardUntestableRowSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    text: z.string(),
    reason: z.string(),
    headingText: z.string().optional(),
    anchorLive: z.boolean(),
  })
  .strict()
export type GuardUntestableRow = z.infer<typeof GuardUntestableRowSchema>

/**
 * The Claims tab payload — the extracted claim corpus with the trace from claim
 * to flow to scenario, and the refused statements beside it. Always answers (an
 * `extracted: false` view is the empty state, never an error).
 */
export const GuardClaimsViewSchema = z
  .object({
    /** False when no claims store exists — the client renders its empty state. */
    extracted: z.boolean(),
    generatedAt: z.string().nullable(),
    claims: z.array(GuardClaimRowSchema),
    untestable: z.array(GuardUntestableRowSchema),
    totals: z
      .object({
        claims: z.number().int().nonnegative(),
        proven: z.number().int().nonnegative(),
        planned: z.number().int().nonnegative(),
        gapped: z.number().int().nonnegative(),
        unplanned: z.number().int().nonnegative(),
        dismissed: z.number().int().nonnegative(),
        untestable: z.number().int().nonnegative(),
        /** Claims whose anchor no longer resolves in its live doc. */
        orphanedAnchors: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
export type GuardClaimsView = z.infer<typeof GuardClaimsViewSchema>
