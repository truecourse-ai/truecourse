/**
 * The guard decisions file — user-authored curation intent that `guard generate`
 * reads, the guard analogue of the spec-consolidator's `specs/decisions.json`.
 *
 * It lives at `.truecourse/scenarios/decisions.json`, next to `recipe.json` and
 * `manifest.json` (the committable scenario-binding files) — NOT under the mostly
 * gitignored `guard/` run store. It is committable and MUST travel with the repo:
 * a teammate who clones and re-runs generate inherits your dismissals, so a claim
 * you judged noise stays dismissed for everyone.
 *
 * It holds two lists. `dismissedClaims`: findings the user judged a generation
 * defect / won't-fix / noise. A dismissed claim (identity = its section anchor +
 * the extracted claim's stable text) is skipped by generate — never re-authored,
 * never re-findinged — and settles as an explicit `dismissed` coverage gap. It is
 * excluded from flow synthesis too, so it never becomes a milestone.
 * `dismissedFlows`: whole flows (identity = the flow id) the user judged not worth
 * guarding — dropped with their scenarios at generate. Undo either by removing its
 * entry (the UI's Un-dismiss, or by hand).
 */

import { z } from 'zod'

/**
 * One dismissed claim. Identity is `anchor` + `title` (the extracted claim's
 * stable text); `doc` scopes the anchor to its document and drives display. Not
 * `.strict()` so a future field never breaks an old reader (mirrors the spec
 * decisions file).
 */
export const GuardDismissedClaimSchema = z.object({
  /** Repo-relative doc path the claim's section lives in. */
  doc: z.string().min(1),
  /** The section anchor (slug) the claim was extracted under. */
  anchor: z.string().min(1),
  /** The extracted claim's stable text — the identity, with `anchor`. */
  title: z.string().min(1),
  /** ISO timestamp the dismissal was recorded. */
  dismissedAt: z.string(),
  /** Optional free-text rationale ("flaky", "won't fix", …). */
  note: z.string().optional(),
})
export type GuardDismissedClaim = z.infer<typeof GuardDismissedClaimSchema>

/** Just the identity fields a dismissal keys on (doc + anchor + title) — what the
 *  dismiss/undismiss surfaces pass around; `dismissedClaimKey` hashes the same trio. */
export type GuardClaimIdentity = Pick<GuardDismissedClaim, 'doc' | 'anchor' | 'title'>

/**
 * One dismissed FLOW. Identity is `flowId` (the flow's stable handle in
 * `scenarios/flows.json`, which survives re-synthesis by milestone overlap);
 * `title` is display copy, kept so a dismissal reads without loading the flows
 * file. A dismissed flow is dropped at generate — never re-authored, never
 * re-findinged. Not `.strict()`, like the claim dismissal above.
 */
export const GuardDismissedFlowSchema = z.object({
  /** The flow's id — the identity. */
  flowId: z.string().min(1),
  /** The flow's title when it was dismissed, for display. */
  title: z.string().min(1),
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

/** The stable identity key a dismissal / claim matches on: doc + anchor + title. */
export function dismissedClaimKey(doc: string, anchor: string, title: string): string {
  return `${doc}\0${anchor}\0${title}`
}
