// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/guard/extract-outcome.ts; delete with the preview.
/**
 * THE CLAIM-EXTRACTION SESSION OUTCOME, what one `guard-generate.extract`
 * agent session returns for ONE spec document (SPEC_GUARD_PLAN item's session
 * carve-out of the per-view extract one-shots).
 *
 * Shape-wise it is the one-shot `DocExtractionSchema` (claims + untestable
 * notes) grown with the structured `needs` field the strapi reference corpus
 * asked for: per claim, WHAT testing it would take beyond the sandbox's empty
 * world, a credential, a fixture, pre-existing state, an external service, or
 * a manual step. Needs are advisory grounding for flow synthesis and the
 * dependency catalog; they never gate extraction and never enter a claim's
 * identity or content hash.
 *
 * It lives in `@truecourse/shared` (not the generator) because the session
 * implementation in `@truecourse/core` and the engine in
 * `@truecourse/guard-generator` both consume it, and shared is the one package
 * both may import.
 */

import { z } from 'zod'
import { guardDriverIds } from './drivers'

/** What kind of prerequisite a claim's test would need. Closed vocabulary. */
export const ClaimNeedKindSchema = z.enum(['credential', 'fixture', 'state', 'external', 'manual'])
export type ClaimNeedKind = z.infer<typeof ClaimNeedKindSchema>

/**
 * One structured need: the kind, a short stable name (what a dependency-catalog
 * entry would be called, lower-kebab-case by convention, not enforced here),
 * and an optional sentence of detail.
 */
export const ClaimNeedSchema = z
  .object({
    kind: ClaimNeedKindSchema,
    name: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict()
export type ClaimNeed = z.infer<typeof ClaimNeedSchema>

/**
 * One claim as the extraction SESSION returns it, the one-shot claim shape
 * (claim sentence, driver, section anchor, observable) plus `needs`. The
 * session's `check_claims` tool and the fold both re-snap `sectionAnchor`
 * against the live section index; a model-authored anchor is never trusted.
 */
export const SessionExtractedClaimSchema = z
  .object({
    /** One declarative sentence: the externally-observable behavior. */
    claim: z.string().min(1),
    /** The surface whose driver could assert it. */
    driver: z.enum(guardDriverIds),
    /** An anchor copied verbatim from the briefed outline (re-snapped anyway). */
    sectionAnchor: z.string().min(1),
    /** The observable a test would assert. */
    reason: z.string().min(1),
    /**
     * What testing this claim requires beyond an empty sandbox. Often empty -
     * but REQUIRED (no `.default`): the agent loop's `outcomeSchema` seam
     * demands input ≡ output (`z.ZodType<TOutcome>`), and the outcome gate
     * re-asks a session that omits it rather than silently defaulting.
     */
    needs: z.array(ClaimNeedSchema),
  })
  .strict()
export type SessionExtractedClaim = z.infer<typeof SessionExtractedClaimSchema>

/** A section the session judged to state no testable behavior, with why. */
export const SessionUntestableNoteSchema = z
  .object({
    sectionAnchor: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()
export type SessionUntestableNote = z.infer<typeof SessionUntestableNoteSchema>

/**
 * The `guard-generate.extract` session outcome: the whole document's claims
 * plus its untestable notes. Deliberately `.strict()` with both arrays REQUIRED
 * (unlike the tolerant one-shot schema): the agent loop's outcome gate re-asks
 * on a malformed reply, so tolerance would only hide a drifting model.
 */
export const ExtractOutcomeSchema = z
  .object({
    claims: z.array(SessionExtractedClaimSchema),
    untestable: z.array(SessionUntestableNoteSchema),
  })
  .strict()
export type ExtractOutcome = z.infer<typeof ExtractOutcomeSchema>
