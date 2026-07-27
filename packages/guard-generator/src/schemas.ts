/**
 * Zod schemas for the guard-generator LLM outputs — the per-document claim
 * extraction, the recipe proposal, and the batched scenario authoring. The engine
 * parses raw model text against these before it trusts anything; nothing the model
 * returns reaches disk unvalidated.
 *
 * The scenario schema pieces (setup / step / normalizer) are imported from
 * `@truecourse/shared` — the SAME Zod definitions the runner validates committed
 * scenarios against — so a generated scenario's verb set can never drift from what
 * the engine executes. The model authors only the behavioral fields; the engine
 * assigns `id`, fills `binds`, and stamps `guard`, so those are relaxed here (the
 * model's values are overwritten regardless).
 *
 * The model-facing object schemas deliberately do NOT use `.strict()`: an extra
 * key from a smaller model is dropped, not a validation failure. Only the fields
 * the engine reads are constrained.
 */

import { z } from 'zod'
import {
  GuardSetupSchema,
  GuardStepSchema,
  GuardApiStepSchema,
  GuardNormalizerSchema,
  GuardTestabilityVerdictSchema,
  guardDriverIds,
} from '@truecourse/shared'

/** The per-section classification summary recorded in the manifest, derived from
 *  extraction (kept shape — the dashboard renders it as a coverage verdict). */
export const TestabilityVerdictSchema = GuardTestabilityVerdictSchema
export type TestabilityVerdict = z.infer<typeof TestabilityVerdictSchema>

/** The test drivers a claim can target — cli is authored today; the rest are
 *  recorded for coverage honesty until their drivers ship. Derived from the guard
 *  driver registry (its id order is the extraction schema's `driver` enum, which
 *  is fingerprinted — the registry keeps it stable). */
export const CLAIM_DRIVERS = guardDriverIds

