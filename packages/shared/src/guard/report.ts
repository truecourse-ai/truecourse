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
  type GuardDriverId,
} from './drivers.js'
import { DetectedExternalServiceSchema } from '../external-services.js'
import { GuardAutoResolutionSourceSchema } from './auto-resolutions.js'
import { OutputExcerptsSchema } from './excerpts.js'
// The per-stage transport tally lives with the LLM seam; imported from the
// node-free `tally` module so this schema stays browser-safe.
import { StageTransportTallySchema } from '../llm/tally.js'
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
 *  - `no-interface` — the surface's interface catalog is EMPTY: nothing was mapped
 *    that could serve the flow. Usually "the mapper can't see your code" (an
 *    extraction gap), and must never read as "your product lacks the feature".
 *  - `unrealizable` — the catalog is healthy, matching examined it, and no interface
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
  'no-interface',
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
     * The FLOW the gap belongs to, when it is a flow-level gap (`no-interface`,
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
export function gapDisplayKind(
  gap: Pick<GuardCoverageGap, 'kind' | 'driver'>,
): GuardGapDisplayKind | null {
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
 * The THREE triage verdicts — a standalone schema so the auto-resolution
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
 * test's own evidence (the interface transcript: steps, expected vs actual, raw
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
 * The DIAGNOSIS a failing test COMMITS with — recorded on its manifest
 * scenario entry, so it is part of the same commit as the red test itself and
 * survives every no-op or aborted generate by construction (an unchanged flow
 * carries its manifest entry forward wholesale). IDENTITY: the manifest scenario
 * `id` it rides on — one diagnosis per committed failing test, present whenever
 * `status === 'failing'` was written by a generate that records diagnoses (an
 * older entry carries none). The report's committed birth-finding rows are
 * RE-DERIVED from it at persist
 * ({@link carryForwardBirthFindings}), never carried from a prior report.
 *
 * It carries the failing interface-step identity (`step` + `failedMilestone`, and
 * the milestone's own `doc`/`anchor`/`claim`), expected vs actual, the raw output
 * excerpts, the evidence pointer, and the triage verdict — everything a reader
 * needs to explain the red test without `guard/result.json`. NOT `.strict()`: a
 * field a future generate adds is dropped by an older reader, never a parse
 * failure. The authored YAML is deliberately NOT here — the committed `.yaml`
 * file sits beside the manifest in the same commit.
 */
export const GuardScenarioDiagnosisSchema = z.object({
  /** The failing milestone's section — where the finding pivots. */
  doc: z.string(),
  anchor: z.string(),
  /** The scenario title — the claim the test was asserting. */
  title: z.string(),
  /** The failing milestone's extracted-claim text — the dismissal identity. */
  claim: z.string().optional(),
  /** 1-based failing step from the birth run. */
  step: z.number().int().positive(),
  expected: z.string(),
  actual: z.string(),
  /** The failing step's RAW program output, copied off the birth-run mismatch. */
  ...OutputExcerptsSchema.shape,
  /** Repo-relative pointer into `guard/evidence/`, when a transcript was written
   *  (gitignored — it may dangle for a cloner; the fields above stand alone). */
  evidencePath: z.string().optional(),
  /** Repo-relative path of the committed `.yaml`. */
  file: z.string(),
  /** The flow milestone the failing step realized (its 1-based `order`). */
  failedMilestone: z.number().int().positive().optional(),
  /** True when every milestone before {@link failedMilestone} passed. */
  priorMilestonesPassed: z.boolean().optional(),
  /** The triage verdict that committed this test (`code-drift` / `doc-drift`).
   *  Absent when the test committed untriaged (no runner, or a fail-soft call). */
  triage: GuardTriageSchema.optional(),
})
export type GuardScenarioDiagnosis = z.infer<typeof GuardScenarioDiagnosisSchema>

/**
 * A test's BIRTH-stage failure result — what the scenario asserted, what the code
 * actually did, and the evidence. Every failure is ROUTED by its triage verdict,
 * and this row records the outcome:
 *  - COMMITTED (`committed: true`, `scenarioId` + `file` naming it) — triage
 *    blamed the repo (`code-drift` / `doc-drift`) or produced no verdict: red
 *    drift, reproduced by `guard run`.
 *  - WITHHELD (`committed` absent) — a `generation-defect` verdict (the scenario
 *    is faulty — the auto-resolve re-author loop owns it) or a `fidelity` rejection;
 *    neither is ever written to the corpus, and the flow stays unsettled.
 * Setup-class failures never appear here at all — they settle through the
 * needs-setup/blocked machinery without a verdict.
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
     *    it weak/vacuous/miscast: it does not truly verify what its section claims.
     *    Never committed — "the test is wrong" is a re-author path, not a code
     *    disagreement. `actual` carries the reviewer's one-sentence stated
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
    /**
     * Set when the auto-resolve loop KEPT rejecting this flow's test: the
     * verdict said auto-resolve (a HIGH-confidence generation-defect, a
     * HIGH-confidence fidelity flag), but the flow has already auto-resolved
     * `count` times across generates without converging — so it is surfaced as a
     * human task with a "re-generation is not fixing this" note instead of being
     * auto-resolved again. The escalation guard against an infinite silent loop.
     * Optional — a flow that never recurred (or an older report) simply omits it.
     */
    autoResolveEscalation: z
      .object({ count: z.number().int().positive(), source: GuardAutoResolutionSourceSchema })
      .strict()
      .optional(),
  })
  .strict()
export type GuardBirthFinding = z.infer<typeof GuardBirthFindingSchema>

/**
 * One AUTO-RESOLVED ledger row — a high-confidence machine judgment the tool
 * acted on ITSELF instead of handing the user a task. A visible record,
 * never silence: nothing is discarded without an auditable trace, and every row
 * also bumps the durable `guard/auto-resolutions.json` count that eventually
 * escalates a non-converging flow to a human. Flow-keyed, like the ledger. A
 * discriminated union over `kind`:
 *  - `fidelity-discard` — a green test the fidelity reviewer flagged at HIGH
 *    confidence (weak/vacuous/miscast). Rather than record a rejection, the
 *    candidate is discarded and its FLOW re-authored ONCE (the accepted
 *    one-flow-call cost); `outcome` says what that produced.
 *  - `triage-resolve` — a failing test triage judged `generation-defect` at HIGH
 *    confidence: our scenario was bad, the flow's claims are fine, so the failure
 *    is retired to the ledger (never committed, never a task) and the flow
 *    re-attempts next generate with its author cache bypassed (the taint).
 */
export const GuardFidelityDiscardSchema = z
  .object({
    kind: z.literal('fidelity-discard'),
    flowId: z.string(),
    surface: GuardDriverIdSchema,
    /** The flow's primary binding — where coverage surfaces attribute it. */
    doc: z.string(),
    anchor: z.string(),
    /** The discarded scenario's title. */
    title: z.string(),
    /** The reviewer's high-confidence mismatch — why the scenario was discarded. */
    mismatch: z.string(),
    /**
     * What the single re-author produced:
     *  - `resolved` — a faithful, birth-passing replacement (committed).
     *  - `finding` — the replacement was flagged again or failed birth → routed
     *    like any other failure (committed drift or a withheld finding).
     *  - `unresolved` — no replacement survived (blocked, authoring or infra error).
     */
    outcome: z.enum(['resolved', 'finding', 'unresolved']),
  })
  .strict()
export type GuardFidelityDiscard = z.infer<typeof GuardFidelityDiscardSchema>

export const GuardTriageResolveSchema = z
  .object({
    kind: z.literal('triage-resolve'),
    flowId: z.string(),
    surface: GuardDriverIdSchema,
    /** The failing milestone's section — where the retired failure pivoted. */
    doc: z.string(),
    anchor: z.string(),
    /** The retired test's scenario title. */
    title: z.string(),
    /** The verdict that drove the auto-resolution (always `generation-defect`). */
    verdict: GuardTriageVerdictSchema,
    /** The triage brief — why the scenario was faulty; the reason on the record. */
    brief: z.string(),
  })
  .strict()
export type GuardTriageResolve = z.infer<typeof GuardTriageResolveSchema>

export const GuardAutoResolvedSchema = z.discriminatedUnion('kind', [
  GuardFidelityDiscardSchema,
  GuardTriageResolveSchema,
])
export type GuardAutoResolved = z.infer<typeof GuardAutoResolvedSchema>

/**
 * WHOSE FAULT a finding says it is — the one taxonomy every finding surface reads,
 * so `guard findings`, the generate summary and the dashboard can never disagree
 * about what a row means:
 *
 *  - `drift` — the repo and the doc disagree. Triage blamed one of them
 *    (`code-drift` / `doc-drift`) or produced no verdict at all, so the test was
 *    COMMITTED red: `guard run` reproduces it and CI breaks on it. This is the
 *    only class that is real work for the user.
 *  - `defect` — OUR fault: a `generation-defect` verdict or a fidelity rejection.
 *    Nothing was committed and nothing is broken in the repo; the flow re-authors
 *    on the next generate. Never rendered as drift, never counted as drift.
 *  - `escalation` — a `defect` the auto-resolve loop kept failing to fix
 *    ({@link GuardBirthFinding.autoResolveEscalation}). Re-generation is not
 *    working, so it IS a human task — and deliberately never auto-dismissed.
 */
export type GuardFindingClass = 'drift' | 'defect' | 'escalation'

/**
 * The class of ONE finding — see {@link GuardFindingClass}. Escalation outranks
 * the rest (it is the row that needs a human); after that the question is simply
 * whether a test was committed: a committed failing test is drift by construction,
 * everything else was withheld and is ours to fix.
 */
export function guardFindingClass(finding: GuardBirthFinding): GuardFindingClass {
  if (finding.autoResolveEscalation) return 'escalation'
  return finding.committed === true ? 'drift' : 'defect'
}

/** The words each class wears wherever it is rendered — one table, one vocabulary. */
export const GUARD_FINDING_CLASS_LABEL: Record<GuardFindingClass, string> = {
  drift: 'drift',
  defect: 'tool defect',
  escalation: 'escalated',
}

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
 * The interface catalog the run grounded on — deterministic, free, and re-derived
 * every generate. An empty surface is exactly what a `no-interface` gap reports, so
 * the counts are the first thing to read when flows settle unrealized.
 */
export const GuardInterfacesReportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    /** Interface type (a driver id) → how many interfaces were mapped for it. */
    bySurface: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict()
export type GuardInterfacesReport = z.infer<typeof GuardInterfacesReportSchema>

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
    /** The datastore compose file discovery GENERATED beside the recipe,
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
    /** Advisory recipe diagnostics that did not stop the run — e.g. a
     *  credential declaring a `satisfies` in a corpus with no OpenAPI document.
     *  Optional so reports written before this field existed keep parsing. */
    warnings: z.array(z.string()).optional(),
  })
  .strict()
