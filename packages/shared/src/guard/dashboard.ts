/**
 * Derived guard read-surface DTOs the dashboard renders — the per-section
 * coverage join, the staleness probe, and a scenario's YAML source. These are
 * *computed* on read (never persisted, never validated back), so they are plain
 * TypeScript shapes rather than Zod schemas: the persisted, validated stores are
 * `result.ts` (report), `report.ts` (generate report), and `manifest.ts`.
 *
 * The server composes these from the store files (`scenarios/manifest.json`,
 * `guard/LATEST.json`, `guard/result.json`) plus the live spec doc; the client
 * consumes them as the wire types for the Guard tab (coverage view, staleness
 * dots, scenario detail).
 */

import type { GuardOutcome, GuardFailureDetail, GuardLatest } from './result.js'
import type { GuardGapDisplayKind, GuardTriageVerdict } from './report.js'
import type { GuardTestabilityVerdict } from './manifest.js'
import type { GuardScenario } from './scenario.js'

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
 *  - `finding` — the last generate left a birth finding on the section (it never
 *    settled; a human decision is pending);
 *  - `held` — the section is unsettled with ready-but-held scenarios and no
 *    active finding (its blocker was an authoring error);
 *  - `authoring-error` — the section's ONLY record is generate authoring errors
 *    (no findings, no ready scenarios): generate tried and failed, so it is NOT
 *    `unguarded` ("nothing ever tried"). Distinct id from the RUN outcome `error`
 *    — the two must never conflate in totals or meta;
 *  - `unguarded` — nothing binds the section (no scenario, no gap, no verdict).
 */
export type GuardSectionCoverageStatus =
  | GuardOutcome
  | GuardGapDisplayKind
  | 'guarded'
  | 'finding'
  | 'held'
  | 'authoring-error'
  | 'unguarded'

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

/** A birth finding projected onto its section for the coverage detail. */
export interface GuardSectionFinding {
  /** The finding's index in the generate report (the Scenarios-tab key derives from it). */
  index: number
  /** `fidelity` for a reviewer-flagged scenario; `birth` (or absent) otherwise. */
  kind?: 'birth' | 'fidelity'
  title: string
  step: number
  expected: string
  actual: string
  /** Repo-relative pointer into `guard/evidence/`, when a transcript was written. */
  evidencePath?: string
  /** The finding's Opus triage verdict, for the coverage row's verdict chip. Absent
   *  when the finding was never triaged (no triage runner / older report). */
  triageVerdict?: GuardTriageVerdict
}

/** A ready-but-held scenario projected onto its section for the coverage detail. */
export interface GuardSectionHeldScenario {
  id: string
  title: string
}

/**
 * A generate authoring error projected onto its section for the coverage detail —
 * the deduped error message plus how many attempts produced it (the report's
 * `errors[]` carries one entry per failed authoring attempt, so retries dedupe to a
 * single message with an `attempts` count).
 */
export interface GuardSectionAuthoringError {
  /** The deduped authoring-error message. */
  message: string
  /** How many attempts produced this message (retries collapse into one entry). */
  attempts: number
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
  /** The gap / untestable one-liner; present for gap and classification statuses. */
  reason?: string
  /** Capability nouns a `blocked-on` status names (parsed from `reason`). */
  blockedOnCapabilities?: string[]
  /** The section's testability verdict from the manifest, when it was classified. */
  classification?: GuardTestabilityVerdict
  /** Scenario ids bound to this section (from the run, else the manifest). */
  scenarioIds: string[]
  /** This section's birth findings from the last generate (status `finding`). */
  findings?: GuardSectionFinding[]
  /** Ready-but-held scenarios from the last generate (status `finding`/`held`). */
  heldScenarios?: GuardSectionHeldScenario[]
  /**
   * This section's generate authoring errors, deduped by message with attempt
   * counts. Present on status `authoring-error` (its sole record), and on
   * `finding`/`held` sections as blocker context (their unsettled blocker IS an
   * authoring error, joined by the same doc+anchor).
   */
  authoringErrors?: GuardSectionAuthoringError[]
  /** Per-scenario run results for this section from the last run (empty until run). */
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
  latest: GuardLatest | null
  pending: GuardGatePending | null
}

/** A scenario's raw YAML source, for the detail view. */
export interface GuardScenarioSource {
  id: string
  /** Repo-relative path of the YAML file. */
  file: string
  /** Raw YAML text. */
  content: string
  /**
   * The parsed scenario — present when `content` validates against the schema, so
   * the detail view can render the plain-words story (via `describeScenario`) and
   * the `claim` without re-parsing YAML client-side. Absent for a malformed but
   * id-matching file (the raw `content` still shows behind the toggle).
   */
  scenario?: GuardScenario
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
  /** True when no manifest section lists this id (authored by hand, not generated). */
  handWritten: boolean
}

/**
 * The preparation-recipe card for the Scenarios tab — the committed
 * `recipe.json` (`{ build, entry, env }`) plus its current working-tree inputs
 * fingerprint and a staleness signal. `stale` compares the current fingerprint
 * to the last run's recorded `recipeFingerprint` (the only stored baseline);
 * it is `null` when there is no run to compare against.
 */
export interface GuardRecipeCard {
  /** Shell command run once to produce the entrypoint. */
  build: string
  /** Entrypoint argv; scenario `run` argv is appended to this. */
  entry: string[]
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