/** The recipe discovery proposal — optional install + build command + entrypoint argv. */
export const RecipeProposalSchema = z
  .object({
    install: z.string().min(1).optional(),
    build: z.string().min(1),
    entry: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()
export type RecipeProposal = z.infer<typeof RecipeProposalSchema>

// ---------------------------------------------------------------------------
// Claim extraction (one call per document / view)
// ---------------------------------------------------------------------------

/**
 * One testable claim the model read out of a document: a single externally-
 * observable behavior, the driver that could assert it, the section it belongs to
 * (an anchor the engine snaps against the live index), and the observable a test
 * would check.
 */
export const ExtractedClaimSchema = z.object({
  claim: z.string().min(1),
  driver: z.enum(CLAIM_DRIVERS),
  sectionAnchor: z.string().min(1),
  reason: z.string().min(1),
})
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>

/** A section the model judged to state no testable behavior — a visible coverage
 *  gap with an honest reason. */
export const UntestableNoteSchema = z.object({
  sectionAnchor: z.string().min(1),
  reason: z.string().min(1),
})
export type UntestableNote = z.infer<typeof UntestableNoteSchema>

/**
 * One document's (or view's) extraction: its claims plus per-section untestable
 * notes. Either array may be omitted (a doc with only claims, or only notes), but
 * at least one MUST be a real array — a wrong-shaped object with neither is a
 * malformed reply that triggers the corrective re-ask, never a silent empty read.
 * The engine unions views and snaps anchors after parsing.
 */
export const DocExtractionSchema = z
  .object({
    claims: z.array(ExtractedClaimSchema).optional(),
    untestable: z.array(UntestableNoteSchema).optional(),
  })
  .refine((d) => d.claims !== undefined || d.untestable !== undefined, {
    message: 'expected a "claims" and/or "untestable" array',
  })
  .transform((d) => ({ claims: d.claims ?? [], untestable: d.untestable ?? [] }))
export type DocExtraction = z.infer<typeof DocExtractionSchema>

// ---------------------------------------------------------------------------
// Scenario authoring (batched per claim)
// ---------------------------------------------------------------------------

/**
 * One scenario as the model authors it: the behavioral fields only. `id`,
 * `binds`, and `guard` are engine-owned, so we tolerate (and ignore) whatever the
 * model wrote for them via `.passthrough()`. One schema per runnable driver —
 * each authoring prompt embeds ITS driver's schema, and the parse accepts either
 * (keyed on `driver`) so a batch can never smuggle a step vocabulary across drivers.
 */
export const RawGeneratedCliScenarioSchema = z
  .object({
    title: z.string().min(1),
    driver: z.literal('cli'),
    setup: GuardSetupSchema.optional(),
    steps: z.array(GuardStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).optional(),
  })
  .passthrough()
export type RawGeneratedCliScenario = z.infer<typeof RawGeneratedCliScenarioSchema>

export const RawGeneratedApiScenarioSchema = z
  .object({
    title: z.string().min(1),
    driver: z.literal('api'),
    setup: GuardSetupSchema.optional(),
    steps: z.array(GuardApiStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).optional(),
  })
  .passthrough()
export type RawGeneratedApiScenario = z.infer<typeof RawGeneratedApiScenarioSchema>

export const RawGeneratedScenarioSchema = z.discriminatedUnion('driver', [
  RawGeneratedCliScenarioSchema,
  RawGeneratedApiScenarioSchema,
])
export type RawGeneratedScenario = z.infer<typeof RawGeneratedScenarioSchema>

/**
 * One (flow, surface) authoring call's output: the scenario that realizes the
 * flow's whole path on that surface, or an honest refusal. `scenario` absent (or
 * `null`) with a `blockedOn` list means the flow needs world-state neither the
 * sandbox nor the recipe can provide (a running service, a database, network,
 * credentials); the engine records it as a `blocked-on` gap rather than authoring
 * a scenario that could only die at birth. At least one of the two must be
 * present — a reply with neither is malformed and earns the corrective re-ask,
 * never a silent empty settle.
 */
export const AuthoredFlowScenarioSchema = z
  .object({
    scenario: RawGeneratedScenarioSchema.nullish(),
    blockedOn: z.array(z.string().min(1)).optional(),
  })
  .refine((a) => a.scenario != null || (a.blockedOn?.length ?? 0) > 0, {
    message: 'expected a "scenario" object or a non-empty "blockedOn" array',
  })
  .transform((a) => ({
    scenario: a.scenario ?? null,
    blockedOn: a.scenario == null ? (a.blockedOn ?? []) : [],
  }))
export type AuthoredFlowScenario = z.infer<typeof AuthoredFlowScenarioSchema>

// ---------------------------------------------------------------------------
// Fidelity review (one call per green scenario, after birth passes)
// ---------------------------------------------------------------------------

/**
 * The fidelity reviewer's verdict on ONE green scenario read against its section
 * and claim: `faithful` (the scenario genuinely verifies what the section/claim
 * asserts) or `flagged` (it is weak, vacuous, or miscast). A flagged verdict MUST
 * carry a one-sentence `mismatch` — the stated reason recorded as the finding's
 * evidence. The object schema is NOT strict: an extra key from a smaller model is
 * dropped, not a validation failure.
 */
export const FidelityReviewSchema = z.object({
  verdict: z.enum(['faithful', 'flagged']),
  mismatch: z.string().optional(),
})
export type FidelityReview = z.infer<typeof FidelityReviewSchema>

// ---------------------------------------------------------------------------
// Flow synthesis (one call per area, plus one cross-area epic pass)
// ---------------------------------------------------------------------------

/**
 * One milestone as synthesis returns it: an already-extracted claim, addressed by
 * the document + section anchor it was extracted under. The engine SNAPS this
 * triple against the area's claim inventory — synthesis orders and groups claims,
 * it never authors one — so `claimTitle` is a copy of a claim's text, not new prose.
 * `order` is advisory (the engine renumbers the path 1..n).
 */
export const SynthesizedMilestoneSchema = z.object({
  doc: z.string().min(1),
  anchor: z.string().min(1),
  claimTitle: z.string().min(1),
  order: z.number().int().positive().optional(),
  note: z.string().optional(),
})
export type SynthesizedMilestone = z.infer<typeof SynthesizedMilestoneSchema>

/** One synthesized flow: a user-goal path over the area's claims. */
export const SynthesizedFlowSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  milestones: z.array(SynthesizedMilestoneSchema).min(1),
})
export type SynthesizedFlow = z.infer<typeof SynthesizedFlowSchema>

