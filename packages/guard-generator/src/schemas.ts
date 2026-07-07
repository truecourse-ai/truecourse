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

/** The recipe discovery proposal — build command + entrypoint argv. */
export const RecipeProposalSchema = z
  .object({
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
 * model wrote for them via `.passthrough()`.
 */
export const RawGeneratedScenarioSchema = z
  .object({
    title: z.string().min(1),
    driver: z.literal('cli'),
    setup: GuardSetupSchema.optional(),
    steps: z.array(GuardStepSchema).min(1),
    normalize: z.array(GuardNormalizerSchema).optional(),
  })
  .passthrough()
export type RawGeneratedScenario = z.infer<typeof RawGeneratedScenarioSchema>

/**
 * One claim's authored output, echoed back by its `ref` so the engine maps
 * scenarios to claims without relying on array order. `scenarios: []` is a valid,
 * honest "on reflection this claim states nothing a CLI run can assert".
 * `blockedOn` names the world-state capabilities the claim needs but no `setup`
 * block can express (a running service, a database, network, credentials); it is
 * meaningful ONLY when `scenarios` is empty and ignored otherwise.
 */
export const AuthoredClaimSchema = z.object({
  ref: z.string().min(1),
  scenarios: z.array(RawGeneratedScenarioSchema).default([]),
  blockedOn: z.array(z.string().min(1)).optional(),
})
export type AuthoredClaim = z.infer<typeof AuthoredClaimSchema>

/** A batch's authored output — one entry per input claim ref. */
export const AuthoredBatchSchema = z.array(AuthoredClaimSchema)