export type GuardRecipeReport = z.infer<typeof GuardRecipeReportSchema>

/**
 * The seed-drafting stage's verdict — the LLM-drafted `api.seed`. It runs at the
 * END of a generate, when flows settled `blocked-on` missing data, a database was
 * detected, and the recipe has an `api` block but NO `api.seed` — and it is honest
 * about the other outcomes: `skipped` carries the condition that did not hold,
 * `failed` carries the engine's own verification diagnostic. A drafted seed names
 * BOTH artifacts the user reviews (the script file and the recipe block).
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

/**
 * An ADJUDICATION stage that lost EVERY call this run, so the corpus shipped
 * without its verdicts (plan item 88). Fidelity and triage judge content birth has
 * already validated — a lost fidelity review means a green test persisted
 * unreviewed, a lost triage means a red test committed with no verdict — so their
 * collapse costs annotation, not correctness, and the run ships rather than
 * throwing away everything the earlier (far more expensive) stages produced. It is
 * NOT silent: this row is the record, and every surface that renders the generate
 * summary says the stage never adjudicated. The lost calls themselves stay in
 * `llmFailures`; this says what shipped without them.
 */
export const GuardUnadjudicatedStageSchema = z
  .object({
    /** The stage that lost every call — one of the two adjudication stages. */
    stage: z.enum(['guard.fidelity', 'guard.triage']),
    /** How much of the corpus shipped unadjudicated: green tests persisted
     *  unreviewed (fidelity) / failing tests committed with no verdict (triage). */
    affected: z.number().int().nonnegative(),
  })
  .strict()
