import {
  FlowTestCopyDriftSchema,
  FlowTestDisagreementSchema,
  FlowTestRunSchema,
  FlowTestStatusSchema,
  type FlowTestStatus,
} from './flow-tests.js'
import { GuardBlockerSchema, GuardObligationRefSchema } from './verification.js'
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
 * `guard/interfaces.json`) plus the live spec doc; the client consumes them as
 * the wire types the repository's Runs / Pipeline / Interfaces views and the
 * workspace's Flows and Context pages read.
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
  InterfaceOriginSchema,
  InterfaceResourceSchema,
  InterfaceStateSchema,
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
 *  - `unguarded` — nothing carries the claim (no flow, no gap, no verdict).
 */
export type GuardCoverageStatus =
  | GuardOutcome
  | GuardGapDisplayKind
  | 'guarded'
  | 'never-run'
  | 'needs-setup'
  | 'authoring-error'
  | 'unguarded'

/**
 * Every coverage status in WORST-FIRST precedence — the ONE order every rollup
 * uses after flow alternatives are resolved (surface → flow → section).
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
] as const satisfies readonly GuardCoverageStatus[]

// Compile-time backstop: a new status (a new outcome, driver, or gap kind) that
// nobody ranked would make `_UnrankedStatus` non-`never` and fail the build — a
// rollup can never silently mis-order an unknown status.
type _UnrankedStatus = Exclude<
  GuardCoverageStatus,
  (typeof GUARD_COVERAGE_STATUS_PRECEDENCE)[number]
>
const _allStatusesRanked: _UnrankedStatus extends never ? true : never = true
void _allStatusesRanked

/** The coverage-status union as a Zod enum (the precedence list is the domain). */
export const GuardCoverageStatusSchema = z.enum(
  GUARD_COVERAGE_STATUS_PRECEDENCE as unknown as [
    GuardCoverageStatus,
    ...GuardCoverageStatus[],
  ],
)

/**
 * The worst status of a set, by {@link GUARD_COVERAGE_STATUS_PRECEDENCE} — the
 * single rollup used for a flow (over its surfaces) and a section (over its
 * flows). An empty set is `unguarded`; an unknown value ranks last.
 */
