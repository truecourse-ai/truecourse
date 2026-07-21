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

/** One written scenario in the report (a generated `.yaml` and its binding). */
export const GuardWrittenScenarioSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    doc: z.string(),
    anchor: z.string(),
    /** Repo-relative path of the written `.yaml`. */
    file: z.string(),
  })
  .strict()
export type GuardWrittenScenario = z.infer<typeof GuardWrittenScenarioSchema>

/**
 * Why a section has no CLI guard, UN-CONFLATED so a postponement never reads as a
 * verdict: `awaiting-driver` (the claim needs a driver that isn't runnable yet —
 * which one is the `driver` field, not the kind), `untestable`/`no-claim` (nothing
 * a CLI run can assert), `blocked-on` (needs world-state no `setup` block can
 * express — a running service, database, network, credentials), or `dismissed`
 * (the user judged the claim's finding noise/won't-fix in `scenarios/decisions.json`,
 * so generate settles it explicitly instead of silently disappearing it). A
 * `dismissed` gap carries no driver (it never reached a driver), like the residual
 * kinds — the refine below holds.
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
 * A triage verdict on ONE birth/fidelity finding — the tool's recommendation
 * for how to unblock it, produced by a post-settle judgment call over the finding's
 * evidence (claim, section text, authored YAML, expected/actual, the failing run's
 * raw output, and the section's grounding probes). A recommendation with quoted
 * evidence — NEVER auto-applied; the user stays the judge, exactly like a conflict
 * resolution. Object schema is NOT strict: an extra key from the model is dropped,
 * not a validation failure.
 *  - `doc-drift` — the doc is wrong; the `recommendation` quotes the exact doc line
 *    to change and its replacement.
 *  - `code-drift` — the code is wrong; the `recommendation` names the observed
 *    behavior vs the doc's promise (a real bug the finding caught).
 *  - `generation-defect` — the scenario itself is faulty (a mis-authored assertion);
 *    the `recommendation` is dismiss-or-retry with the reason.
 *  - `environment` — the finding is an artefact of the sandbox/run environment, not
 *    a doc/code disagreement; the `recommendation` is dismiss-or-retry with the reason.
 */
/** The four triage verdicts, as a standalone schema so the auto-resolution ledger
 *  and the durable escalation record can key on the same closed set. */
export const GuardTriageVerdictSchema = z.enum(['doc-drift', 'code-drift', 'generation-defect', 'environment'])
export type GuardTriageVerdict = z.infer<typeof GuardTriageVerdictSchema>

/** The three confidence levels (shared with fidelity). */
export const GuardTriageConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type GuardTriageConfidence = z.infer<typeof GuardTriageConfidenceSchema>

export const GuardTriageSchema = z.object({
  verdict: GuardTriageVerdictSchema,
  confidence: GuardTriageConfidenceSchema,
  /** One-paragraph plain-words assessment of what the finding shows. */
  brief: z.string().min(1),
  /** The concrete next action (see the verdict cases above). */
  recommendation: z.string().min(1),
})
export type GuardTriage = z.infer<typeof GuardTriageSchema>

/** True when the triage verdict recommends dismissal (the finding is noise, not
 *  real doc/code drift) — the signal the surfaces use to wire the Dismiss action. */
export function triageRecommendsDismiss(verdict: GuardTriageVerdict): boolean {
  return verdict === 'generation-defect' || verdict === 'environment'
}