export type GuardUnadjudicatedStage = z.infer<typeof GuardUnadjudicatedStageSchema>

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
    /**
     * `llm-failed` = a stage that gates the run's output lost EVERY LLM call (an
     * expired login, a rejected request schema, a dead provider), or every call it
     * did get back was unusable (output that failed validation even after the
     * corrective re-ask), so nothing was generated and nothing on disk was
     * rewritten. Never `ok` with an empty result: a run that produced nothing must
     * not read as a clean no-op.
     */
    status: z.enum(['ok', 'no-docs', 'recipe-failed', 'open-conflicts', 'llm-failed']),
    /**
     * For `no-docs` / `recipe-failed` / `open-conflicts` / `llm-failed`: the
     * user-facing reason. For `open-conflicts` it carries the full formatted
     * conflict message (the conflict list itself is not snapshotted — surfaces
     * render it live from the corpus).
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
     * The birth-stage failure results, one row per failure outcome: committed
     * failing tests (`committed: true`) and the withheld classes — the
     * `generation-defect` verdicts and the `fidelity` rejections. The arithmetic
     * identity (asserted in tests, the B6 discipline): for a fresh generate,
     * every birth failure that reached a verdict settles as exactly ONE row here
     * — so `written(status 'failing').length === birthFindings.filter(f =>
     * f.kind !== 'fidelity' && f.committed).length`. Setup-class failures settle
     * as gaps/refusals/errors and contribute no row.
     */
    birthFindings: z.array(GuardBirthFindingSchema),
    errors: z.array(GuardGenerateErrorSchema),
    extractionFailures: z.array(GuardExtractionFailureSchema),
    /**
     * Stages that lost LLM calls this run (attempts, failures, first error). Every
     * stage absorbs an isolated failure somewhere, so this is what tells a partially
     * failed run from a clean one — and on an `llm-failed` abort it carries the
     * stage that lost everything. Only calls that THREW count, so an abort over
     * unusable output leaves it empty and `reason` carries the loss. Optional so
     * older reports parse; absent reads as "no failures".
     */
    llmFailures: z.array(StageTransportTallySchema).optional(),
    /**
     * The adjudication stages that lost EVERY call, so part of this corpus shipped
     * with no verdict about it. Never an abort (see
     * {@link GuardUnadjudicatedStageSchema}) — but never silent either: this is what
     * makes "these tests were never reviewed" readable off the stored report, not
     * only off the terminal that ran it. Optional so older reports parse; absent
     * reads as "everything was adjudicated".
     */
    unadjudicated: z.array(GuardUnadjudicatedStageSchema).optional(),
    orphaned: z.array(GuardOrphanedSectionSchema),
    /**
     * Birth passes that SURVIVED to a reported bucket, counted once per surviving
     * candidate: for a fresh generate, `birthPassed === written('passing').length
     * + fidelity rejections + fidelity-discard autoResolved rows` (the arithmetic
     * identity, asserted in tests). A pass whose fidelity review could not
     * complete reaches no bucket and is not counted. Optional so the report stays
     * a superset of the result AND tolerant reads of older files keep parsing.
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
     * The auto-resolved ledger rows — high-confidence machine judgments
     * the tool acted on itself this run (a visible record, never a task): a
     * HIGH-confidence fidelity flag discarded and re-authored once
     * (`fidelity-discard`), or a HIGH-confidence generation-defect failure
     * retired to re-attempt next run (`triage-resolve`). Optional so older
     * reports parse; absent reads as "none".
     */
    autoResolved: z.array(GuardAutoResolvedSchema).optional(),
    /**
     * The flow-led counts — the run's headline under flow-keyed generation.
     * Optional so reports written before flows existed keep parsing.
     */
    flows: GuardFlowsReportSchema.optional(),
    /** The interface catalog the run matched against. Optional, same reason. */
    interfaces: GuardInterfacesReportSchema.optional(),
    /**
     * The third parties the repo imports — detected from the same working-tree
     * analysis the interfaces came from, so it costs nothing extra. Independent of the
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
 * EVERY evidence transcript the guard stores point at, deduped in first-seen
 * order. Evidence lives in `guard/evidence/` — gitignored, so it exists only in
 * the tree the run happened in — and a hosted job has one chance to copy it out
 * of an ephemeral checkout before that tree is deleted. Enumerating it from the
 * stores (rather than from one hardcoded bucket) is what keeps that copy complete
 * as new buckets appear:
 *
 *  - `report.birthFindings[].evidencePath` — every failure this generate produced,
 *    committed drift and withheld defect alike;
 *  - `manifest.flows[].scenarios[].diagnosis.evidencePath` — the DURABLE pointer a
 *    committed failing test carries. The manifest is tracked, so this is
 *    the bucket that survives a no-op generate whose report re-derives its
 *    committed rows.
 *
 * A path either side does not carry simply is not returned; a caller that finds no
 * files at one skips it (a pointer may name a run whose tree is long gone).
 */
