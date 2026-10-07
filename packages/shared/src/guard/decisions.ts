/**
 * The guard decisions file — user-authored curation intent that `guard generate`
 * reads, the guard analogue of the spec-consolidator's `specs/decisions.json`.
 *
 * It lives at `.truecourse/scenarios/decisions.json`, next to `recipe.json` and
 * `manifest.json` (the scenario-binding files) — NOT under the `guard/` run
 * store. It is stored per repository and materialized into every generate's
 * clone, so a claim one person judged noise stays dismissed for everyone.
 *
 * It holds two lists. `dismissedClaims`: findings the user judged a generation
 * defect / won't-fix / noise. A dismissed claim (identity = the claim's id, the
 * one the scan gave it) is skipped by generate — never re-authored,
 * never re-findinged — and settles as an explicit `dismissed` coverage gap. It is
 * excluded from flow synthesis too, so it never becomes a milestone.
 * `dismissedFlows`: whole flows (identity = the flow id) the user judged not worth
 * guarding — dropped with their scenarios at generate. Undo either by removing its
 * entry (the UI's Un-dismiss, or by hand).
 */

import { z } from 'zod'

/**
 * One dismissed claim. Identity is the claim's id. Not `.strict()` so a future
 * field never breaks an old reader (mirrors the spec decisions file).
 */
export const GuardDismissedClaimSchema = z.object({
  /** The claim's id — the identity. */
  claimId: z.string().min(1),
  /** ISO timestamp the dismissal was recorded. */
  dismissedAt: z.string(),
  /** Optional free-text rationale ("flaky", "won't fix", …). */
  note: z.string().optional(),
  /**
   * True when the TOOL recorded this dismissal itself — the AUTO tier, reserved
   * for triage auto-resolutions and distinct from a human's judgment so surfaces
   * can render (and a human can revisit) the machine's calls separately.
   */
  auto: z.boolean().optional(),
  /** The machine reason (the triage brief) that justified an `auto` dismissal. */
  reason: z.string().optional(),
})
export type GuardDismissedClaim = z.infer<typeof GuardDismissedClaimSchema>

/** Just the identity a dismissal keys on — what the dismiss/undismiss surfaces pass around. */
export type GuardClaimIdentity = Pick<GuardDismissedClaim, 'claimId'>

/**
 * One dismissed FLOW. Identity is `flowId` (the flow's stable handle in
 * `scenarios/flows.json`, which survives re-synthesis by milestone overlap); a
 * reader that wants its title reads the flow. A dismissed flow is dropped at
 * generate — never re-authored, never re-findinged. Not `.strict()`, like the
 * claim dismissal above, so an older row that carried a title still parses.
 */
export const GuardDismissedFlowSchema = z.object({
  /** The flow's id — the identity. */
  flowId: z.string().min(1),
  /** ISO timestamp the dismissal was recorded. */
  dismissedAt: z.string(),
  /** Optional free-text rationale ("not a user path", "won't fix", …). */
  note: z.string().optional(),
})
export type GuardDismissedFlow = z.infer<typeof GuardDismissedFlowSchema>

/** The whole decisions file. Both lists default to `[]` so a partial or
 *  freshly-created file still parses. */
export const GuardDecisionsSchema = z.object({
  version: z.literal(1),
  dismissedClaims: z.array(GuardDismissedClaimSchema).default([]),
  dismissedFlows: z.array(GuardDismissedFlowSchema).default([]),
})
export type GuardDecisions = z.infer<typeof GuardDecisionsSchema>

/** An empty, valid decisions file — the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_DECISIONS: GuardDecisions = {
  version: 1,
  dismissedClaims: [],
  dismissedFlows: [],
}
