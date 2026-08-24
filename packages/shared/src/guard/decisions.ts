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
 * It holds three lists. `dismissedClaims`: findings the user judged a generation
 * defect / won't-fix / noise. A dismissed claim (identity = its section anchor +
 * the extracted claim's stable text) is skipped by generate — never re-authored,
 * never re-findinged — and settles as an explicit `dismissed` coverage gap. It is
 * excluded from flow synthesis too, so it never becomes a milestone.
 * `dismissedFlows`: whole flows (identity = the flow id) the user judged not worth
 * guarding — dropped with their scenarios at generate. Undo either by removing its
 * entry (the UI's Un-dismiss, or by hand). `reenabledFlows`: the manual reset for
 * a RETIRED flow (authoring gave up after repeated defective attempts) — an entry
 * newer than the retirement clears it and its ledger count, so the next generate
 * authors fresh.
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

/**
 * One RE-ENABLED flow — the user's reset for a retirement (authoring gave up on
 * the flow after repeated defective attempts). Identity is `flowId` plus the
 * optional `surface` (absent ⇒ every retired surface of the flow). The entry
 * clears a retirement recorded BEFORE `reenabledAt` — it stays in the file, so a
 * later re-retirement (with a newer `retiredAt`) stands until re-enabled again.
 * Not `.strict()`, like its siblings above.
 */
export const GuardReenabledFlowSchema = z.object({
  /** The flow's id — the identity. */
  flowId: z.string().min(1),
  /** One surface to re-enable; absent means every retired surface of the flow. */
  surface: z.string().optional(),
  /** ISO timestamp of the re-enable — only retirements recorded before it clear. */
  reenabledAt: z.string(),
  /** Optional free-text rationale. */
  note: z.string().optional(),
})
export type GuardReenabledFlow = z.infer<typeof GuardReenabledFlowSchema>

/** The whole decisions file. Every list defaults to `[]` so a partial or
 *  freshly-created file still parses. */
export const GuardDecisionsSchema = z.object({
  version: z.literal(1),
  dismissedClaims: z.array(GuardDismissedClaimSchema).default([]),
  dismissedFlows: z.array(GuardDismissedFlowSchema).default([]),
  reenabledFlows: z.array(GuardReenabledFlowSchema).default([]),
})
export type GuardDecisions = z.infer<typeof GuardDecisionsSchema>

/** An empty, valid decisions file — the reader's fallback and the writer's seed. */
export const EMPTY_GUARD_DECISIONS: GuardDecisions = {
  version: 1,
  dismissedClaims: [],
  dismissedFlows: [],
  reenabledFlows: [],
}

/** The stable identity key a dismissal / claim matches on: doc + anchor + title. */
export function dismissedClaimKey(doc: string, anchor: string, title: string): string {
  return `${doc}\0${anchor}\0${title}`
}