export function guardEvidencePaths(sources: {
  report?: GuardGenerateReport | null
  manifest?: GuardManifest | null
}): string[] {
  const seen = new Set<string>()
  const add = (path: string | undefined): void => {
    if (path && !seen.has(path)) seen.add(path)
  }
  for (const finding of sources.report?.birthFindings ?? []) add(finding.evidencePath)
  for (const flow of sources.manifest?.flows ?? []) {
    for (const scenario of flow.scenarios) add(scenario.diagnosis?.evidencePath)
  }
  return [...seen]
}

/** The committed birth-finding row a manifest diagnosis re-derives — the read
 *  half of {@link GuardScenarioDiagnosisSchema}'s durability contract. */
export function findingFromDiagnosis(
  flowId: string,
  scenario: { id: string; surface: GuardDriverId },
  d: GuardScenarioDiagnosis,
): GuardBirthFinding {
  return {
    doc: d.doc,
    anchor: d.anchor,
    scenarioId: scenario.id,
    committed: true,
    file: d.file,
    title: d.title,
    step: d.step,
    expected: d.expected,
    actual: d.actual,
    ...(d.stdout !== undefined ? { stdout: d.stdout } : {}),
    ...(d.stderr !== undefined ? { stderr: d.stderr } : {}),
    ...(d.evidencePath !== undefined ? { evidencePath: d.evidencePath } : {}),
    ...(d.claim !== undefined ? { claim: d.claim } : {}),
    flowId,
    surface: scenario.surface,
    ...(d.failedMilestone !== undefined ? { failedMilestone: d.failedMilestone } : {}),
    ...(d.priorMilestonesPassed !== undefined ? { priorMilestonesPassed: d.priorMilestonesPassed } : {}),
    ...(d.triage !== undefined ? { triage: d.triage } : {}),
  }
}

