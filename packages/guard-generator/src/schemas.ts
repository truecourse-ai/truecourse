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
 * A documented worked example mined into a claim: the fenced code block's content
 * copied VERBATIM (the exact input the doc shows) plus the outcome its surrounding
 * prose promises. Authoring seeds the scenario's setup from `block` byte-for-byte
 * instead of paraphrasing, so the doc's own example is what runs.
 */
export const ExampleBlockSchema = z.object({
  block: z.string().min(1),
  outcome: z.string().min(1),
})
export type ExampleBlock = z.infer<typeof ExampleBlockSchema>

/**
 * A quantified SUPPORT claim's subject (item 9): the doc says the tool supports /
 * is compatible with / handles a whole class of inputs — "supports the Postgres
 * dialect", "handles JSON5", "compatible with PEP 604 syntax". Such a claim
 * promises thousands of inputs the doc never enumerates, so the engine GENERATES a
 * diverse exemplar pack for `subject` and runs the documented operation over it.
 * `kind` is the class of thing supported; `extension` is the sandbox filename
 * extension the tool dispatches on (e.g. `sql`, `py`), when the section names one.
 */
export const SupportSubjectSchema = z.object({
  kind: z.enum(['language', 'dialect', 'format', 'syntax']),
  subject: z.string().min(1),
  extension: z.string().min(1).optional(),
})
export type SupportSubject = z.infer<typeof SupportSubjectSchema>

/**
 * One testable claim the model read out of a document: a single externally-
 * observable behavior, the driver that could assert it, the section it belongs to
 * (an anchor the engine snaps against the live index), and the observable a test
 * would check.
 *
 * `flavor` marks the claim's shape (default `normal`, an ordinary prose claim):
 *  - `example` — mined from a documented example block; carries the `example`
 *    payload (the block copied verbatim + its promised outcome).
 *  - `invariant` — an always/never/idempotent/deterministic rule about the tool's
 *    behavior ("fix never breaks your code", "formatting is idempotent"). One rule
 *    can't be tested by one hand-picked input, so it authors a PROPERTY scenario run
 *    over MANY inputs; `examples` carries the section's own example blocks (item 7's
 *    payloads), copied verbatim, that seed the input corpus pack round 1.
 *  - `support` — a quantified "supports/handles/compatible-with <class> X" claim
 *    (item 9). X promises thousands of inputs the doc never lists, so the engine
 *    GENERATES a diverse exemplar pack for `support` and runs the documented
 *    operation over it — one property scenario, like `invariant`, but pack-generated
 *    rather than seeded. A mere MENTION of X is not a support claim.
 * All are optional so a pre-flavor cache parses as a normal claim (item-7 back-compat).
 */
export const ExtractedClaimSchema = z.object({
  claim: z.string().min(1),
  driver: z.enum(CLAIM_DRIVERS),
  sectionAnchor: z.string().min(1),
  reason: z.string().min(1),
  flavor: z.enum(['normal', 'example', 'invariant', 'support']).optional(),
  example: ExampleBlockSchema.optional(),
  /** Present only for an `invariant` claim: the section's example blocks (verbatim)
   *  that seed the input corpus pack. Absent/empty ⇒ the pack seeds from repo
   *  fixtures alone (or, until item 9's generated exemplars, may be empty). */
  examples: z.array(ExampleBlockSchema).optional(),
  /** Present only for a `support` claim (item 9): the class + named subject X the
   *  exemplar generator writes diverse inputs for. Absent ⇒ the claim can't generate
   *  a pack and authors as an ordinary claim (back-compat with pre-support caches). */
  support: SupportSubjectSchema.optional(),
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
 * The model-facing shape of an invariant scenario's `inputs` (item 8): ONLY the
 * staged name `as` the steps reference. The `pack` is engine-owned (the engine
 * seeds it and stamps the id, like `binds`), so the model never authors it — a pack
 * key here is tolerated and ignored via `.passthrough()`.
 */
export const RawInputsSchema = z
  .object({ as: z.string().min(1).optional() })
  .passthrough()

/**
 * One scenario as the model authors it: the behavioral fields only. `id`,
 * `binds`, and `guard` are engine-owned, so we tolerate (and ignore) whatever the
 * model wrote for them via `.passthrough()`. For an invariant claim the model may
 * set `inputs.as` (the staged input name its steps reference); the engine supplies
 * `inputs.pack`.
 */
export const RawGeneratedScenarioSchema = z
  .object({
    title: z.string().min(1),
    driver: z.literal('cli'),
    setup: GuardSetupSchema.optional(),
    inputs: RawInputsSchema.optional(),
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

// ---------------------------------------------------------------------------
// Fidelity review (one call per green scenario, after birth passes)
// ---------------------------------------------------------------------------

/**
 * The fidelity reviewer's verdict on ONE green scenario read against its section
 * and claim: `faithful` (the scenario genuinely verifies what the section/claim
 * asserts) or `flagged` (it is weak, vacuous, or miscast). A flagged verdict MUST
 * carry a one-sentence `mismatch` — the stated reason recorded as evidence — and a
 * `confidence` (same closed enum as triage) in how sure the review is the scenario
 * is weak. A HIGH-confidence flag self-heals (the candidate is discarded and its
 * claim re-authored once with the mismatch as evidence, never a human task);
 * medium/low flags become findings. A flagged verdict missing `confidence` is read
 * conservatively as `medium` (a finding — never an auto-discard without an explicit
 * high signal). The object schema is NOT strict: an extra key from a smaller model
 * is dropped, not a validation failure.
 */
export const FidelityReviewSchema = z.object({
  verdict: z.enum(['faithful', 'flagged']),
  mismatch: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
})
export type FidelityReview = z.infer<typeof FidelityReviewSchema>
