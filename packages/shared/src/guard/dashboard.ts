/**
 * Derived guard read-surface DTOs the dashboard renders — the per-section
 * coverage join, the flow inventory and its detail, the journey catalog, the
 * staleness probe, and a scenario's YAML source. These are *computed* on read
 * (never persisted, never validated back); the persisted, validated stores are
 * `result.ts` (run), `report.ts` (generate report), `manifest.ts`, `flows.ts`
 * (the flow corpus) and `../journeys.ts` (the journey catalog).
 *
 * The read surfaces added with the flow model carry Zod schemas so the client can
 * validate a response it did not compose; the older coverage/staleness shapes stay
 * plain TypeScript interfaces (unchanged wire contract).
 *
 * The server composes these from the store files (`scenarios/flows.json`,
 * `scenarios/manifest.json`, `guard/LATEST.json`, `guard/result.json`,
 * `guard/journeys.json`) plus the live spec doc; the client consumes them as the
 * wire types for the Guard tabs (Coverage, Flows, Journeys, Runs).
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
import { GuardAutoResolvedAttemptSchema } from './auto-resolutions.js'
import type { GuardGapDisplayKind } from './report.js'
import type { GuardScenarioStepView } from './scenario.js'
import type { GuardScenarioStory } from './describe.js'
import { GuardNeedsSetupSchema } from './needs-setup.js'
import type { GuardNeedsSetup } from './needs-setup.js'
import { JourneyCatalogSourceSchema, JourneyEntrySchema, JourneyStepSchema } from '../journeys.js'

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
  | 'needs-setup'
  | 'authoring-error'
  | 'unguarded'

/**
 * Every coverage status in WORST-FIRST precedence — the ONE order every rollup
 * uses (surface → flow → section). It encodes the read model's tiers:
 *
 *   1. run outcomes — a result always outranks a generate-time verdict, so a
 *      section that ran paints its run (even a `pass`) and never a sibling gap;
 *   2. `guarded` — generated but absent from the current run;
 *   2b. `authoring-error` — generate tried and could not produce a test. It is a
 *      FAILURE of the engine, not a verdict about the repo, so it sits above every
 *      gap (a gap is a settled answer; this is an unanswered question) and below
 *      the run outcomes and `guarded` (anything that actually produced a test
 *      outranks something that produced nothing);
 *   3. gaps, MOST ACTIONABLE first, then "could not test" before "nothing to
 *      test": `needs-setup` → `blocked-on` → `unrealizable` → `no-journey` → the
 *      awaiting-driver ids (registry order) → `untestable` → `no-claim` →
 *      `dismissed`. `needs-setup` leads its tier because it is the one gap a user
 *      can clear today (provide the account, re-generate); it stays BELOW the run
 *      outcomes because a section that ran paints its run, always;
 *   4. `unguarded` — nothing binds it at all.
 */