/**
 * Reconcile a fresh report's birth findings with the durable stores.
 * The report is overwritten wholesale per generate, but a finding outlives one
 * run in a different way per CLASS:
 *
 *  - COMMITTED failing tests: the durable record is the manifest scenario's
 *    `diagnosis` — committed WITH the test, surviving every no-op/aborted
 *    generate by construction. Their rows are RE-DERIVED from it here, one per
 *    still-failing scenario this run neither freshly re-executed (no fresh
 *    finding names it) nor rewrote. LEGACY clause: a failing manifest scenario
 *    with NO diagnosis (written before diagnoses were recorded) carries its
 *    prior-report row under exactly the old conditions, until a re-generate
 *    writes the diagnosis.
 *  - WITHHELD classes (a `generation-defect` failure, a `fidelity` rejection):
 *    never committed, so the prior REPORT is their only record. A row is carried
 *    while its flow is still live and UNSETTLED (`generationInputsHash` null)
 *    and this run produced no fresh outcome for the same (flow, surface) — a
 *    fresh finding, a written test, or a settled gap all supersede it. This is
 *    the whole carry-forward now: the committed class rides the manifest.
 * Pure; callers merge before persisting.
 */
export function carryForwardBirthFindings(
  report: GuardGenerateReport,
  prior: GuardGenerateReport | null,
  manifest: GuardManifest | null,
): GuardGenerateReport {
  if (!manifest) return report
  const carried: GuardBirthFinding[] = []
  const freshIds = new Set(report.birthFindings.map((f) => f.scenarioId).filter(Boolean))
  const rewritten = new Set(report.written.map((w) => w.id))

  // Committed class — re-derived from the manifest's own diagnosis.
  const legacyFailing = new Set<string>()
  for (const flow of manifest.flows) {
    for (const s of flow.scenarios) {
      if (s.status !== 'failing' || freshIds.has(s.id) || rewritten.has(s.id)) continue
      if (s.diagnosis) carried.push(findingFromDiagnosis(flow.flowId, s, s.diagnosis))
      else legacyFailing.add(s.id)
    }
  }

  if (prior) {
    const flowById = new Map(manifest.flows.map((f) => [f.flowId, f]))
    const pairOf = (f: { flowId?: string; surface?: string }): string | null =>
      f.flowId && f.surface ? `${f.flowId}\0${f.surface}` : null
    // A fresh finding, a written test, or an auto-resolution all supersede a
    // carried withheld row for the same (flow, surface).
    const freshPairs = new Set(
      [
        ...report.birthFindings.map(pairOf),
        ...report.written.map(pairOf),
        ...(report.autoResolved ?? []).map(pairOf),
      ].filter(Boolean),
    )
    for (const f of prior.birthFindings) {
      if (f.committed) {
        if (f.scenarioId !== undefined && legacyFailing.has(f.scenarioId)) carried.push(f)
        continue
      }
      const pair = pairOf(f)
      if (!pair || freshPairs.has(pair)) continue
      const entry = flowById.get(f.flowId!)
      if (!entry || entry.generationInputsHash !== null) continue
      if (entry.gaps.some((g) => g.surface === f.surface)) continue
      carried.push(f)
    }
  }
  if (carried.length === 0) return report
  return { ...report, birthFindings: [...report.birthFindings, ...carried] }
}