/** A candidate that failed birth validation twice — a generation defect or real drift. */
export const GuardBirthFindingSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    /**
     * What kind of finding this is:
     *  - `birth` (default when absent) — a scenario that failed birth validation
     *    twice (a generation defect or real existing drift).
     *  - `fidelity` — a scenario that PASSED birth but the fidelity reviewer judged
     *    it weak/vacuous/miscast: it does not truly verify what its section claims
     *    (item 33). `actual` carries the reviewer's one-sentence stated mismatch;
     *    `step`/`expected` are placeholders (no birth step ran).
     * Optional so older `result.json` files (and internal birth findings, which
     * leave it unset) keep parsing.
     */
    kind: z.enum(['birth', 'fidelity']).optional(),
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
    /**
     * The triage verdict + recommendation for this finding (see
     * {@link GuardTriageSchema}), attached AT GENERATE by the post-settle triage
     * stage and persisted with the finding (triage is expensive, so it does not
     * re-derive on read). Optional so older `result.json` files — and any run with
     * no triage runner — keep parsing; a finding simply ships without triage then.
     */
    triage: GuardTriageSchema.optional(),
    /**
     * Set when item-14 auto-resolution KEPT producing this identical finding: its
     * triage verdict said auto-resolve (generation-defect/environment at HIGH), but
     * the same finding identity has auto-resolved `count` times across generates
     * without converging, so it is now surfaced as a human task with a
     * "re-generation is not fixing this" note instead of being auto-resolved again.
     * The escalation guard against an infinite silent loop. Optional — a finding that
     * never recurred (or an older report) simply omits it.
     */
    autoResolveEscalation: z
      .object({ verdict: GuardTriageVerdictSchema, count: z.number().int().positive() })
      .optional(),
  })
  .strict()
export type GuardBirthFinding = z.infer<typeof GuardBirthFindingSchema>

export const GuardGenerateErrorSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    message: z.string(),
  })
  .strict()
export type GuardGenerateError = z.infer<typeof GuardGenerateErrorSchema>

/**
 * LEGACY (never written since item 15) — a birth-passed-but-withheld candidate under
 * a held section, back when a sibling finding held its whole section's validated work
 * back. Every scenario now commits on its own merits, so nothing is ever held; the
 * schema survives ONLY so an old `guard/result.json` carrying `heldSections` still
 * parses.
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
 * LEGACY (never written since item 15) — a section that stayed UNSETTLED yet whose
 * candidates all passed birth, when a sibling finding/error withheld the whole
 * section's validated work. Item 15 retired all-or-nothing settling: every candidate
 * that clears birth + fidelity commits regardless of its siblings, so no section is
 * ever held. The schema survives ONLY so an old `guard/result.json` still parses.
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

/** A bound section whose scenarios remain but the section itself is gone. */
export const GuardOrphanedSectionSchema = z
  .object({
    doc: z.string(),
    anchor: z.string(),
    scenarioIds: z.array(z.string()),
  })
  .strict()
export type GuardOrphanedSection = z.infer<typeof GuardOrphanedSectionSchema>

/**
 * One AUTO-RESOLVED ledger entry — a high-confidence machine judgment the tool
 * acted on ITSELF instead of handing the user a task. A visible record, never
 * silence: nothing is deleted without an auditable trace. A discriminated union
 * over `kind`:
 *  - `fidelity-discard` (item 13) — a green scenario the fidelity reviewer flagged at
 *    HIGH confidence (weak/vacuous/miscast). Rather than birth a finding, the candidate
 *    is discarded and its claim re-authored ONCE; `outcome` says what that produced.
 *  - `triage-dismiss` (item 14) — a birth/fidelity finding the triage stage judged
 *    `environment` at HIGH confidence: the claim is untestable in this sandbox, so it
 *    is auto-DISMISSED into `scenarios/decisions.json` (marked `auto`) instead of
 *    raising a task. Carries the dismissed `claim` text so the ledger names it.
 *  - `triage-resolve` (item 14) — a finding triage judged `generation-defect` at HIGH
 *    confidence: our scenario was bad, the claim is fine, so the FINDING is retired to
 *    the ledger (never dismissed) and the claim re-attempts next generate.
 */
export const GuardFidelityDiscardSchema = z
  .object({
    kind: z.literal('fidelity-discard'),
    doc: z.string(),
    anchor: z.string(),
    /** The discarded scenario's title. */
    title: z.string(),
    /** The reviewer's high-confidence mismatch — why the scenario was discarded. */
    mismatch: z.string(),
    /**
     * What the single re-author produced:
     *  - `resolved` — a faithful, birth-passing replacement (committed or held).
     *  - `finding` — the replacement was flagged again / failed birth → a finding.
     *  - `unresolved` — no replacement was authored (empty/blocked/authoring error).
     */
    outcome: z.enum(['resolved', 'finding', 'unresolved']),
  })
  .strict()