export function worstCoverageStatus(
  statuses: readonly GuardCoverageStatus[],
): GuardCoverageStatus {
  let best: GuardCoverageStatus = 'unguarded'
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
// THE COVERAGE VOCABULARY — six words, and only these six.
// ---------------------------------------------------------------------------

/**
 * What a reader is told about coverage: a doc section, a flow, an overview
 * counter, a filter and a chip each wear exactly ONE of these six, everywhere.
 *
 *  - `succeeded` — the claims' scenarios passed;
 *  - `partially-succeeded` — a flow's test ran to its end and passed, but only
 *    after its author HEALED around something that is not the product failing: a
 *    control the documents name one way and the product another (copy drift).
 *    What was healed is on the test. Only a flow wears it: no wire status folds
 *    onto it, so a section or a document never does ({@link guardFlowPlainStatus});
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
 * The wire keeps its richer status ids ({@link GuardCoverageStatus}); they
 * decide COLOUR, ordering, and the sentence a detail row shows. They are never
 * the word. Scenario-level RUN verdicts keep their own pass/fail wording — these
 * five are the coverage vocabulary, not the verdict vocabulary.
 */
export type GuardCoveragePlainStatus =
  | 'failed'
  | 'blocked'
  | 'never-run'
  | 'partially-succeeded'
  | 'succeeded'
  | 'not-testable'

/**
 * The six in SEVERITY order — worst first, and the order every counter, filter
 * and legend lists them in. `partially-succeeded` sits just above `succeeded`:
 * the flow is proven, and something beside it is a reader's to fix.
 * `not-testable` is last on purpose: it is the one status that is nobody's
 * to-do, so it surfaces only when nothing else applies.
 */
export const GUARD_COVERAGE_PLAIN_ORDER = [
  'failed',
  'blocked',
  'never-run',
  'partially-succeeded',
  'succeeded',
  'not-testable',
] as const satisfies readonly GuardCoveragePlainStatus[]

/** The six words as a wire value, for the payloads that carry one. */
export const GuardCoveragePlainStatusSchema = z.enum([...GUARD_COVERAGE_PLAIN_ORDER])

/** The ONE word per status. Nothing else may name a coverage state to a reader. */
export const GUARD_COVERAGE_STATUS_WORD: Record<GuardCoveragePlainStatus, string> = {
  succeeded: 'Succeeded',
  'partially-succeeded': 'Partially succeeded',
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
const COVERAGE_PLAIN: Record<GuardCoverageStatus, GuardCoveragePlainStatus> = {
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
  status: GuardCoverageStatus,
): GuardCoveragePlainStatus {
  return COVERAGE_PLAIN[status] ?? 'blocked'
}

/** The one WORD a wire status wears on a coverage surface. */
export function guardCoverageWord(status: GuardCoverageStatus): string {
  return GUARD_COVERAGE_STATUS_WORD[guardCoveragePlainStatus(status)]
}

/**
 * The worst of several coverage statuses, as its word-bearing status —
 * {@link worstCoverageStatus} read through the five. The empty set is `blocked`
 * (nothing accounts for it), matching `unguarded`'s own word.
 */
export function worstCoveragePlainStatus(
  statuses: readonly GuardCoverageStatus[],
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

/**
 * Why a flow has no scenario on one surface — the manifest/report gap, with the
 * label every surface renders (see `guardGapLabel`).
 */
export const GuardFlowGapSchema = z
  .object({
    kind: GuardCoverageGapKindSchema,
    obligations: z.array(GuardObligationRefSchema).min(1).optional(),
    milestones: z.array(z.number().int().positive()).min(1).optional(),
    /** The generator's one-line explanation. */
    reason: z.string(),
    blocker: GuardBlockerSchema.optional(),
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
    status: GuardCoverageStatusSchema,
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
    /** This attempt asserts every milestone using an accepted driver. Unknown for legacy records. */
    coverageComplete: z.boolean().optional(),
    /** The gap remains visible, but another successful scenario proves the entire flow. */
    coveredByAlternative: z.boolean().optional(),
    gap: GuardFlowGapSchema.optional(),
  })
  .strict()
export type GuardFlowSurface = z.infer<typeof GuardFlowSurfaceSchema>

/**
 * A flow as a CLAIM lists it: the flow traverses the claim at one or more of its
 * milestones, and a reader goes from the claim to the flows that test it, never
 * straight to scenarios (those are reached through the flow, one further click).
 */
export const GuardClaimFlowSchema = z
  .object({
    flowId: z.string(),
    title: z.string(),
    /** Worst applicable status after complete alternative proofs are accounted for. */
    status: GuardCoverageStatusSchema,
    /** The gap text behind `status`, when a gap decided it. */
    reason: z.string().optional(),
    /** The providable services behind a `needs-setup` status. */
    needsSetup: GuardNeedsSetupSchema.optional(),
    /** True for an epic flow (it chains other flows through `composedOf`). */
    epic: z.boolean(),
    /** True for the Manual pseudo-flow of a hand-written scenario. */
    manual: z.boolean(),
    /** 1-based orders of the milestones that prove THIS claim. */
    milestoneOrders: z.array(z.number().int().positive()),
    /** Milestones in the whole flow — the chain the flow detail paints. */
    milestoneCount: z.number().int().nonnegative(),
    surfaces: z.array(GuardFlowSurfaceSchema),
  })
  .strict()
export type GuardClaimFlow = z.infer<typeof GuardClaimFlowSchema>

/**
 * The amber-dot signal the Pipeline view and Context's Scan button read, and
 * the pipeline-stage flags beside it:
 *  - `runStale` — the scenarios are newer than the last `guard run` (a re-run would
 *    re-test), or scenarios exist and nothing was ever run.
 */
export interface GuardStaleness {
  runStale: boolean
  hasScenarios: boolean
  hasGenerated: boolean
  hasRun: boolean
}

/**
 * The ref-scoped `/guard/latest?ref=<commit>` response: the run stored at that
 * exact commit, never the baseline. `null` when the store holds no run there.
 */
export interface GuardLatestResponse {
  /** The run, with its flow join ({@link GuardLatestWithRunFlows}) when served. */
  latest: GuardLatestWithRunFlows | null
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
 * mode). `steps` is empty when the file doesn't parse — the detail then shows the
 * source alone rather than a half-rendered guess. The step list is derived
 * SERVER-SIDE from the parsed file, so the parse happens in one place, and each
 * row names its own driver ({@link GuardScenarioStepView.kind}).
 */
export interface GuardScenarioSource {
  id: string
  /** Repo-relative path of the YAML file. */
  file: string
  /** Raw YAML text. */
  content: string
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
 * One row in the Tests inventory — every committed scenario, generated OR
 * hand-written, joined from the loaded corpus and the manifest. The last-run
 * outcome and any orphaned flag are joined client-side from the run store, so
 * they are NOT part of this row (which stays run-independent — the inventory
 * renders from the stored set before any run).
 */
export interface GuardScenarioListItem {
  id: string
  title: string
  /** Repo-relative spec doc the scenario binds to. */
  doc: string
  /** Slugified heading path the scenario binds to (`binds.section`). */
  anchor: string
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
  /**
   * The drivers its STEPS exercise, in registry order — several for a scenario that
   * spans surfaces. Empty only for a row recovered without its file.
   */
  drivers: GuardDriverId[]
  /**
   * The status the last generate COMMITTED the test with — `failing` for a test
   * that failed its birth execution (committed anyway: the doc and the code
   * disagree), else `passing`. It makes the inventory renderable without a run:
   * the stored set lists its red tests as red. A run outcome, joined
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
 * The Tests payload — the recipe card plus the committed-scenario inventory.
 * One envelope so the surface has a single read (the recipe rides the scenarios
 * response rather than a separate endpoint).
 */
export interface GuardScenarioInventory {
  recipe: GuardRecipeCard | null
  scenarios: GuardScenarioListItem[]
  /**
   * The commit the inventory was read at; absent when the repo has no stored
   * set.
   */
  scenariosCommit?: string
}

// ---------------------------------------------------------------------------
// Flows tab — the inventory drill-down (replaces the flat Scenarios list).
// ---------------------------------------------------------------------------

/** A flow's coverage bucket, the same one the Flows list counts by. */
export const GuardFlowBucketSchema = z.enum(['guarded', 'partial', 'blocked', 'ungenerated'])
export type GuardFlowBucket = z.infer<typeof GuardFlowBucketSchema>

/** One row of the Flows-tab list — a flow joined to the manifest, run, and report. */
/** Execution and verified coverage answer separate questions. */
export const GuardFlowProgressSchema = z.object({
  execution: z.enum(['passed', 'failed', 'error', 'blocked', 'not-run', 'not-generated']),
  scenarios: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  coverage: z.enum(['complete', 'partial', 'unverified', 'unknown']),
  verified: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  unit: z.enum(['cases', 'milestones']),
  category: z.enum(['behavior', 'system', 'mixed']),
  generation: z.enum(['ready', 'incomplete', 'error', 'unsupported', 'needs-setup']),
}).strict()
export type GuardFlowProgress = z.infer<typeof GuardFlowProgressSchema>

/**
 * The wire status a flow wears for what its Playwright test says, so a flow
 * proven by a test reads through the same words as every other flow.
 */
export function flowTestCoverageStatus(status: FlowTestStatus): GuardCoverageStatus {
  return status === 'passing' ? 'pass' : status === 'failing' ? 'fail' : 'blocked-on'
}

/** What a flow's Playwright test says about it, as far as a list row tells it. */
export const GuardFlowTestMarkSchema = z
  .object({
    status: FlowTestStatusSchema,
    /** True when the test creates its own starting data through a seed. */
    seeded: z.boolean(),
    /** A failing test: what the documents say, and what the product did instead. */
    documented: z.string().optional(),
    observed: z.string().optional(),
    /** A blocked flow: the missing thing in a few words, the key blocked flows group by. */
    blockedOn: z.string().optional(),
    /** A blocked flow: the same thing as its test's session explained it, in full. */
    blockedBy: z.string().optional(),
    /** Names the documents have one way and the product another, which the test met. Absent when it met none. */
    copyDrift: z.array(FlowTestCopyDriftSchema).optional(),
  })
  .strict()
export type GuardFlowTestMark = z.infer<typeof GuardFlowTestMarkSchema>

/** A flow's Playwright test, whole: what it proved, its files, and the run that stands. */
export const GuardFlowTestViewSchema = z
  .object({
    status: FlowTestStatusSchema,
    summary: z.string(),
    disagreement: FlowTestDisagreementSchema.optional(),
    blockedBy: z.string().optional(),
    blockedOn: z.string().optional(),
    copyDrift: z.array(FlowTestCopyDriftSchema).optional(),
    spec: z.object({ file: z.string(), content: z.string() }).optional(),
    seed: z.object({ file: z.string(), content: z.string() }).optional(),
    run: FlowTestRunSchema.optional(),
  })
  .strict()
export type GuardFlowTestView = z.infer<typeof GuardFlowTestViewSchema>

export const GuardFlowListItemSchema = z
  .object({
    flowId: z.string(),
    progress: GuardFlowProgressSchema.optional(),
    title: z.string(),
    /** One-line user goal; empty for a Manual pseudo-flow (a scenario has no goal). */
    goal: z.string(),
    /** Worst applicable status after complete alternative proofs are accounted for. */
    status: GuardCoverageStatusSchema,
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
    /**
     * True when the repository's decisions ledger dismisses this flow: the next
     * generate drops it with its tests. The one reading of the ledger every
     * surface marks a flow from. Defaulted so a payload without it parses.
     */
    dismissed: z.boolean().default(false),
    /** Why it was dismissed, when the person who did it said. */
    dismissalNote: z.string().optional(),
    /** Present when the flow is proven by a Playwright test rather than scenarios. */
    test: GuardFlowTestMarkSchema.optional(),
  })
  .strict()
export type GuardFlowListItem = z.infer<typeof GuardFlowListItemSchema>

/**
 * A flow's coverage status in the six words — the ONE derivation every flow
 * list reads, so no two of them can disagree about a flow.
 *
 * PARTIALLY SUCCEEDED is a flow whose Playwright test passes and carries copy
 * drift: it reached its end because its author used the product's name for a
 * control the documents call something else. A FAILING test that met copy
 * drift is Failed, as any failing test is: the drift is on its page.
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
  flow: Pick<GuardFlowListItem, 'status' | 'bucket' | 'findings'> & {
    /** The flow's Playwright test, when it has one: its status and what it healed around. */
    test?: Pick<GuardFlowTestMark, 'status' | 'copyDrift'>
  },
): GuardCoveragePlainStatus {
  if (flow.findings > 0) return 'failed'
  if (flow.bucket === 'ungenerated') return 'blocked'
  const word = guardCoveragePlainStatus(flow.status)
  return word === 'succeeded' && flow.test?.status === 'passing' && flow.test.copyDrift?.length ? 'partially-succeeded' : word
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
 * The Flows payload — the flow inventory plus the preparation-recipe card the
 * page inherited from the Tests inventory. ONE read per surface (the recipe rides along,
 * the same convention `GuardScenarioInventory` follows). The findings block and
 * dismissed chips come from `/guard/report` and `/guard/decisions` as before.
 */
export interface GuardFlowsView extends z.infer<typeof GuardFlowsViewCoreSchema> {
  recipe: GuardRecipeCard | null
}

/** One milestone of a flow: the claim it proves and where the claim is stated. */
export const GuardFlowMilestoneViewSchema = z
  .object({
    order: z.number().int().positive(),
    doc: z.string(),
    anchor: z.string(),
    claimTitle: z.string(),
    /** The id of the claim this milestone proves, when the corpus holds it. */
    claimId: z.string().optional(),
    /** Synthesis' note on why this step sits here. */
    note: z.string().optional(),
    /**
     * The milestone's CASES — the situations that would prove it, each as the
     * sentence it states. No per-case state: a flow's cases stand or fall
     * together, and the flow's own verdict says which. Absent on a milestone
     * that declares none (the legacy shape).
     */
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            /** The case's own sentence, never its machine id. */
            claim: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
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
    status: GuardCoverageStatusSchema,
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
     * from the last generate's finding, else from the diagnosis stored with the
     * test in the scenario set (which outlives any one generate report).
     */
    triage: GuardTriageSchema.optional(),
    /**
     * True when the run recorded an evidence bundle for this row (so the detail can
     * render the transcript open). The flag says "the run wrote one", not "it is
     * still stored" — the fetch can still 404.
     */
    hasEvidence: z.boolean(),
    /** Interface ids this scenario grounds on (its realization path, in order). */
    interfacePath: z.array(z.string()).default([]),
    /** This attempt asserts every milestone using an accepted driver. Unknown for legacy records. */
    coverageComplete: z.boolean().optional(),
    /** The gap remains visible, but another successful scenario proves the entire flow. */
    coveredByAlternative: z.boolean().optional(),
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
    progress: GuardFlowProgressSchema.optional(),
    title: z.string(),
    goal: z.string(),
    status: GuardCoverageStatusSchema,
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
    /**
     * True when the repository's decisions ledger dismisses this flow: the next
     * generate drops it with its tests. The one reading of the ledger every
     * surface marks a flow from. Defaulted so a payload without it parses.
     */
    dismissed: z.boolean().default(false),
    /** Why it was dismissed, when the person who did it said. */
    dismissalNote: z.string().optional(),
    /** Why it left the corpus, when the reconciliation that retired it said. */
    orphanedReason: z.string().optional(),
    generatedAt: z.string().nullable(),
    runId: z.string().nullable(),
    ranAt: z.string().nullable(),
    /** Present when the flow is proven by a Playwright test rather than scenarios. */
    test: GuardFlowTestViewSchema.optional(),
  })
  .strict()
export type GuardFlowDetail = z.infer<typeof GuardFlowDetailSchema>

/**
 * ONE entity's own slice of the JSON store file that holds it — the RAW half of
 * the two readings an artifact-backed entity offers (View + the artifact).
 * Pretty-printed server-side from the real file, so the pane shows what is
 * actually stored rather than a re-serialization of the view model.
 */
export interface GuardArtifactSource {
  /** The entity's id, echoed back — what the slice was selected by. */
  id: string
  /** Repo-relative path of the store file the slice came out of. */
  file: string
  /** The entity's entry, pretty-printed JSON. */
  content: string
}

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
    /**
     * The flow's own coverage status, the SAME derivation the Flows list shows
     * for it ({@link guardFlowPlainStatus}) — so an interface can never report a
     * flow as passing that the Flows page reports as blocked.
     */
    status: GuardCoveragePlainStatusSchema,
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
    /** The resource the task acts ON, as its area's resource id — verbatim
     *  (the registry describing the place travels on the VIEW, so the panel can
     *  group by place and the pane can render the place's readables). */
    at: z.string().optional(),
    /** The resource the task leaves the user at, when it moves them — verbatim. */
    to: z.string().optional(),
    /** The place that OWNS this invocable — the command group it is registered
     *  in, the REST noun its path names — verbatim, resolving in the same
     *  registry `at`/`to` do. Absent where the catalog established no places. */
    resource: z.string().optional(),
    fingerprint: z.string(),
    /**
     * Flows that use this interface — realized (a scenario grounds on it) or merely
     * planned (matched, then blocked). EMPTY is the only honest "the spec never
     * mentions this code path", and the single source for the row's flow count.
     */
    flows: z.array(GuardInterfaceFlowRefSchema),
    /** The scenarios that ground on it. */
    scenarioIds: z.array(z.string()),
    /**
     * How this surface's catalog was derived (`tree` | `probes`) — absent for a
     * surface no derivation produced, which is exactly what `origin` names.
     */
    source: InterfaceCatalogSourceSchema.optional(),
    /**
     * WHERE THIS ROW CAME FROM — `derived` (a mapping read it off the tree) or
     * `authored` (a human wrote it in `guard/interfaces.authored.json`). Stamped
     * by the merge that joins the catalog's two halves, so it is a fact about
     * this ENTRY rather than about its area: an authored operation shadowing a
     * derived one sits inside a `tree`-derived surface and still says so, which
     * no per-area `source` value could ever express.
     */
    origin: InterfaceOriginSchema.optional(),
    /** Declared in an OpenAPI doc, but no route registration serves it. */
    specOnly: z.literal(true).optional(),
    /**
     * The full public contract, in this entry's OWN surface vocabulary — a cli
     * command's grammar and io, or an api operation's request/consumes/produces.
     * Passed through from the catalog verbatim; absent where the derivation
     * established the surface's shape only, which is exactly what the view
     * renders as "no contract derived yet".
     */
    contract: InterfaceContractSchema.optional(),
    /**
     * The api interfaces this entry's steps CALL, by id — the UI-to-API relation,
     * passed through from the catalog verbatim. Ids, not shapes: a reader joins
     * them against the catalog's own api rows (the pane mints `noun.method()`
     * from the joined entry, and shows the raw id when nothing resolves).
     *
     * The absence rule of the catalog holds here too and both halves are real
     * answers: OMITTED = the derivation established nothing, `[]` = it
     * established NONE (an interaction that reaches no server at all).
     */
    apiEffects: z.array(z.string()).optional(),
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
    /**
     * PLACES mapped for this surface — the registry's entries for this area.
     *
     * Counted beside the interfaces because since the web derivation landed the
     * two can disagree: the `web` surface derives its places off the routing tree
     * and its tasks not at all, so a mapped web app is N places and ZERO
     * interfaces. Reading the row by its interface count alone would report that
     * repo as "no web surface found", which is the opposite of what happened.
     */
    resources: z.number().int().nonnegative(),
    /** Did the mapping find this surface AT ALL — either half of it. */
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
    /**
     * The RESOURCE REGISTRY, per area — the catalog's own, verbatim: the places
     * the rows' `at`/`to` name, each with its kind, title and readables. On the
     * view (not per row) because a place is defined ONCE and many rows point at
     * it; the panel joins ids to titles, the pane renders the open row's place.
     * Absent where the catalog names none (cli/api-only catalogs).
     */
    resources: z.record(z.string(), z.array(InterfaceResourceSchema)).optional(),
    /**
     * The STATE REGISTRY, per area — the catalog's own, verbatim: the worlds the
     * rows' `startingState`/`endState` name, each with the one line that says
     * what it is. On the view for the same reason `resources` is: a state is
     * defined ONCE and many rows reference it. Absent where the catalog names
     * none, and a row whose state id the registry does not carry still renders
     * its id — the id is the fact, the description is the gloss.
     */
    states: z.record(z.string(), z.array(InterfaceStateSchema)).optional(),
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

// --- Claims --------------------------------------------------------------------

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
    /**
     * The scenario's verdict in the latest run, when one ran it. Absent when the
     * scenario has never executed (or the view was built with no run store).
     */
    outcome: GuardOutcomeSchema.optional(),
  })
  .strict()
export type GuardClaimScenarioRef = z.infer<typeof GuardClaimScenarioRefSchema>

/**
 * One claim with its coverage: what a document promises, and what stands behind
 * it. The STATUS is the worst over the flows that carry the claim, by
 * {@link GUARD_COVERAGE_STATUS_PRECEDENCE}; a claim no flow carries wears the
 * kind the flow corpus's `noFlowClaims` reason states, or `unguarded` when
 * nothing accounts for it; a dismissed claim wears `dismissed`. The flows are
 * the trace a reader follows to the tests.
 */
export const GuardClaimRowSchema = z
  .object({
    id: z.string(),
    doc: z.string(),
    title: z.string(),
    claim: z.string(),
    contentHash: z.string(),
    verifyVia: z.string().optional(),
    status: GuardCoverageStatusSchema,
    /** The gap text or dismissal note behind `status`, when one decided it. */
    reason: z.string().optional(),
    /** The providable services behind a `needs-setup` status. */
    needsSetup: GuardNeedsSetupSchema.optional(),
    /** True when the decisions ledger dismisses this claim. */
    dismissed: z.boolean(),
    flows: z.array(GuardClaimFlowSchema),
    scenarios: z.array(GuardClaimScenarioRefSchema),
  })
  .strict()
export type GuardClaimRow = z.infer<typeof GuardClaimRowSchema>

/** One statement the scan read and judged untestable, with its reason. */
export const GuardUntestableRowSchema = z
  .object({
    doc: z.string(),
    text: z.string(),
    reason: z.string(),
  })
  .strict()
export type GuardUntestableRow = z.infer<typeof GuardUntestableRowSchema>

/**
 * The claims payload — every claim of the repository's documents with its
 * status and its trace to flows and tests, the untestable statements beside
 * them, and the five-word tally. Always answers (an `extracted: false` view is
 * the empty state, never an error).
 */
export const GuardClaimsViewSchema = z
  .object({
    /** False when no claim corpus exists — the client renders its empty state. */
    extracted: z.boolean(),
    generatedAt: z.string().nullable(),
    claims: z.array(GuardClaimRowSchema),
    untestable: z.array(GuardUntestableRowSchema),
    totals: z
      .object({
        claims: z.number().int().nonnegative(),
        /** Every claim under the five coverage words; a dismissed claim counts as Not testable. */
        byStatus: z.record(GuardCoveragePlainStatusSchema, z.number().int().nonnegative()),
        dismissed: z.number().int().nonnegative(),
        untestable: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
export type GuardClaimsView = z.infer<typeof GuardClaimsViewSchema>

/**
 * A stored run's CLAIM SUMMARY: the coverage word every claim of the
 * repository's documents wore at that moment, keyed by {@link guardClaimRef}.
 * Statuses only, so a run's history costs a handful of bytes per claim.
 *
 * It is what makes history readable: a run snapshot says which SCENARIOS passed,
 * and turning that back into claims needs the claim corpus, the flows and the
 * manifest as they were. Written when the run is persisted, never guessed
 * afterwards. A run without one is simply absent from the trend.
 */
export type GuardRunClaimSummary = Record<string, GuardCoveragePlainStatus>

/**
 * ONE run's FLOW SUMMARY: every flow of the repository as the word it wore at
 * that moment, keyed by flow id. The flow twin of {@link GuardRunClaimSummary},
 * written beside it and for the same reason — a run snapshot says which
 * SCENARIOS passed, and turning that back into flows needs the manifest and the
 * corpus as they were. It is what Home's trend counts.
 */
export type GuardRunFlowSummary = Record<string, GuardCoveragePlainStatus>

/** The address of ONE claim of ONE document: `<docRef>#<claimId>`. */
export function guardClaimRef(doc: string, claimId: string): string {
  return `${doc}#${claimId}`
}

/** The document half of a {@link guardClaimRef} (a ref with no `#` is the doc). */
export function guardClaimRefDoc(claimRef: string): string {
  const cut = claimRef.indexOf('#')
  return cut === -1 ? claimRef : claimRef.slice(0, cut)
}