export const GUARD_COVERAGE_STATUS_PRECEDENCE = [
  'fail',
  'error',
  'stale',
  'orphaned',
  'pass',
  'guarded',
  'authoring-error',
  'needs-setup',
  'blocked-on',
  'unrealizable',
  'no-journey',
  'retired',
  ...awaitingDriverIds,
  'untestable',
  'no-claim',
  'dismissed',
  'unguarded',
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
    /** One-line display label (`awaiting web driver`, `no journey`). */
    label: z.string(),
    /**
     * Present iff `kind === 'blocked-on'` AND the gap names an external service
     * the user can provide — the read-model promotion to `needs-setup`. Additive
     * and optional: a payload written before the promotion existed, or one composed
     * without externals data, simply carries no field and reads as plain blocked.
     */
    needsSetup: GuardNeedsSetupSchema.optional(),
    /**
     * Present on a `retired` gap when the ledger still holds the retirement —
     * the retired attempts' verdicts the flow detail exposes. Server-joined off
     * the gitignored `guard/auto-resolutions.json`, so a hosted view (or a repo
     * whose ledger was deleted) simply carries none and the gap reads plain.
     */
    retirement: z
      .object({
        attempts: z.number().int().positive(),
        retiredAt: z.string(),
        history: z.array(GuardAutoResolvedAttemptSchema),
      })
      .strict()
      .optional(),
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
    /** True when the run flagged journey drift on this scenario (never an outcome). */
    journeyDrifted: z.boolean().optional(),
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
 * them (the primary rendering), its STORY in plain sentences, and the raw YAML
 * behind both. `steps` is empty (and `story` absent) when the file doesn't parse
 * as a known driver — the detail then shows the source alone rather than a
 * half-rendered guess. Both renderings are derived SERVER-SIDE from the parsed
 * file, so the dashboard and the CLI read one source.
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
  /** The same file told in plain words — the detail's Story mode. */
  story?: GuardScenarioStory
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
 * The preparation-recipe card for the Scenarios tab — the committed
 * `recipe.json` (`{ build, entry, serve, services, env }`) plus its current working-tree inputs
 * fingerprint and a staleness signal. `stale` compares the current fingerprint
 * to the last run's recorded `recipeFingerprint` (the only stored baseline);
 * it is `null` when there is no run to compare against.
 */
export interface GuardRecipeCard {
  /** Shell command run once to produce the entrypoint/server. */
  build: string
  /** Entrypoint argv (cli driver); null on an api-only recipe. */
  entry: string[] | null
  /**
   * Serve argv (api driver) of the DEFAULT server; null when the recipe has no
   * `api` block. A multi-server recipe reports its default server here
   * and the full inventory in {@link servers} — so a card written before servers
   * existed reads exactly the same.
   */
  serve: string[] | null
  /**
   * Every HTTP service the recipe declares, in name order: `null` for a
   * single-server (or api-less) recipe, so the card only grows a server list when
   * there is more than one story to tell.
   */
  servers?: { name: string; serve: string[]; app?: string }[] | null
  /**
   * One-shot datastore orchestration (`api.services`): `up` runs in the repo root
   * once per run before any api scenario (e.g. `docker compose up -d --wait`),
   * `down` after the last one. Null when the recipe declares none.
   */
  services: { up: string; down?: string } | null
  /** Recipe-level env the sandbox inherits; null when none is declared. */
  env: Record<string, string> | null
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
    /** True when the last run flagged journey drift on any of the flow's scenarios. */
    journeyDrifted: z.boolean(),
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
    journeyDrifted: z.boolean().optional(),
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
    /** Journey ids this scenario grounds on (its realization path, in order). */
    journeyPath: z.array(z.string()).default([]),
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
 * the per-surface scenario rows, the realization journeys, the gaps, and the
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
    /** Journey ids the flow's scenarios ground on, first-seen order. */
    journeyIds: z.array(z.string()),
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
// Journeys tab — the code-side catalog (the free Map action's read surface).
// ---------------------------------------------------------------------------

/**
 * One flow that USES a journey — the reverse-index entry.
 *
 * `realized: false` is the case a plain scenario-derived index cannot see: the
 * flow's realization plan walked this journey, but no scenario was written for
 * that surface (authoring was blocked on setup the repo hasn't declared). The
 * spec DOES reach the code path; it just cannot be exercised yet, and `gap` says
 * what it is waiting on.
 */
export const GuardJourneyFlowRefSchema = z
  .object({
    flowId: z.string(),
    /** The flow's title; its id when no flows corpus names it (hand-written work). */
    title: z.string(),
    /** True when a committed scenario of this flow grounds on the journey. */
    realized: z.boolean(),
    /** Why an unrealized usage produced no scenario. Absent when realized. */
    gap: GuardFlowGapSchema.optional(),
  })
  .strict()
export type GuardJourneyFlowRef = z.infer<typeof GuardJourneyFlowRefSchema>

/** One journey row: the catalog entry plus the reverse index onto the flows. */
export const GuardJourneyRowSchema = z
  .object({
    id: z.string(),
    /** The surface — a driver-registry id. */
    type: GuardDriverIdSchema,
    title: z.string(),
    entry: JourneyEntrySchema,
    steps: z.array(JourneyStepSchema),
    fingerprint: z.string(),
    /**
     * Flows that use this journey — realized (a scenario grounds on it) or merely
     * planned (matched, then blocked). EMPTY is the only honest "the spec never
     * mentions this code path", and the single source for the row's flow count.
     */
    flows: z.array(GuardJourneyFlowRefSchema),
    /** The scenarios that ground on it. */
    scenarioIds: z.array(z.string()),
    /** How this surface's catalog was derived (`tree` | `probes`). */
    source: JourneyCatalogSourceSchema.optional(),
    /** Declared in an OpenAPI doc, but no route registration serves it. */
    specOnly: z.literal(true).optional(),
  })
  .strict()
export type GuardJourneyRow = z.infer<typeof GuardJourneyRowSchema>

/**
 * One chip of the detected-surface banner: a driver-registry row with what the
 * mapping found for it. `detected` answers "does TrueCourse think my app has this
 * surface"; `runnable` answers "can we run scenarios on it today".
 */
export const GuardJourneySurfaceSchema = z
  .object({
    surface: GuardDriverIdSchema,
    label: z.string(),
    runnable: z.boolean(),
    /** UI copy for a non-runnable surface ("Needs web driver"). */
    waitingLabel: z.string().optional(),
    /** Journeys mapped for this surface. */
    journeys: z.number().int().nonnegative(),
    detected: z.boolean(),
    source: JourneyCatalogSourceSchema.optional(),
  })
  .strict()
export type GuardJourneySurface = z.infer<typeof GuardJourneySurfaceSchema>

/**
 * The Journeys-tab payload. `mapped: false` is the clean empty state (no
 * `guard/journeys.json` yet) — every list is empty and the banner still carries a
 * row per registry driver, so the tab renders its Map CTA without a null check.
 */
export const GuardJourneysViewSchema = z
  .object({
    /** False when no catalog snapshot exists — the client renders the Map CTA. */
    mapped: z.boolean(),
    generatedAt: z.string().nullable(),
    /** The recipe fingerprint the mapping ran against. */
    recipeFingerprint: z.string().nullable(),
    journeys: z.array(GuardJourneyRowSchema),
    /** One row per driver-registry surface (the banner), registry order. */
    surfaces: z.array(GuardJourneySurfaceSchema),
    totals: z
      .object({
        journeys: z.number().int().nonnegative(),
        detectedSurfaces: z.number().int().nonnegative(),
        /** Journeys at least one flow uses (realized or planned-but-blocked). */
        grounded: z.number().int().nonnegative(),
        /** Journeys NO flow references at all — the future infer signal. */
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
export type GuardJourneysView = z.infer<typeof GuardJourneysViewSchema>