export const GuardTriageDismissSchema = z
  .object({
    kind: z.literal('triage-dismiss'),
    doc: z.string(),
    anchor: z.string(),
    /** The auto-resolved finding's scenario title. */
    title: z.string(),
    /** The triage verdict that drove the auto-resolution (always `environment` today). */
    verdict: GuardTriageVerdictSchema,
    /** The triage brief — why the claim is untestable here (also the dismissal reason). */
    brief: z.string(),
    /** The dismissed claim's stable text, written into `decisions.json`. */
    claim: z.string(),
  })
  .strict()

export const GuardTriageResolveSchema = z
  .object({
    kind: z.literal('triage-resolve'),
    doc: z.string(),
    anchor: z.string(),
    /** The auto-resolved finding's scenario title. */
    title: z.string(),
    /** The triage verdict that drove the auto-resolution (always `generation-defect` today). */
    verdict: GuardTriageVerdictSchema,
    /** The triage brief — why the scenario was faulty; the claim re-attempts next run. */
    brief: z.string(),
  })
  .strict()

export const GuardAutoResolvedSchema = z.discriminatedUnion('kind', [
  GuardFidelityDiscardSchema,
  GuardTriageDismissSchema,
  GuardTriageResolveSchema,
])
export type GuardAutoResolved = z.infer<typeof GuardAutoResolvedSchema>
export type GuardFidelityDiscard = z.infer<typeof GuardFidelityDiscardSchema>
export type GuardTriageDismiss = z.infer<typeof GuardTriageDismissSchema>
export type GuardTriageResolve = z.infer<typeof GuardTriageResolveSchema>

/** The recipe outcome for the run — loaded as-is or freshly discovered. */
export const GuardRecipeReportSchema = z
  .object({
    status: z.enum(['exists', 'discovered']),
    entry: z.array(z.string()),
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
    birthFindings: z.array(GuardBirthFindingSchema),
    errors: z.array(GuardGenerateErrorSchema),
    extractionFailures: z.array(GuardExtractionFailureSchema),
    orphaned: z.array(GuardOrphanedSectionSchema),
    /**
     * Birth passes that survived to a reported bucket — a written scenario, a fidelity
     * finding, or an auto-resolved fidelity discard. Counted once per surviving
     * candidate. Since item 15 every birth+fidelity-clean candidate COMMITS (no
     * held-ready bucket), so the run reconciles as `birthPassed === written.length +
     * (birthFindings with kind 'fidelity') + autoResolved.length` — item 14 moves some
     * findings from `birthFindings` into `autoResolved`, so the honest invariant is
     * that a triage-auto-resolved entry counts here ONLY when its origin finding
     * PASSED birth (a fidelity finding / a fidelity discard) — an auto-resolved BIRTH
     * finding never passed birth and is not counted. A round-1 pass discarded when a
     * sibling forced a whole-claim BIRTH retry is NOT counted (only the retry's own
     * passes are), nor is a birth pass whose fidelity review could not complete.
     * Optional so the report stays a superset of the result AND tolerant reads of
     * older files (written before this field existed) keep parsing.
     */
    birthPassed: z.number().int().nonnegative().optional(),
    /**
     * LEGACY (never written since item 15) — ready-but-held scenarios a section's
     * unsettled state withheld. Every scenario now commits on its own merits, so this
     * is always absent going forward; kept optional ONLY so an old `result.json`
     * carrying it still parses. Absent reads as "no held work".
     */
    heldSections: z.array(GuardHeldSectionSchema).optional(),
    /**
     * Dismissals whose claim text matched nothing in a doc this run re-extracted —
     * stale entries in `scenarios/decisions.json`, surfaced (never silently
     * honored). Optional so older reports parse; absent reads as "none".
     */
    orphanedDismissals: z.array(GuardOrphanedDismissalSchema).optional(),
    /**
     * The auto-resolved ledger — high-confidence machine judgments the tool acted on
     * itself (a visible record, never a task): HIGH-confidence fidelity flags
     * discarded and re-authored once (`fidelity-discard`), plus item-14 triage
     * auto-resolutions — an `environment` finding auto-dismissed (`triage-dismiss`)
     * or a `generation-defect` finding retired to the ledger (`triage-resolve`). The
     * latter two are the reason a finding leaves `birthFindings`. Optional so older
     * reports parse; absent reads as "none".
     */
    autoResolved: z.array(GuardAutoResolvedSchema).optional(),
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