/** A claim synthesis deliberately placed in no flow, with its reason — the
 *  coverage honesty rule's other half. */
export const SynthesizedNoFlowClaimSchema = z.object({
  doc: z.string().min(1),
  anchor: z.string().min(1),
  claimTitle: z.string().min(1),
  reason: z.string().min(1),
})
export type SynthesizedNoFlowClaim = z.infer<typeof SynthesizedNoFlowClaimSchema>

/**
 * One area's synthesis output. Either array may be omitted (an area that composes
 * everything, or one that flows nothing), but at least one MUST be a real array —
 * a wrong-shaped object with neither is a malformed reply that triggers the
 * corrective re-ask, never a silent empty read (mirrors {@link DocExtractionSchema}).
 */
export const FlowSynthesisSchema = z
  .object({
    flows: z.array(SynthesizedFlowSchema).optional(),
    noFlowClaims: z.array(SynthesizedNoFlowClaimSchema).optional(),
  })
  .refine((d) => d.flows !== undefined || d.noFlowClaims !== undefined, {
    message: 'expected a "flows" and/or "noFlowClaims" array',
  })
  .transform((d) => ({ flows: d.flows ?? [], noFlowClaims: d.noFlowClaims ?? [] }))
export type FlowSynthesis = z.infer<typeof FlowSynthesisSchema>

/**
 * One epic flow: a cross-area path that CHAINS flows the per-area pass already
 * produced. `composedOf` carries the digest refs of the chained flows (the engine
 * rewrites them to flow ids); every milestone must be one of those flows'
 * milestones, so an epic can never smuggle in a claim no flow covers.
 */
export const SynthesizedEpicFlowSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  composedOf: z.array(z.string().min(1)).min(2),
  milestones: z.array(SynthesizedMilestoneSchema).min(2),
})
export type SynthesizedEpicFlow = z.infer<typeof SynthesizedEpicFlowSchema>

/** The epic pass's output — an explicit (possibly empty) `epics` array. A reply
 *  without the key is malformed and re-asked, so "no epics" is always a stated
 *  answer rather than an unparsed one. */
export const EpicSynthesisSchema = z.object({
  epics: z.array(SynthesizedEpicFlowSchema),
})
export type EpicSynthesis = z.infer<typeof EpicSynthesisSchema>

// ---------------------------------------------------------------------------
// Realization matching (one call per flow × surface)
// ---------------------------------------------------------------------------

/** One step of a realization plan: the journey that realizes a milestone. */
export const RealizationStepSchema = z.object({
  /** A journey id copied verbatim from the surface's catalog digest. */
  journeyId: z.string().min(1),
  /** The flow milestone (`order`) this journey realizes. */
  milestone: z.number().int().positive(),
  /** Optional one-liner on how the journey serves the milestone. */
  note: z.string().optional(),
})
export type RealizationStep = z.infer<typeof RealizationStepSchema>

/**
 * One flow's realization verdict on ONE surface: an ordered `plan` walking its
 * milestones through the surface's journeys, or an explicit `unrealizable` reason
 * (no journey path serves the flow). Exactly one of the two — a reply carrying
 * both, or neither, is malformed and earns the corrective re-ask, so "this surface
 * cannot do it" is always a STATED answer rather than an empty plan.
 */
export const RealizationMatchSchema = z
  .object({
    plan: z.array(RealizationStepSchema).optional(),
    unrealizable: z.string().min(1).optional(),
  })
  .refine((m) => ((m.plan?.length ?? 0) > 0) !== (m.unrealizable !== undefined), {
    message: 'expected a non-empty "plan" array OR an "unrealizable" reason, not both',
  })
  .transform((m) => ({ plan: m.plan ?? [], unrealizable: m.unrealizable }))
export type RealizationMatch = z.infer<typeof RealizationMatchSchema>
